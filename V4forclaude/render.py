"""Report rendering and artifact persistence for V4 dataset collection."""

from __future__ import annotations

import json
from pathlib import Path

from models import EvalRecord, V4DatasetReport


def save_report(report: V4DatasetReport, output_path: str | Path) -> Path:
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report.model_dump_json(indent=2), encoding="utf-8")
    return out


def save_artifacts(report: V4DatasetReport, output_path: str | Path) -> Path:
    """Save split artifacts beside the main report for uncertainty tracing."""

    out = Path(output_path)
    artifacts = out.with_suffix("")
    artifacts = artifacts.parent / f"{artifacts.name}_artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)

    (artifacts / "00_cleaned_instruction.txt").write_text(
        report.cleaned_instruction, encoding="utf-8"
    )
    (artifacts / "00b_opening_lines.json").write_text(
        json.dumps(report.opening_lines, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (artifacts / "01_constraint_stats.json").write_text(
        json.dumps(
            [stat.model_dump() for stat in report.constraint_stats],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (artifacts / "02_turns.json").write_text(
        json.dumps(
            [turn.model_dump() for turn in report.turns],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (artifacts / "02a_conversation_groups.json").write_text(
        json.dumps(
            [group.model_dump() for group in report.conversation_groups],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (artifacts / "03_evaluations.json").write_text(
        json.dumps(
            [ev.model_dump() for ev in report.evaluations],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (artifacts / "03b_segments.json").write_text(
        json.dumps(
            [segment.model_dump() for segment in report.segments],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (artifacts / "04_diagnostics.json").write_text(
        json.dumps(report.diagnostics, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (artifacts / "summary.md").write_text(render_report(report), encoding="utf-8")
    return artifacts


def render_report(report: V4DatasetReport) -> str:
    lines: list[str] = []
    lines.append("=" * 80)
    lines.append("V4 Agent 长指令遵循能力测试报告")
    lines.append("=" * 80)
    lines.append(f"来源: {report.source_file}")
    lines.append(f"完成原因: {report.completion_reason}")
    lines.append(
        f"对话组: {len(report.conversation_groups)}; 轮数: {len(report.turns)}; "
        f"测试片段: {len(report.segments)}; "
        f"并行对话: {report.parallel_conversations}; "
        f"耗时: {report.elapsed_seconds:.1f}s"
    )
    lines.append(
        f"覆盖率: {report.coverage:.2%} / 目标 {report.target_coverage:.2%}; "
        f"每条最少测试 {report.min_tests_per_constraint} 次"
    )

    # ── Overall Score ──
    score = report.overall_score
    if score:
        lines.append("")
        lines.append("=" * 80)
        lines.append("总体评分")
        lines.append("=" * 80)
        lines.append(f"  约束覆盖率:     {score.coverage:.2%}")
        lines.append(f"  已测试约束数:   {score.total_constraints_tested}")
        lines.append(f"  测试片段总数:   {score.total_segments}")
        lines.append(f"  评估片段总数:   {score.total_evaluations}")
        if score.total_evaluations > 0:
            bar_len = 40
            filled = int(score.overall_pass_rate * bar_len)
            bar = "█" * filled + "░" * (bar_len - filled)
            lines.append(f"  总通过率:       {score.overall_pass_rate:.1%}  [{bar}]")
            lines.append(f"  总失败率:       {1 - score.overall_pass_rate:.1%}")
        else:
            lines.append(f"  总通过率:       N/A（未启用评估）")

        # Per-constraint eval summary
        if score.constraint_eval_summaries:
            lines.append("")
            lines.append("  逐约束评估明细:")
            lines.append(f"  {'约束':<50s} {'片段':>4s} {'通过':>4s} {'失败':>4s} {'无效':>4s} {'通过率':>6s}")
            lines.append("  " + "-" * 76)
            for cs in score.constraint_eval_summaries:
                text = cs.constraint_text
                if len(text) > 48:
                    text = text[:45] + "..."
                has_eval = cs.pass_count + cs.fail_count + cs.invalid_count > 0
                rate_str = f"{cs.pass_rate:.0%}" if has_eval else "N/A"
                lines.append(
                    f"  {text:<50s} {cs.total_segments:>4d} "
                    f"{cs.pass_count:>4d} {cs.fail_count:>4d} {cs.invalid_count:>4d} "
                    f"{rate_str:>6s}"
                )

    # ── Constraint Stats ──
    lines.append("")
    lines.append("=" * 80)
    lines.append("约束统计（覆盖率 + 测试次数）")
    lines.append("=" * 80)
    if not report.constraint_stats:
        lines.append("  无")
    for stat in report.constraint_stats:
        mark = "✓" if stat.sufficiently_tested else "✗"
        text = stat.constraint_text
        if len(text) > 80:
            text = text[:77] + "..."
        lines.append(f"  [{mark}] count={stat.count}, chars={stat.covered_chars}: {text}")

    # ── Conversation Groups ──
    lines.append("")
    lines.append("=" * 80)
    lines.append("对话组详情")
    lines.append("=" * 80)
    if not report.conversation_groups:
        lines.append("  无")
    for group in report.conversation_groups:
        lines.append(
            f"\n  C{group.conversation_id}: turns={len(group.turns)}, "
            f"segments={len(group.segments)}, reason={group.completion_reason}"
        )
        if group.opening_line:
            lines.append(f"    开场白: {group.opening_line[:120]}")
        for turn in group.turns[:15]:
            label = turn.constraint_text[:60] if turn.constraint_text else "(桥接)"
            gate_sym = "✓" if turn.user_gate.result == "pass" else "✗"
            lines.append(f"    T{turn.local_turn_index} {gate_sym}: {label}")
            lines.append(f"      User:  {turn.user_reply[:100]}")
            lines.append(f"      Agent: {turn.agent_reply[:100]}")
        if len(group.turns) > 15:
            lines.append(f"    ... 省略 {len(group.turns) - 15} 轮")
        if group.segments:
            lines.append("    测试片段:")
            for segment in group.segments[:10]:
                lines.append(
                    f"      S{segment.segment_id} turns={len(segment.turns)} "
                    f"reason={segment.complete_reason}: {segment.constraint_text[:70]}"
                )
            if len(group.segments) > 10:
                lines.append(f"      ... 省略 {len(group.segments) - 10} 个片段")

    # ── Segments + Evaluation ──
    lines.append("")
    lines.append("=" * 80)
    lines.append("测试片段 + 评估结果")
    lines.append("=" * 80)
    if not report.segments:
        lines.append("  无")
    # Build eval lookup for quick access
    eval_by_segment: dict[int, EvalRecord] = {}
    for ev in report.evaluations:
        if ev.segment_id is not None:
            eval_by_segment[ev.segment_id] = ev

    for segment in report.segments[:30]:
        ev = eval_by_segment.get(segment.segment_id)
        if ev:
            sym = "✓" if ev.result == "pass" else "✗" if ev.result == "fail" else "?"
            eval_str = f" {sym} {ev.result} — {ev.evidence[:80]}"
        else:
            eval_str = " (未评估)"
        lines.append(
            f"\n  S{segment.segment_id} [C{segment.conversation_id}] "
            f"turns={len(segment.turns)} reason={segment.complete_reason}{eval_str}"
        )
        lines.append(f"    约束: {segment.constraint_text[:100]}")
        for item in segment.turns:
            lines.append(f"    User:  {item.user_reply[:100]}")
            lines.append(f"    Agent: {item.agent_reply[:100]}")

    if len(report.segments) > 30:
        lines.append(f"\n  ... 省略 {len(report.segments) - 30} 个片段")

    # ── Diagnostics ──
    lines.append("")
    lines.append("=" * 80)
    lines.append("诊断信息")
    lines.append("=" * 80)
    if not report.diagnostics:
        lines.append("  无")
    for item in report.diagnostics[-30:]:
        lines.append(f"  - {item}")
    return "\n".join(lines)
