"""V4 active constraint dataset collector.

Orchestrates parallel conversation groups that test whether an Agent
follows a long instruction's constraints.  Delegates coverage computation
to coverage.py, prompt templates to prompts.py, and rendering/persistence
to render.py.
"""

from __future__ import annotations

import json
import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

from pydantic import ValidationError

from agent import FlowAgent
from llm_utils import create_client, extract_json, repair_json

from models import (
    ConversationGroup,
    ConstraintStat,
    EvalRecord,
    GateCheck,
    SegmentRecord,
    SegmentTurn,
    TurnRecord,
    UserCandidate,
    V4DatasetReport,
)
from prompts import (
    CONTINUE_USER_PROMPT,
    END_TOKEN,
    EVAL_PROMPT,
    EVAL_SYSTEM,
    GATE_PROMPT,
    GATE_SYSTEM,
    TARGET_USER_PROMPT,
    USER_PROMPT,
    USER_SYSTEM,
)
from coverage import (
    _normalize_constraint,
    _build_section_hint,
    _build_stats,
    _is_complete,
    _compute_overall_score,
)
from render import save_report, save_artifacts

# ---------------------------------------------------------------------------
# Named constants (extracted from inline magic numbers)
# ---------------------------------------------------------------------------

MAX_HISTORY_TURNS = 12
USER_LLM_TEMPERATURE = 0.8


# ---------------------------------------------------------------------------
# LLM helpers
# ---------------------------------------------------------------------------

def clean_instruction(text: str) -> str:
    """Remove line breaks and normalize whitespace for exact substring checks."""

    return re.sub(r"\s+", " ", text.replace("\r", " ").replace("\n", " ")).strip()


def _json_loads(raw: str) -> dict:
    json_str = extract_json(raw.strip())
    for attempt in range(3):
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            if attempt == 2:
                raise
            json_str = repair_json(json_str)
    raise ValueError("unreachable")


def _call_json(client, model: str, system_prompt: str, user_prompt: str, *, temperature: float = 0.2) -> tuple[dict, str]:
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
    )
    raw = resp.choices[0].message.content or ""
    return _json_loads(raw), raw


def _history_json(history: list[dict]) -> str:
    return json.dumps(history[-MAX_HISTORY_TURNS:], ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Code gate (validates user candidate without LLM)
# ---------------------------------------------------------------------------

def _code_gate(
    candidate: UserCandidate,
    instruction: str,
    tested_in_conversation: set[str] | None = None,
) -> list[str]:
    errors: list[str] = []

    if candidate.end:
        return errors
    if not candidate.user_reply.strip():
        errors.append("缺少 user_reply")
    if candidate.constraint_text and candidate.constraint_text not in instruction:
        errors.append("constraint_text 不是清洗后长指令中的精确连续原文")
    if (
        candidate.constraint_text
        and tested_in_conversation is not None
        and candidate.constraint_text in tested_in_conversation
    ):
        errors.append("当前连续对话中已经测试过这条约束，不能连续反复测试")
    # Also check normalized form to catch trailing punctuation variants
    if (
        candidate.constraint_text
        and tested_in_conversation is not None
        and _normalize_constraint(candidate.constraint_text) in {
            _normalize_constraint(tc) for tc in tested_in_conversation
        }
        and "当前连续对话中已经测试过这条约束" not in ";".join(errors)
    ):
        errors.append("当前连续对话中已测试过该约束的等价变体（忽略末尾标点差异）")
    if END_TOKEN in candidate.user_reply:
        errors.append("user_reply 不能包含结束符")
    return errors


def _mask_instruction(instruction: str, tested_constraints: set[str]) -> str:
    masked = instruction
    for idx, constraint in enumerate(sorted(tested_constraints, key=len, reverse=True), 1):
        masked = re.sub(re.escape(constraint), f"[已充分测试约束{idx}]", masked)
    return masked


# ---------------------------------------------------------------------------
# V4Collector
# ---------------------------------------------------------------------------

class V4Collector:
    """Collect user-agent turns and evaluate them against exact instruction constraints."""

    MAX_CONSECUTIVE_SKIPS = 3

    def __init__(self, agent: FlowAgent | None = None):
        self.client, self.model = create_client()
        self.agent = agent or FlowAgent()

    def collect(
        self,
        instruction_md: str,
        source_file: str = "",
        max_turns: int = 100,
        max_retries: int = 3,
        max_pending_turns: int = 3,
        target_coverage: float = 0.9,
        min_tests_per_constraint: int = 5,
        parallel_conversations: int = 5,
        evaluate: bool = False,
        progress_callback=None,
        max_batches: int = 50,
        stale_batches_limit: int = 3,
        output_path: str = "",
        targeted_threshold: float = 0.5,
        cancel_event: "threading.Event | None" = None,
    ) -> V4DatasetReport:
        start_time = time.perf_counter()
        instruction = clean_instruction(instruction_md)
        parallel_conversations = max(1, parallel_conversations)
        diagnostics: list[str] = []

        def progress(message: str) -> None:
            if progress_callback:
                elapsed = time.perf_counter() - start_time
                progress_callback(f"[{elapsed:7.1f}s] {message}")

        all_groups: list[ConversationGroup] = []
        all_turns: list[TurnRecord] = []
        all_segments: list[SegmentRecord] = []
        next_conversation_id = 0
        stale_count = 0  # consecutive batches with no coverage improvement
        prev_coverage = 0.0

        progress(
            f"开始循环派发对话组（每批 {parallel_conversations} 组，"
            f"每组最多 {max_turns} turns，目标覆盖率 {target_coverage:.0%}）。"
        )

        prev_batch_counts: dict[str, int] = {}
        test_stale_count = 0
        section_hint = ""
        stats: list[ConstraintStat] = []
        coverage = 0.0
        over_tested_global: list[str] = []
        over_test_threshold = min_tests_per_constraint * 4
        opening_lines: list[str] = []

        for batch_idx in range(1, max_batches + 1):
            if cancel_event is not None and cancel_event.is_set():
                progress("用户取消评测。")
                break
            progress(f"=== 第 {batch_idx} 批（共 {parallel_conversations} 组）===")

            # Compute targeted conversation allocation
            insufficient = [s for s in stats if not s.sufficiently_tested] if stats else []
            n_targeted = 0
            target_list = None
            targeted_ids: list[int] = []
            if coverage >= targeted_threshold and insufficient:
                target_list = [s.constraint_text for s in sorted(insufficient, key=lambda s: s.count)]
                n_targeted = max(1, parallel_conversations // 2)

            # Run one batch of parallel conversations
            batch_groups: list[ConversationGroup] = []
            batch_ids = list(
                range(next_conversation_id, next_conversation_id + parallel_conversations)
            )
            next_conversation_id += parallel_conversations

            if n_targeted > 0:
                targeted_ids = batch_ids[:n_targeted]
                progress(
                    f"  → 定向组 {targeted_ids}，目标: "
                    f"{[c[:30] for c in (target_list or [])[:5]]}"
                )

            with ThreadPoolExecutor(max_workers=parallel_conversations) as executor:
                future_map = {
                    executor.submit(
                        self._run_conversation_group,
                        instruction,
                        cid,
                        max_turns,
                        max_retries,
                        max_pending_turns,
                        section_hint,
                        over_tested_global,
                        over_test_threshold,
                        target_list if i < n_targeted else None,
                        progress,
                    ): cid
                    for i, cid in enumerate(batch_ids)
                }
                for future in as_completed(future_map):
                    cid = future_map[future]
                    try:
                        group = future.result()
                        batch_groups.append(group)
                        tag = "【定向】" if cid in (targeted_ids if n_targeted > 0 else []) else ""
                        progress(
                            f"C{cid} 完成：turns={len(group.turns)}, "
                            f"segments={len(group.segments)}, "
                            f"reason={group.completion_reason} {tag}"
                        )
                        progress(
                            "@@GROUP@@"
                            + json.dumps(
                                {
                                    "type": "group_complete",
                                    "batch": batch_idx,
                                    "parallel": parallel_conversations,
                                    "conversation_id": cid,
                                    "targeted": cid in (targeted_ids if n_targeted > 0 else []),
                                    "group": group.model_dump(),
                                },
                                ensure_ascii=False,
                            )
                        )
                    except Exception as exc:  # noqa: BLE001
                        diagnostics.append(f"conversation {cid}: 执行异常: {exc}")
                        group = ConversationGroup(
                            conversation_id=cid,
                            completion_reason="exception",
                            diagnostics=[f"执行异常: {exc}"],
                        )
                        batch_groups.append(group)
                        progress(
                            "@@GROUP@@"
                            + json.dumps(
                                {
                                    "type": "group_complete",
                                    "batch": batch_idx,
                                    "parallel": parallel_conversations,
                                    "conversation_id": cid,
                                    "targeted": cid in (targeted_ids if n_targeted > 0 else []),
                                    "group": group.model_dump(),
                                },
                                ensure_ascii=False,
                            )
                        )

            # Merge batch results into global lists
            batch_groups.sort(key=lambda g: g.conversation_id)
            for group in batch_groups:
                diagnostics.extend(group.diagnostics)
                local_to_global: dict[int, int] = {}
                segment_id_map: dict[int, int] = {}

                for turn in group.turns:
                    global_turn_index = len(all_turns) + 1
                    local_to_global[turn.local_turn_index] = global_turn_index
                    turn.turn_index = global_turn_index
                    all_turns.append(turn)

                for segment in group.segments:
                    old_seg_id = segment.segment_id
                    new_seg_id = len(all_segments) + 1
                    segment_id_map[old_seg_id] = new_seg_id
                    segment.segment_id = new_seg_id
                    for item in segment.turns:
                        item.turn_index = local_to_global.get(
                            item.local_turn_index, item.turn_index
                        )
                    all_segments.append(segment)

                for turn in group.turns:
                    if turn.segment_id is not None:
                        turn.segment_id = segment_id_map.get(
                            turn.segment_id, turn.segment_id
                        )

            all_groups.extend(batch_groups)

            # Track opening lines incrementally
            for g in batch_groups:
                if g.opening_line and g.opening_line not in opening_lines:
                    opening_lines.append(g.opening_line)

            # Check coverage after each batch
            counts: Counter[str] = Counter(
                segment.constraint_text for segment in all_segments
            )
            coverage, stats = _build_stats(instruction, counts, min_tests_per_constraint)
            n_constraints = len(stats)
            # Compute global context for next batch
            section_hint = _build_section_hint(instruction, stats)
            over_test_threshold = min_tests_per_constraint * 4
            over_tested_global = sorted(
                s.constraint_text for s in stats if s.count >= over_test_threshold
            )
            sufficiently_tested = sum(1 for s in stats if s.sufficiently_tested)
            all_min_met = sufficiently_tested == n_constraints

            progress(
                f"覆盖率: {coverage:.2%} | 约束: {n_constraints} 种 | "
                f"片段: {len(all_segments)} | 充分测试: {sufficiently_tested}/{n_constraints}"
            )

            # Save intermediate report so user can Ctrl+C and still see results
            if output_path:
                _intermediate = V4DatasetReport(
                    source_file=source_file,
                    completion_reason=f"batch_{batch_idx}_intermediate",
                    target_coverage=target_coverage,
                    min_tests_per_constraint=min_tests_per_constraint,
                    max_turns=max_turns,
                    parallel_conversations=parallel_conversations,
                    elapsed_seconds=time.perf_counter() - start_time,
                    coverage=coverage,
                    opening_line=opening_lines[0] if opening_lines else "",
                    opening_lines=opening_lines,
                    cleaned_instruction=instruction,
                    constraint_stats=stats,
                    conversation_groups=all_groups,
                    turns=all_turns,
                    segments=all_segments,
                    diagnostics=list(diagnostics),
                )
                saved = save_report(_intermediate, output_path)
                save_artifacts(_intermediate, saved)
                progress(f"中间报告已保存到 {saved}")

            # Stale detection: coverage didn't improve
            coverage_grew = coverage > prev_coverage + 0.001
            if coverage_grew:
                stale_count = 0
                prev_coverage = coverage
            else:
                stale_count += 1

            # Track per-constraint test count growth to detect fully stalled constraints
            current_counts = {s.constraint_text: s.count for s in stats}
            counts_grew = current_counts != prev_batch_counts
            if counts_grew:
                test_stale_count = 0
                prev_batch_counts = current_counts
            else:
                test_stale_count += 1

            # Completion: target reached
            if _is_complete(coverage, stats, target_coverage, min_tests_per_constraint):
                progress("✓ 覆盖率和测试次数均达标！")
                break

            # Exit condition 1: coverage stale AND all constraints sufficiently tested
            if all_min_met and stale_count >= stale_batches_limit:
                progress(
                    f"连续 {stale_batches_limit} 批覆盖率无提升，"
                    f"且所有 {n_constraints} 条约束均已充分测试，停止派发。"
                )
                break

            # Exit condition 2: both coverage AND test counts fully stalled
            #   (even though some constraints haven't reached min_tests — LLM can't trigger them)
            if stale_count >= stale_batches_limit and test_stale_count >= stale_batches_limit:
                insufficient = [s for s in stats if not s.sufficiently_tested]
                progress(
                    f"连续 {stale_batches_limit} 批覆盖率和测试次数均无提升，停止派发。"
                    f"（{len(insufficient)} 条约束未充分测试:"
                    f" {', '.join(s.constraint_text[:30] + f'({s.count}/{min_tests_per_constraint})' for s in insufficient)}）"
                )
                break

            if stale_count >= stale_batches_limit and not all_min_met:
                progress(
                    f"覆盖率未提升（连续 {stale_count} 批），"
                    f"但仍有 {n_constraints - sufficiently_tested} 条约束未充分测试，继续派发。"
                    f"（未达标: {', '.join(s.constraint_text[:30] + f'({s.count}/{min_tests_per_constraint})' for s in stats if not s.sufficiently_tested)}）"
                )

        # Final assembly
        elapsed_seconds = time.perf_counter() - start_time

        is_complete_flag = _is_complete(
            coverage, stats, target_coverage, min_tests_per_constraint
        )
        all_min_met = all(s.sufficiently_tested for s in stats)
        if is_complete_flag:
            completion_reason = "coverage_and_min_tests_reached"
        elif all_min_met and stale_count >= stale_batches_limit:
            completion_reason = "stale_and_sufficient_stopped"
        elif stale_count >= stale_batches_limit:
            completion_reason = "stale_but_insufficient_stopped"
        else:
            completion_reason = "max_batches_reached"

        report = V4DatasetReport(
            source_file=source_file,
            completion_reason=completion_reason,
            target_coverage=target_coverage,
            min_tests_per_constraint=min_tests_per_constraint,
            max_turns=max_turns,
            parallel_conversations=parallel_conversations,
            elapsed_seconds=elapsed_seconds,
            coverage=coverage,
            opening_line=opening_lines[0] if opening_lines else "",
            opening_lines=opening_lines,
            cleaned_instruction=instruction,
            constraint_stats=stats,
            conversation_groups=all_groups,
            turns=all_turns,
            segments=all_segments,
            diagnostics=diagnostics,
        )

        if evaluate:
            progress("开始评估已收集 segments。")
            report.evaluations = self.evaluate_report(report, progress_callback=progress)
            report.elapsed_seconds = time.perf_counter() - start_time

        report.overall_score = _compute_overall_score(
            coverage, report.segments, report.evaluations
        )

        return report

    def _run_conversation_group(
        self,
        instruction: str,
        conversation_id: int,
        max_turns: int,
        max_retries: int,
        max_pending_turns: int,
        section_hint: str = "",
        over_tested_global: list[str] | None = None,
        over_test_threshold: int = 20,
        target_constraints: list[str] | None = None,
        progress_fn: Callable | None = None,
    ) -> ConversationGroup:
        diagnostics: list[str] = []
        history: list[dict] = []
        turns: list[TurnRecord] = []
        segments: list[SegmentRecord] = []
        tested_constraints: set[str] = set()
        failed_constraints: set[str] = set()
        pending: dict | None = None
        consecutive_skips = 0

        opening_line = self.agent.reply(instruction, [])
        history.append({"role": "assistant", "content": opening_line})
        completion_reason = "max_turns"

        if progress_fn:
            progress_fn(f"C{conversation_id} 开场")

        for local_turn_index in range(1, max_turns + 1):
            history_before = [dict(item) for item in history]
            candidate, raw, gate, code_errors = self._next_user_candidate(
                instruction=instruction,
                history=history_before,
                tested_constraints=tested_constraints,
                max_retries=max_retries,
                diagnostics=diagnostics,
                pending_constraint=pending["constraint_text"] if pending else None,
                section_hint=section_hint,
                failed_constraints=failed_constraints,
                over_tested_global=over_tested_global or [],
                over_test_threshold=over_test_threshold,
                target_constraints=target_constraints,
            )

            if candidate.end:
                completion_reason = "user_llm_end"
                break

            if gate.result != "pass":
                if candidate.constraint_text:
                    failed_constraints.add(candidate.constraint_text)
                consecutive_skips += 1
                diagnostics.append(
                    f"local_turn={local_turn_index}: 门控重试耗尽，跳过本轮"
                    f" (连续 {consecutive_skips}/{self.MAX_CONSECUTIVE_SKIPS})"
                )
                if consecutive_skips >= self.MAX_CONSECUTIVE_SKIPS:
                    completion_reason = "user_gate_failed"
                    # Flush pending segment before terminating
                    if pending:
                        segment = SegmentRecord(
                            segment_id=pending["segment_id"],
                            conversation_id=conversation_id,
                            constraint_text=pending["constraint_text"],
                            history_before=pending["history_before"],
                            turns=pending["turns"],
                            complete_reason="conversation_ended_early",
                        )
                        segments.append(segment)
                        tested_constraints.add(segment.constraint_text)
                        pending = None
                    break
                continue

            # Gate passed — reset skip counter
            consecutive_skips = 0

            agent_reply = self.agent.reply(
                instruction,
                history_before + [{"role": "user", "content": candidate.user_reply}],
            )
            history.extend(
                [
                    {"role": "user", "content": candidate.user_reply},
                    {"role": "assistant", "content": agent_reply},
                ]
            )

            if progress_fn:
                constraint_tag = f"【{candidate.constraint_text[:30]}】" if candidate.constraint_text.strip() else ""
                progress_fn(
                    f"C{conversation_id} T{local_turn_index} "
                    f"U={candidate.user_reply[:60]} "
                    f"A={agent_reply[:60]} {constraint_tag}"
                )

            segment_id: int | None = None
            is_test_turn = bool(candidate.constraint_text.strip())
            segment_turn = SegmentTurn(
                turn_index=local_turn_index,
                conversation_id=conversation_id,
                local_turn_index=local_turn_index,
                user_reply=candidate.user_reply,
                agent_reply=agent_reply,
            )

            if is_test_turn:
                if pending is None:
                    pending = {
                        "segment_id": len(segments) + 1,
                        "conversation_id": conversation_id,
                        "constraint_text": candidate.constraint_text,
                        "history_before": history_before,
                        "turns": [],
                    }
                segment_id = pending["segment_id"]
                pending["turns"].append(segment_turn)

                should_complete = candidate.multi_turn in ("none", "done")
                if len(pending["turns"]) >= max_pending_turns:
                    should_complete = True
                    diagnostics.append(
                        f"segment {segment_id} 达到 max_pending_turns="
                        f"{max_pending_turns}，自动收束"
                    )

                if should_complete:
                    segment = SegmentRecord(
                        segment_id=pending["segment_id"],
                        conversation_id=conversation_id,
                        constraint_text=pending["constraint_text"],
                        history_before=pending["history_before"],
                        turns=pending["turns"],
                        complete_reason=(
                            "max_pending_turns"
                            if len(pending["turns"]) >= max_pending_turns
                            else candidate.multi_turn
                        ),
                    )
                    segments.append(segment)
                    tested_constraints.add(segment.constraint_text)
                    pending = None

            turns.append(
                TurnRecord(
                    turn_index=local_turn_index,
                    conversation_id=conversation_id,
                    local_turn_index=local_turn_index,
                    constraint_text=candidate.constraint_text,
                    user_reply=candidate.user_reply,
                    agent_reply=agent_reply,
                    history_before=history_before,
                    user_llm_raw=raw,
                    user_gate=gate,
                    code_gate_errors=code_errors,
                    multi_turn=candidate.multi_turn,
                    segment_id=segment_id,
                    is_test_turn=is_test_turn,
                )
            )

        if pending is not None:
            # Flush incomplete multi-turn segment instead of silently dropping it
            segment = SegmentRecord(
                segment_id=pending["segment_id"],
                conversation_id=conversation_id,
                constraint_text=pending["constraint_text"],
                history_before=pending["history_before"],
                turns=pending["turns"],
                complete_reason="conversation_ended_early",
            )
            segments.append(segment)
            tested_constraints.add(segment.constraint_text)
            diagnostics.append(
                f"segment {segment.segment_id} 未完成多轮测试，自动收束 "
                f"({len(pending['turns'])} turns)"
            )
            pending = None

        return ConversationGroup(
            conversation_id=conversation_id,
            opening_line=opening_line,
            turns=turns,
            segments=segments,
            completion_reason=completion_reason,
            diagnostics=diagnostics,
        )

    def _next_user_candidate(
        self,
        instruction: str,
        history: list[dict],
        tested_constraints: set[str],
        max_retries: int,
        diagnostics: list[str],
        pending_constraint: str | None = None,
        section_hint: str = "",
        failed_constraints: set[str] | None = None,
        over_tested_global: list[str] | None = None,
        over_test_threshold: int = 20,
        target_constraints: list[str] | None = None,
    ) -> tuple[UserCandidate, str, GateCheck, list[str]]:
        last_raw = ""
        last_errors: list[str] = []
        last_gate = GateCheck(result="fail", evidence="尚未通过门控")
        last_candidate = UserCandidate()
        retry_feedback = "无"

        for attempt in range(1, max_retries + 1):
            if pending_constraint:
                prompt = CONTINUE_USER_PROMPT.format(
                    instruction=instruction,
                    retry_feedback=retry_feedback,
                    history=_history_json(history),
                    pending_constraint=pending_constraint,
                )
            elif target_constraints:
                prompt = TARGET_USER_PROMPT.format(
                    instruction=instruction,
                    target_constraints=json.dumps(
                        target_constraints, ensure_ascii=False, indent=2
                    ),
                    tested_constraints=json.dumps(
                        sorted(tested_constraints), ensure_ascii=False, indent=2
                    ),
                    failed_constraints=json.dumps(
                        sorted(failed_constraints or set()), ensure_ascii=False, indent=2
                    ),
                    retry_feedback=retry_feedback,
                    history=_history_json(history),
                )
            else:
                prompt = USER_PROMPT.format(
                    instruction=instruction,
                    tested_constraints=json.dumps(
                        sorted(tested_constraints), ensure_ascii=False, indent=2
                    ),
                    failed_constraints=json.dumps(
                        sorted(failed_constraints or set()), ensure_ascii=False, indent=2
                    ),
                    over_tested_global=json.dumps(
                        over_tested_global or [], ensure_ascii=False, indent=2
                    ),
                    over_test_threshold=str(over_test_threshold),
                    section_hint=section_hint or "(尚无覆盖率数据)",
                    retry_feedback=retry_feedback,
                    masked_instruction=_mask_instruction(instruction, tested_constraints),
                    history=_history_json(history),
                )

            try:
                data, raw = _call_json(self.client, self.model, USER_SYSTEM, prompt, temperature=USER_LLM_TEMPERATURE)
                candidate = UserCandidate.model_validate(data)
            except (json.JSONDecodeError, ValidationError, KeyError, ValueError) as exc:
                diagnostics.append(f"user attempt {attempt}: JSON/字段解析失败: {exc}")
                last_raw = locals().get("raw", "")
                last_errors = [f"JSON/字段解析失败: {exc}"]
                retry_feedback = (
                    "上一次输出无法解析为要求的 JSON 或字段类型错误。"
                    f"错误：{exc}。请重新输出严格 JSON。"
                )
                continue

            last_raw = raw
            last_candidate = candidate
            code_errors = _code_gate(
                candidate,
                instruction,
                None if pending_constraint else tested_constraints,
            )
            # Enforce "don't choose" lists that USER_PROMPT claims code will intercept
            if (
                not pending_constraint
                and candidate.constraint_text
                and failed_constraints is not None
                and _normalize_constraint(candidate.constraint_text) in {
                    _normalize_constraint(fc) for fc in failed_constraints
                }
            ):
                code_errors.append("该约束在本对话中门控已失败过，无法生成有效触发消息")
            if (
                not pending_constraint
                and candidate.constraint_text
                and over_tested_global
                and _normalize_constraint(candidate.constraint_text) in {
                    _normalize_constraint(ot) for ot in over_tested_global
                }
            ):
                code_errors.append("该约束全局已过度测试，不需要更多数据")
            # Targeted mode: constraint_text must come from target list
            if (
                target_constraints
                and candidate.constraint_text
                and not candidate.end
            ):
                normalized_match = _normalize_constraint(candidate.constraint_text) in {
                    _normalize_constraint(tc) for tc in target_constraints
                }
                if not normalized_match:
                    code_errors.append("constraint_text 不在目标约束列表中")
            if (
                pending_constraint
                and not candidate.end
                and candidate.constraint_text != pending_constraint
            ):
                code_errors.append("多轮承接时 constraint_text 必须等于 pending 约束原文")
            if (
                pending_constraint
                and not candidate.end
                and candidate.multi_turn not in ("continue", "done")
            ):
                code_errors.append("多轮承接时 multi_turn 必须是 continue 或 done")
            if (
                not pending_constraint
                and not candidate.end
                and candidate.multi_turn in ("continue", "done")
            ):
                code_errors.append("非多轮承接状态下 multi_turn 只能是 none 或 need")
            last_errors = code_errors
            if code_errors:
                diagnostics.append(
                    f"user attempt {attempt}: 代码门控失败: {'; '.join(code_errors)}"
                )
                # Different feedback based on the actual failure reason
                error_msg = "; ".join(code_errors)
                if "已经测试过" in error_msg or "门控已失败过" in error_msg or "全局已过度测试" in error_msg:
                    retry_feedback = (
                        "上一次输出未通过代码门控："
                        + error_msg
                        + "。请选择一条完全不同的、尚未测试过的约束。"
                    )
                elif "不在目标约束列表" in error_msg:
                    retry_feedback = (
                        "上一次输出未通过代码门控："
                        + error_msg
                        + "。请仅从「待补充测试的约束」列表中选择一条。"
                    )
                elif "不是清洗后长指令" in error_msg:
                    retry_feedback = (
                        "上一次输出未通过代码门控："
                        + error_msg
                        + "。请确保 constraint_text 是原始长指令中的精确连续原文。"
                    )
                else:
                    retry_feedback = (
                        "上一次输出未通过代码门控："
                        + error_msg
                        + "。请重新生成。"
                    )
                continue

            if candidate.end:
                return candidate, raw, GateCheck(result="pass", evidence="User LLM 结束"), []

            if not candidate.constraint_text.strip():
                return (
                    candidate,
                    raw,
                    GateCheck(result="pass", evidence="空约束桥接 turn"),
                    [],
                )

            gate = self._llm_gate(instruction, history, candidate)
            last_gate = gate
            if gate.result == "pass":
                return candidate, raw, gate, []

            diagnostics.append(f"user attempt {attempt}: LLM 门控失败: {gate.evidence}")
            retry_feedback = (
                "上一次输出未通过 LLM 门控："
                + gate.evidence
                + "。请换一条能更明确触发或检验该约束的用户消息，必要时更换约束。"
            )

        return last_candidate, last_raw, last_gate, last_errors

    def _llm_gate(
        self,
        instruction: str,
        history: list[dict],
        candidate: UserCandidate,
    ) -> GateCheck:
        prompt = GATE_PROMPT.format(
            instruction=instruction,
            history=_history_json(history),
            constraint_text=candidate.constraint_text,
            user_reply=candidate.user_reply,
        )
        try:
            data, _raw = _call_json(self.client, self.model, GATE_SYSTEM, prompt)
            return GateCheck.model_validate(data)
        except (json.JSONDecodeError, ValidationError, KeyError, ValueError) as exc:
            return GateCheck(result="fail", evidence=f"门控 JSON 解析失败: {exc}")

    def evaluate_report(
        self,
        report: V4DatasetReport,
        progress_callback=None,
    ) -> list[EvalRecord]:
        evaluations: list[EvalRecord] = []
        instruction = report.cleaned_instruction
        total = len(report.segments)

        for idx, segment in enumerate(report.segments):
            if progress_callback:
                progress_callback(
                    f"评估 S{segment.segment_id}/{total} "
                    f"【{segment.constraint_text[:30]}】..."
                )
            segment_turns_json = json.dumps(
                [turn.model_dump() for turn in segment.turns],
                ensure_ascii=False,
                indent=2,
            )
            prompt = EVAL_PROMPT.format(
                instruction=instruction,
                constraint_text=segment.constraint_text,
                history_before=_history_json(segment.history_before),
                segment_turns=segment_turns_json,
            )
            raw = ""
            try:
                data, raw = _call_json(self.client, self.model, EVAL_SYSTEM, prompt)
                result = data.get("result", "invalid")
                if result not in {"pass", "fail", "invalid"}:
                    result = "invalid"
                last_turn = segment.turns[-1] if segment.turns else None
                evaluations.append(
                    EvalRecord(
                        turn_index=last_turn.turn_index if last_turn else None,
                        segment_id=segment.segment_id,
                        constraint_text=segment.constraint_text,
                        user_reply=last_turn.user_reply if last_turn else "",
                        agent_reply=last_turn.agent_reply if last_turn else "",
                        segment_turns=segment.turns,
                        result=result,
                        evidence=data.get("evidence", ""),
                        raw=raw,
                    )
                )
            except (json.JSONDecodeError, KeyError, ValueError, ValidationError) as exc:
                last_turn = segment.turns[-1] if segment.turns else None
                evaluations.append(
                    EvalRecord(
                        turn_index=last_turn.turn_index if last_turn else None,
                        segment_id=segment.segment_id,
                        constraint_text=segment.constraint_text,
                        user_reply=last_turn.user_reply if last_turn else "",
                        agent_reply=last_turn.agent_reply if last_turn else "",
                        segment_turns=segment.turns,
                        result="invalid",
                        evidence=f"评估 JSON 解析失败: {exc}",
                        raw=raw,
                    )
                )
            if progress_callback:
                last = evaluations[-1]
                progress_callback(
                    f"评估 S{segment.segment_id}/{total} "
                    f"【{segment.constraint_text[:30]}】→ {last.result}"
                )

        return evaluations
