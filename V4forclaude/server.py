"""FastAPI middleware: serves frontend static files and exposes REST + SSE
endpoints that wrap V4Collector for the browser UI."""

from __future__ import annotations

import asyncio
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

# ---------------------------------------------------------------------------
# In-memory run state
# ---------------------------------------------------------------------------

class _RunState:
    def __init__(self, output_path: str = "", instruction: str = "") -> None:
        self.status: str = "running"        # running | done | error | cancelled
        self.progress: list[str] = []
        self.report: dict | None = None
        self.error: str | None = None
        self.queue: asyncio.Queue = asyncio.Queue()
        self.output_path: str = output_path
        self.instruction: str = instruction
        self.cancel_event = threading.Event()

_runs: dict[str, _RunState] = {}

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="AI 指令评测工具")
_loop: asyncio.AbstractEventLoop | None = None  # set on startup


@app.on_event("startup")
async def _cache_loop() -> None:
    global _loop
    _loop = asyncio.get_event_loop()


@app.get("/api/health")
async def health_check():
    """Health endpoint for cloud platforms and uptime checks."""
    return {"status": "ok"}


# --- models ----------------------------------------------------------------

class RunRequest(BaseModel):
    instruction: str                          # filename in data/
    max_turns: int = 30
    min_tests_per_constraint: int = 3
    target_coverage: float = 0.6
    parallel_conversations: int = 5
    evaluate: bool = True
    max_retries: int = 3
    max_pending_turns: int = 3
    max_batches: int = 50
    stale_batches_limit: int = 3
    targeted_threshold: float = 0.5


class InstructionSaveRequest(BaseModel):
    name: str = "custom_instruction.md"
    content: str


# --- helpers ---------------------------------------------------------------

def _default_output_path(instruction_name: str) -> str:
    """Generate output/<timestamp>_<stem>/report.json inside V4forclaude/."""
    stem = Path(instruction_name).stem
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return str(Path(__file__).parent / "output" / f"{ts}_{stem}" / "report.json")


def _run_collect(run_id: str, instruction_md: str, source_file: str,
                 params: dict) -> None:
    """Runs V4Collector.collect() in a background thread."""
    try:
        from .collector import V4Collector
    except ImportError:  # pragma: no cover - keeps `uvicorn server:app` working.
        from collector import V4Collector

    state = _runs[run_id]

    def _on_progress(message: str) -> None:
        state.progress.append(message)
        if _loop is not None:
            _loop.call_soon_threadsafe(state.queue.put_nowait, message)

    try:
        collector = V4Collector()
        report = collector.collect(
            instruction_md=instruction_md,
            source_file=source_file,
            progress_callback=_on_progress,
            cancel_event=state.cancel_event,
            **params,
        )
        state.report = report.model_dump()
        state.status = "cancelled" if state.cancel_event.is_set() else "done"
    except Exception as exc:
        state.error = str(exc)
        state.status = "error"
    finally:
        # sentinel: tell SSE stream to close
        if _loop is not None:
            _loop.call_soon_threadsafe(state.queue.put_nowait, None)


# --- endpoints -------------------------------------------------------------

@app.get("/api/instructions")
async def list_instructions():
    """Return available .md instruction files in data/."""
    data_dir = Path(__file__).parent / "data"
    files = sorted(p.name for p in data_dir.glob("*.md"))
    return [{"name": f} for f in files]


@app.get("/api/instructions/{name}")
async def get_instruction(name: str):
    """Return one instruction markdown file from data/."""
    data_dir = (Path(__file__).parent / "data").resolve()
    md_path = (data_dir / name).resolve()
    if md_path.parent != data_dir or md_path.suffix.lower() != ".md":
        return JSONResponse({"error": "非法指令文件"}, 400)
    if not md_path.exists():
        return JSONResponse({"error": f"文件不存在: {name}"}, 404)
    return {
        "name": md_path.name,
        "content": md_path.read_text(encoding="utf-8"),
    }


@app.post("/api/instructions")
async def save_instruction(req: InstructionSaveRequest):
    """Save a user-authored instruction markdown file into data/."""
    data_dir = (Path(__file__).parent / "data").resolve()
    safe_stem = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in req.name)
    if not safe_stem:
        safe_stem = "custom_instruction"
    if safe_stem.lower().endswith(".md"):
        filename = safe_stem
    else:
        filename = f"{safe_stem}.md"
    md_path = (data_dir / filename).resolve()
    if md_path.parent != data_dir:
        return JSONResponse({"error": "非法指令文件"}, 400)
    md_path.write_text(req.content, encoding="utf-8")
    return {"name": md_path.name, "content": req.content}


@app.get("/api/reports")
async def list_reports():
    """Return generated report JSON files for history/demo rendering."""
    output_dir = Path(__file__).parent / "output"
    reports = []
    for path in sorted(output_dir.rglob("report.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        rel = path.relative_to(output_dir)
        reports.append({
            "name": str(rel),
            "size": path.stat().st_size,
            "modified": path.stat().st_mtime,
        })
    return reports


@app.get("/api/reports/{relpath:path}")
async def get_report(relpath: str):
    """Return one generated report JSON file from output/ (supports subdirs)."""
    output_dir = (Path(__file__).parent / "output").resolve()
    report_path = (output_dir / relpath).resolve()
    if report_path.parent != output_dir and report_path.parent.name != output_dir.name:
        # Allow both output/*.json and output/<subdir>/report.json
        if not str(report_path).startswith(str(output_dir)):
            return JSONResponse({"error": "非法报告文件"}, 400)
    if report_path.suffix.lower() != ".json":
        return JSONResponse({"error": "非法报告文件"}, 400)
    if not report_path.exists():
        return JSONResponse({"error": f"报告不存在: {relpath}"}, 404)
    return Response(report_path.read_text(encoding="utf-8"), media_type="application/json")


@app.post("/api/runs")
async def start_run(req: RunRequest):
    """Launch a V4 evaluation run in a background thread."""
    data_dir = Path(__file__).parent / "data"
    md_path = data_dir / req.instruction
    if not md_path.exists():
        return JSONResponse({"error": f"文件不存在: {req.instruction}"}, 404)

    # Deduplicate: cancel any running evaluation for the same instruction
    for rid, rs in _runs.items():
        if rs.status == "running" and rs.instruction == req.instruction:
            rs.cancel_event.set()
            rs.status = "cancelled"

    run_id = uuid.uuid4().hex[:6]
    output_path = _default_output_path(req.instruction)
    _runs[run_id] = _RunState(output_path=output_path, instruction=req.instruction)

    instruction_md = md_path.read_text(encoding="utf-8")
    params = {
        "max_turns": req.max_turns,
        "min_tests_per_constraint": req.min_tests_per_constraint,
        "target_coverage": req.target_coverage,
        "parallel_conversations": req.parallel_conversations,
        "evaluate": req.evaluate,
        "max_retries": req.max_retries,
        "max_pending_turns": req.max_pending_turns,
        "max_batches": req.max_batches,
        "stale_batches_limit": req.stale_batches_limit,
        "targeted_threshold": req.targeted_threshold,
        "output_path": output_path,
    }

    thread = threading.Thread(
        target=_run_collect,
        args=(run_id, instruction_md, str(md_path), params),
        daemon=True,
    )
    thread.start()

    return {"run_id": run_id, "status": "running"}


@app.get("/api/runs/active")
async def list_active_runs():
    """Return all currently running evaluations."""
    return [
        {"run_id": rid, "instruction": rs.instruction, "output_path": rs.output_path}
        for rid, rs in _runs.items()
        if rs.status == "running"
    ]


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    """Return current run status (and report when done)."""
    state = _runs.get(run_id)
    if state is None:
        return JSONResponse({"error": "评测不存在"}, 404)

    resp: dict = {
        "run_id": run_id,
        "status": state.status,
        "progress": state.progress[-20:],     # last 20 lines
        "report": state.report,
    }
    if state.error:
        resp["error"] = state.error
    return resp


@app.get("/api/runs/{run_id}/progress")
async def get_run_progress(run_id: str):
    """Return full progress history for replay after page refresh."""
    state = _runs.get(run_id)
    if state is None:
        return JSONResponse({"error": "评测不存在"}, 404)
    return {
        "run_id": run_id,
        "status": state.status,
        "progress": state.progress,
    }


@app.post("/api/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    """Cancel a running evaluation."""
    state = _runs.get(run_id)
    if state is None:
        return JSONResponse({"error": "评测不存在"}, 404)
    if state.status != "running":
        return JSONResponse({"error": "评测未在运行"}, 409)
    state.cancel_event.set()
    return {"run_id": run_id, "status": "cancelled"}


@app.get("/api/runs/{run_id}/stream")
async def stream_run(run_id: str):
    """SSE stream: push progress lines in real time."""
    state = _runs.get(run_id)
    if state is None:
        return JSONResponse({"error": "评测不存在"}, 404)

    async def _event_generator():
        while True:
            msg = await state.queue.get()
            if msg is None:  # sentinel
                yield {"event": "done", "data": f'{{"run_id":"{run_id}"}}'}
                break
            yield {"event": "progress", "data": msg}

    return EventSourceResponse(_event_generator())


class EvalRequest(BaseModel):
    report: dict  # full V4DatasetReport as dict


@app.post("/api/evaluations")
async def start_evaluation(req: EvalRequest):
    """Run evaluate_report on a loaded report, stream results via SSE."""
    try:
        from .models import V4DatasetReport
    except ImportError:
        from models import V4DatasetReport

    try:
        report = V4DatasetReport.model_validate(req.report)
    except Exception as exc:
        return JSONResponse({"error": f"报告格式错误: {exc}"}, 400)

    eval_id = uuid.uuid4().hex[:6]
    eval_state = _RunState()
    eval_state.status = "running"
    _runs[f"eval-{eval_id}"] = eval_state

    def _run_eval(state: _RunState, report: V4DatasetReport) -> None:
        try:
            from .collector import V4Collector
        except ImportError:
            from collector import V4Collector

        def _on_progress(message: str) -> None:
            state.progress.append(message)
            if _loop is not None:
                _loop.call_soon_threadsafe(state.queue.put_nowait, message)

        try:
            collector = V4Collector()
            evaluations = collector.evaluate_report(report, progress_callback=_on_progress)
            # Return evaluations as a list
            state.report = [ev.model_dump() for ev in evaluations]
            state.status = "done"
        except Exception as exc:
            state.error = str(exc)
            state.status = "error"
        finally:
            if _loop is not None:
                _loop.call_soon_threadsafe(state.queue.put_nowait, None)

    thread = threading.Thread(
        target=_run_eval,
        args=(eval_state, report),
        daemon=True,
    )
    thread.start()

    return {"eval_id": eval_id, "status": "running"}


@app.get("/api/evaluations/{eval_id}/stream")
async def stream_evaluation(eval_id: str):
    """SSE stream for evaluation progress."""
    state = _runs.get(eval_id)
    if state is None:
        return JSONResponse({"error": "评测不存在"}, 404)

    async def _event_generator():
        while True:
            msg = await state.queue.get()
            if msg is None:
                yield {"event": "done", "data": f'{{"eval_id":"{eval_id}"}}'}
                break
            yield {"event": "progress", "data": msg}

    return EventSourceResponse(_event_generator())


@app.get("/api/evaluations/{eval_id}")
async def get_evaluation(eval_id: str):
    """Return evaluation results."""
    state = _runs.get(eval_id)
    if state is None:
        return JSONResponse({"error": "评测不存在"}, 404)
    return {
        "eval_id": eval_id,
        "status": state.status,
        "evaluations": state.report,
        "error": state.error,
    }


# --- static files (MUST be last) -------------------------------------------

frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(frontend_dir), html=True))
