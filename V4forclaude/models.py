"""Data models for the V4 active constraint dataset experiment."""

from typing import Literal

from pydantic import BaseModel, Field


class UserCandidate(BaseModel):
    """A proposed user message and the exact instruction constraint it targets."""

    constraint_text: str = ""
    user_reply: str = ""
    rationale: str = ""
    multi_turn: Literal["none", "need", "continue", "done"] = "none"
    end: bool = False


class GateCheck(BaseModel):
    """Gate result for a generated user candidate."""

    result: Literal["pass", "fail"]
    evidence: str = ""


class ConstraintStat(BaseModel):
    """Coverage and test count for one exact constraint string."""

    constraint_text: str
    count: int = 0
    covered_chars: int = 0
    sufficiently_tested: bool = False


class TurnRecord(BaseModel):
    """One collected user-agent interaction targeted at one constraint."""

    turn_index: int
    conversation_id: int = 0
    local_turn_index: int = 0
    constraint_text: str
    user_reply: str
    agent_reply: str
    history_before: list[dict] = Field(default_factory=list)
    user_llm_raw: str = ""
    user_gate: GateCheck
    code_gate_errors: list[str] = Field(default_factory=list)
    multi_turn: Literal["none", "need", "continue", "done"] = "none"
    segment_id: int | None = None
    is_test_turn: bool = True


class SegmentTurn(BaseModel):
    """One user-agent pair inside a test segment."""

    turn_index: int
    conversation_id: int = 0
    local_turn_index: int = 0
    user_reply: str
    agent_reply: str


class SegmentRecord(BaseModel):
    """One evaluation sample, possibly composed of multiple turns."""

    segment_id: int
    conversation_id: int = 0
    constraint_text: str
    history_before: list[dict] = Field(default_factory=list)
    turns: list[SegmentTurn] = Field(default_factory=list)
    complete_reason: str = ""


class ConversationGroup(BaseModel):
    """One complete continuous conversation episode."""

    conversation_id: int = 0
    opening_line: str = ""
    turns: list[TurnRecord] = Field(default_factory=list)
    segments: list[SegmentRecord] = Field(default_factory=list)
    completion_reason: str = ""
    diagnostics: list[str] = Field(default_factory=list)


class EvalRecord(BaseModel):
    """LLM evaluation for one collected interaction."""

    turn_index: int | None = None
    segment_id: int | None = None
    constraint_text: str
    user_reply: str
    agent_reply: str
    segment_turns: list[SegmentTurn] = Field(default_factory=list)
    result: Literal["pass", "fail", "invalid"]
    evidence: str = ""
    raw: str = ""


class ConstraintEvalSummary(BaseModel):
    """Per-constraint evaluation summary: how many segments tested and passed."""

    constraint_text: str
    total_segments: int = 0
    pass_count: int = 0
    fail_count: int = 0
    invalid_count: int = 0
    pass_rate: float = 0.0  # pass / (pass + fail + invalid), 0.0 if no evals


class OverallScore(BaseModel):
    """Top-level quantifiable metrics for the entire run."""

    total_constraints_tested: int = 0
    total_segments: int = 0
    total_evaluations: int = 0
    overall_pass_rate: float = 0.0
    coverage: float = 0.0
    constraint_eval_summaries: list[ConstraintEvalSummary] = Field(default_factory=list)


class V4DatasetReport(BaseModel):
    """Full V4 run output."""

    source_file: str = ""
    completion_reason: str = ""
    target_coverage: float = 0.9
    min_tests_per_constraint: int = 5
    max_turns: int = 100
    parallel_conversations: int = 5
    elapsed_seconds: float = 0.0
    coverage: float = 0.0
    opening_line: str = ""
    opening_lines: list[str] = Field(default_factory=list)
    cleaned_instruction: str = ""
    constraint_stats: list[ConstraintStat] = Field(default_factory=list)
    conversation_groups: list[ConversationGroup] = Field(default_factory=list)
    turns: list[TurnRecord] = Field(default_factory=list)
    segments: list[SegmentRecord] = Field(default_factory=list)
    evaluations: list[EvalRecord] = Field(default_factory=list)
    diagnostics: list[str] = Field(default_factory=list)
    overall_score: OverallScore | None = None
