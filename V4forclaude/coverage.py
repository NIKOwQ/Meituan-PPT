"""Coverage computation and constraint statistics for V4 dataset collection.

Pure functions with no LLM dependency — independently testable.
"""

from __future__ import annotations

import re
from collections import Counter

from models import (
    ConstraintEvalSummary,
    ConstraintStat,
    EvalRecord,
    OverallScore,
    SegmentRecord,
)


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def _normalize_constraint(text: str) -> str:
    """Normalize constraint text for dedup: strip trailing punctuation and whitespace."""
    return re.sub(r"[。.！!？?；;，,、\s]+$", "", text.strip())


# ---------------------------------------------------------------------------
# Section detection
# ---------------------------------------------------------------------------

_KNOWN_SECTIONS = [
    "Knowledge Points",
    "Knowledge",
    "Opening Line",
    "Opening",
    "Call Flow",
    "Conversation Flow",
    "Constraints",
    "Constraint",
    "Role",
    "Task",
]
_SECTION_RE = re.compile(
    r"#\s+(" + "|".join(re.escape(s) for s in sorted(_KNOWN_SECTIONS, key=len, reverse=True)) + r")\b"
)


def _build_section_hint(instruction: str, stats: list[ConstraintStat]) -> str:
    """Compute per-section coverage and return a hint string for the User LLM."""
    matches = list(_SECTION_RE.finditer(instruction))
    if not matches:
        return "(未检测到段落结构，请自由选择约束)"

    # Build covered position array from all constraint stats
    covered = [False] * len(instruction)
    for stat in stats:
        for span in re.finditer(re.escape(stat.constraint_text), instruction):
            for i in range(span.start(), span.end()):
                covered[i] = True

    # Build content mask (excludes structural text like headers, bullets, step numbers)
    content_mask = _content_mask(instruction)

    # Compute per-section coverage
    parts: list[str] = []
    for i, m in enumerate(matches):
        section_name = m.group(1)
        content_start = m.end()
        content_end = matches[i + 1].start() if i + 1 < len(matches) else len(instruction)
        # Only count content positions (exclude structural markers)
        content_indices = [
            j for j in range(content_start, content_end)
            if content_mask[j]
        ]
        if not content_indices:
            continue
        covered_count = sum(1 for j in content_indices if covered[j])
        pct = int(covered_count / len(content_indices) * 100)
        parts.append(f"{section_name}({pct}%)")

    if not parts:
        return "(未检测到段落结构，请自由选择约束)"

    return " ".join(parts) + "\n请优先测试覆盖率最低的部分。"


# ---------------------------------------------------------------------------
# Content mask (excludes structural text from coverage calculation)
# ---------------------------------------------------------------------------

# Patterns for structural text that should be excluded from coverage calculation
_STRUCTURAL_RE = re.compile(
    r"(?:"
    r"#[^#]*?(?=\s|$)"          # Section headers: # Role, # Task, ...
    r"|\d+\.\s*"                 # Step numbers: 1. 2. 3. 4.
    r"|\-\s+"                    # Bullet markers: - (followed by content)
    r")"
)


def _content_mask(instruction: str) -> list[bool]:
    """Return a boolean mask marking content (non-structural) character positions."""
    # Start with all non-space positions as content
    mask = [not ch.isspace() for ch in instruction]
    # Exclude structural patterns
    for m in _STRUCTURAL_RE.finditer(instruction):
        for i in range(m.start(), m.end()):
            mask[i] = False
    return mask


# ---------------------------------------------------------------------------
# Coverage calculation
# ---------------------------------------------------------------------------

def _coverage(instruction: str, constraints: list[str]) -> tuple[float, dict[str, int]]:
    covered = [False] * len(instruction)
    per_constraint: dict[str, int] = {}

    for constraint in constraints:
        spans = list(re.finditer(re.escape(constraint), instruction))
        span_chars = 0
        for span in spans:
            for i in range(span.start(), span.end()):
                if not covered[i]:
                    covered[i] = True
                    span_chars += 1
                else:
                    span_chars += 1
        per_constraint[constraint] = span_chars

    content_mask = _content_mask(instruction)
    content_positions = [i for i, is_content in enumerate(content_mask) if is_content]
    if not content_positions:
        return 0.0, per_constraint
    covered_content = sum(1 for i in content_positions if covered[i])
    return covered_content / len(content_positions), per_constraint


# ---------------------------------------------------------------------------
# Constraint stats
# ---------------------------------------------------------------------------

def _merge_normalized_counts(counts: Counter[str]) -> Counter[str]:
    """Merge counts for constraints that differ only in trailing punctuation.

    Returns a new Counter where each group is represented by the longest variant.
    """
    groups: dict[str, list[str]] = {}
    for ct in counts:
        key = _normalize_constraint(ct)
        groups.setdefault(key, []).append(ct)

    merged: Counter[str] = Counter()
    for variants in groups.values():
        # Use the longest variant as representative
        representative = max(variants, key=len)
        merged[representative] = sum(counts[v] for v in variants)
    return merged


def _build_stats(
    instruction: str,
    counts: Counter[str],
    min_tests_per_constraint: int,
) -> tuple[float, list[ConstraintStat]]:
    merged = _merge_normalized_counts(counts)
    constraints = list(merged.keys())
    coverage, covered_chars = _coverage(instruction, constraints)
    stats = [
        ConstraintStat(
            constraint_text=constraint,
            count=merged[constraint],
            covered_chars=covered_chars.get(constraint, 0),
            sufficiently_tested=merged[constraint] >= min_tests_per_constraint,
        )
        for constraint in sorted(constraints)
    ]
    return coverage, stats


def _is_complete(
    coverage: float,
    stats: list[ConstraintStat],
    target_coverage: float,
    min_tests_per_constraint: int,
) -> bool:
    if coverage < target_coverage:
        return False
    if not stats:
        return False
    return all(stat.count >= min_tests_per_constraint for stat in stats)


# ---------------------------------------------------------------------------
# Overall score computation
# ---------------------------------------------------------------------------

def _compute_overall_score(
    coverage: float,
    segments: list[SegmentRecord],
    evaluations: list[EvalRecord],
) -> OverallScore:
    """Compute quantifiable summary metrics from segments and evaluations."""
    # Build normalized constraint → representative text + all variants
    # Group by normalized form to merge trailing punctuation variants
    norm_to_variants: dict[str, list[str]] = {}
    for seg in segments:
        ct = seg.constraint_text
        key = _normalize_constraint(ct)
        if ct not in norm_to_variants.get(key, []):
            norm_to_variants.setdefault(key, []).append(ct)

    # Pick longest variant as representative for each group
    norm_to_rep: dict[str, str] = {}
    for key, variants in norm_to_variants.items():
        norm_to_rep[key] = max(variants, key=len)

    # Build eval mapping by normalized key
    eval_by_norm: dict[str, list[EvalRecord]] = {}
    for ev in evaluations:
        key = _normalize_constraint(ev.constraint_text)
        eval_by_norm.setdefault(key, []).append(ev)

    constraint_summaries: list[ConstraintEvalSummary] = []
    total_pass = 0
    total_fail = 0
    total_invalid = 0

    for key in sorted(norm_to_rep):
        rep = norm_to_rep[key]
        variants = norm_to_variants[key]
        evs = eval_by_norm.get(key, [])
        p = sum(1 for e in evs if e.result == "pass")
        f = sum(1 for e in evs if e.result == "fail")
        inv = sum(1 for e in evs if e.result == "invalid")
        total_pass += p
        total_fail += f
        total_invalid += inv
        n_evals = p + f + inv
        rate = p / n_evals if n_evals > 0 else 0.0
        seg_count = sum(1 for s in segments if _normalize_constraint(s.constraint_text) == key)
        constraint_summaries.append(
            ConstraintEvalSummary(
                constraint_text=rep,
                total_segments=seg_count,
                pass_count=p,
                fail_count=f,
                invalid_count=inv,
                pass_rate=round(rate, 4),
            )
        )

    total_evals = total_pass + total_fail + total_invalid
    overall_rate = total_pass / total_evals if total_evals > 0 else 0.0

    return OverallScore(
        total_constraints_tested=len(norm_to_rep),
        total_segments=len(segments),
        total_evaluations=total_evals,
        overall_pass_rate=round(overall_rate, 4),
        coverage=round(coverage, 4),
        constraint_eval_summaries=constraint_summaries,
    )
