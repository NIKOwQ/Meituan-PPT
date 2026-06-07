"""CLI for the V4 active constraint dataset MVP.

Usage:
    uv run python run_v4_dataset.py data/sample_instruction_rider.md \
        --max-turns 30 --min-tests 5 --coverage 0.9 --evaluate

Output goes to output/<timestamp>/ by default.
Use -o to override.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

from collector import V4Collector
from render import render_report, save_artifacts, save_report


def _default_output_path(instruction_path: str) -> str:
    """output/<timestamp>/report.json"""
    stem = Path(instruction_path).stem
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return str(Path("output") / f"{ts}_{stem}" / "report.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run V4 active constraint dataset MVP.")
    parser.add_argument("instruction", help="Path to raw Markdown long instruction.")
    parser.add_argument("-o", "--output", default=None,
                        help="Output JSON path. Default: output/<timestamp>_<stem>/report.json")
    parser.add_argument("--max-turns", type=int, default=100, help="Max turns per conversation group.")
    parser.add_argument("--max-retries", type=int, default=3)
    parser.add_argument("--max-pending-turns", type=int, default=3)
    parser.add_argument("--coverage", type=float, default=0.9)
    parser.add_argument("--min-tests", type=int, default=5)
    parser.add_argument("--parallel", type=int, default=5, help="Number of parallel conversation groups.")
    parser.add_argument("--evaluate", action="store_true", help="Run LLM evaluation after collection.")
    parser.add_argument("--targeted-threshold", type=float, default=0.5,
                        help="Coverage threshold to activate targeted conversations (default: 0.5)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    instruction_path = Path(args.instruction)
    instruction_md = instruction_path.read_text(encoding="utf-8")

    output_path = args.output or _default_output_path(str(instruction_path))

    collector = V4Collector()
    report = collector.collect(
        instruction_md=instruction_md,
        source_file=str(instruction_path),
        max_turns=args.max_turns,
        max_retries=args.max_retries,
        max_pending_turns=args.max_pending_turns,
        target_coverage=args.coverage,
        min_tests_per_constraint=args.min_tests,
        parallel_conversations=args.parallel,
        evaluate=args.evaluate,
        progress_callback=lambda msg: print(f"  {msg}", flush=True),
        output_path=output_path,
        targeted_threshold=args.targeted_threshold,
    )

    out = save_report(report, output_path)
    artifacts = save_artifacts(report, out)
    print()
    print(render_report(report))
    print(f"\nV4 数据集报告已保存到 {out}")
    print(f"中间产物已保存到 {artifacts}")


if __name__ == "__main__":
    main()
