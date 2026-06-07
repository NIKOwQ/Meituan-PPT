# V4 Agent 长指令遵循能力测试系统 — 开发文档

> 最后更新：2026-06-06 | 代码版本：V4forclaude/

---

## 1. 项目概述

### 1.1 目标

构建一套自动化测试系统，评估 AI Agent 遵循长指令的能力。系统接入「原始长指令」和「Agent」，通过多轮对话主动测试指令中的各类约束，输出**可量化、高透明**的测试报告。

### 1.2 核心思路

不预先解析指令结构（V1-V3 方案），而是让 **User LLM 直接从原始长指令中选取可测试的约束文本片段**，生成自然用户消息去触发，通过双重门控验证后提交给 Agent，最后由 Eval LLM 判断 Agent 是否遵守。

### 1.3 系统架构图

```
┌──────────────────────────────────────────────────────────────┐
│                        CLI 入口                               │
│                  run_v4_dataset.py                            │
│    --instruction --max-turns --min-tests --coverage           │
│    --parallel --evaluate --targeted-threshold                 │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    V4Collector.collect()                      │
│                                                               │
│  ┌─ 循环批次 ──────────────────────────────────────────────┐  │
│  │                                                          │  │
│  │  ① 计算覆盖率/未充分约束 → 决定定向 vs 自由组比例        │  │
│  │                                                          │  │
│  │  ② ThreadPoolExecutor 并行派发对话组                     │  │
│  │     ┌──────────────────────────────┐                     │  │
│  │     │ _run_conversation_group()    │                     │  │
│  │     │                              │                     │  │
│  │     │  Agent 开场白                │                     │  │
│  │     │  ┌── 每轮循环 ──────────┐    │                     │  │
│  │     │  │                      │    │                     │  │
│  │     │  │ _next_user_candidate │    │                     │  │
│  │     │  │   ↓                  │    │                     │  │
│  │     │  │ 代码门控 (3级拦截)   │    │                     │  │
│  │     │  │   ↓                  │    │                     │  │
│  │     │  │ LLM 门控             │    │                     │  │
│  │     │  │   ↓                  │    │                     │  │
│  │     │  │ Agent 回复           │    │                     │  │
│  │     │  │   ↓                  │    │                     │  │
│  │     │  │ Segment 收束         │    │                     │  │
│  │     │  └──────────────────────┘    │                     │  │
│  │     └──────────────────────────────┘                     │  │
│  │                                                          │  │
│  │  ③ 合并结果 → 覆盖率/约束统计 → 退出检查                │  │
│  │  ④ 中间报告保存                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                               │
│  ⑤ 可选：evaluate_report() 对每个 segment 评估               │
│  ⑥ 输出 V4DatasetReport                                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 文件职责

| 文件 | 行数 | 职责 | 依赖 |
|---|---|---|---|
| `prompts.py` | ~258 | Prompt 模板常量（8 个 prompt + END_TOKEN） | — |
| `coverage.py` | ~266 | 覆盖率计算、约束统计、段落覆盖率提示（纯函数，无 LLM 依赖） | `models.py` |
| `collector.py` | ~879 | 核心编排：V4Collector 类 + LLM/门控辅助函数 | `prompts.py`, `coverage.py`, `render.py`, `models.py`, `agent.py`, `llm_utils.py` |
| `render.py` | ~224 | 报告渲染（终端输出）+ 持久化（JSON + artifacts） | `models.py` |
| `models.py` | 140 | Pydantic 数据模型（10 个模型类） | `pydantic` |
| `run_v4_dataset.py` | 80 | CLI 入口：参数解析、调用 collect()、保存报告 | `collector.py`, `render.py` |
| `agent.py` | 42 | FlowAgent：接收长指令 + 对话历史，返回单条回复 | `llm_utils.py` |
| `llm_utils.py` | 81 | 共享工具：OpenAI 客户端创建 + JSON 提取/修复 | `openai`, `python-dotenv` |
| `.env` | — | LLM API 配置：`DG_LLM_API_KEY`, `DG_LLM_BASE_URL`, `DG_LLM_MODEL` | — |
| `data/` | — | 样本长指令（`.md` 格式） | — |

---

## 3. 数据模型（models.py）

所有模型继承 Pydantic `BaseModel`，支持 `model_dump_json()` / `model_validate_json()`。

### 3.1 模型一览

```
UserCandidate          # User LLM 的单次输出
├── constraint_text    #   选取的约束原文（逐字复制）
├── user_reply         #   生成的用户消息
├── rationale          #   为什么能测试该约束
├── multi_turn         #   none | need | continue | done
└── end                #   是否结束对话

GateCheck              # 门控结果
├── result             #   pass | fail
└── evidence           #   判断理由

SegmentTurn            # 片段内单轮交互
├── turn_index / local_turn_index
├── user_reply / agent_reply
└── conversation_id

SegmentRecord          # 一个测试片段（可能多轮）
├── segment_id / conversation_id
├── constraint_text    #   被测试的约束原文
├── history_before     #   片段前的对话历史
├── turns              #   片段内的轮次列表
└── complete_reason    #   none | done | max_pending_turns | conversation_ended_early

TurnRecord             # 一次完整的 user → gate → agent 交互
├── turn_index / conversation_id / local_turn_index
├── constraint_text / user_reply / agent_reply
├── user_gate / code_gate_errors
├── multi_turn / segment_id / is_test_turn
└── history_before / user_llm_raw

EvalRecord             # LLM 评估结果
├── turn_index / segment_id / constraint_text
├── result             #   pass | fail | invalid
├── evidence / raw
└── segment_turns

ConstraintStat         # 单条约束的统计
├── constraint_text
├── count / covered_chars
└── sufficiently_tested

ConstraintEvalSummary  # 单条约束的评估汇总
├── constraint_text
├── total_segments / pass_count / fail_count / invalid_count
└── pass_rate

OverallScore           # 总体评分
├── total_constraints_tested / total_segments / total_evaluations
├── overall_pass_rate / coverage
└── constraint_eval_summaries

ConversationGroup      # 一次完整对话组
├── conversation_id / opening_line
├── turns / segments
├── completion_reason
└── diagnostics

V4DatasetReport        # 完整报告
├── source_file / completion_reason / target_coverage / min_tests_per_constraint
├── max_turns / parallel_conversations / elapsed_seconds / coverage
├── opening_line / opening_lines / cleaned_instruction
├── constraint_stats / conversation_groups / turns / segments
├── evaluations / diagnostics
└── overall_score
```

### 3.2 multi_turn 状态机

```
自由发现模式（USER_PROMPT / TARGET_USER_PROMPT）:
    none  ─→ 独立测试，本轮收束为 segment
    need  ─→ 多轮测试第一步，开启 pending segment

多轮承接模式（CONTINUE_USER_PROMPT）:
    continue ─→ 继续承接，pending segment 保持
    done     ─→ 测试完成，收束 pending segment

自动收束：pending segment 达到 max_pending_turns 或对话结束时自动收束
```

---

## 4. Prompt 体系（prompts.py）

系统共有 **8 个 Prompt**，分属 3 个角色：

### 4.1 User LLM（生成测试消息）

| Prompt | 触发条件 | 模板变量 |
|---|---|---|
| `USER_SYSTEM` (3行) | 始终作为 system prompt | — |
| `USER_PROMPT` (85行) | 自由发现模式 | instruction, tested_constraints, failed_constraints, over_test_threshold, over_tested_global, section_hint, retry_feedback, masked_instruction, history |
| `CONTINUE_USER_PROMPT` (32行) | 多轮承接模式（pending_constraint 非空） | instruction, retry_feedback, history, pending_constraint |
| `TARGET_USER_PROMPT` (34行) | 定向补充模式（target_constraints 非空） | instruction, target_constraints, tested_constraints, failed_constraints, retry_feedback, history |

**三路选择逻辑**（`_next_user_candidate`）：
```
if pending_constraint:
    → CONTINUE_USER_PROMPT    # 多轮承接优先
elif target_constraints:
    → TARGET_USER_PROMPT      # 定向补充
else:
    → USER_PROMPT             # 自由发现
```

**USER_PROMPT 约束发现策略**（6 类）：
- Role 测试：诱导偏离角色
- Task 测试：诱导执行职责外任务
- Call Flow 测试：测试流程遵循
- Knowledge 测试：提问检查知识准确性
- Opening Line 测试：测试开场白行为
- Explicit Constraints 测试：直接触发显式约束

### 4.2 Gate LLM（验证测试消息）

| Prompt | 触发条件 | 模板变量 |
|---|---|---|
| `GATE_SYSTEM` (2行) | 始终 | — |
| `GATE_PROMPT` (21行) | 代码门控通过后 | instruction, history, constraint_text, user_reply |

### 4.3 Eval LLM（评估 Agent 回复）

| Prompt | 触发条件 | 模板变量 |
|---|---|---|
| `EVAL_SYSTEM` (2行) | 始终 | — |
| `EVAL_PROMPT` (17行) | evaluate=True 时对每个 segment | instruction, constraint_text, history_before, segment_turns |

---

## 5. 门控机制

### 5.1 代码门控（`_code_gate`）

在 LLM 生成候选消息后、LLM 门控前执行。检查项：

| 检查 | 错误消息 | 适用模式 |
|---|---|---|
| user_reply 为空 | "缺少 user_reply" | 全部 |
| constraint_text 不在指令原文中 | "不是清洗后长指令中的精确连续原文" | 全部 |
| constraint_text 在 tested_in_conversation 中 | "已经测试过" | 自由发现 |
| 标准化后在 tested_in_conversation 中 | "等价变体（忽略末尾标点差异）" | 自由发现 |
| user_reply 包含 `<end>` | "user_reply 不能包含结束符" | 全部 |

### 5.2 代码拦截（`_next_user_candidate` 中 _code_gate 之后）

| 检查 | 错误消息 | 条件 |
|---|---|---|
| 本对话门控已失败过 | "门控已失败过" | failed_constraints 非空 |
| 全局已过度测试 | "全局已过度测试" | over_tested_global 非空 |
| 不在目标约束列表 | "不在目标约束列表中" | target_constraints 非空 |

### 5.3 LLM 门控（`_llm_gate`）

代码门控通过后，调用 GATE_PROMPT 判断用户消息是否真的能测试声称的约束。支持空约束（bridge turn，自动 pass）。

### 5.4 重试反馈（retry_feedback）

代码门控失败时，根据失败原因给出不同的反馈：

| 失败原因 | 反馈内容 |
|---|---|
| "已经测试过" / "门控已失败过" / "全局已过度测试" | "请选择一条完全不同的、尚未测试过的约束" |
| "不在目标约束列表" | "请仅从「待补充测试的约束」列表中选择一条" |
| "不是清洗后长指令" | "请确保 constraint_text 是原始长指令中的精确连续原文" |
| 其他 | "请重新生成" |

LLM 门控失败时：
> "请换一条能更明确触发或检验该约束的用户消息，必要时更换约束。"

### 5.5 跳过机制

门控重试耗尽时不终止对话，而是跳过本轮继续：
- `consecutive_skips` 计数器 +1
- 连续 3 次跳过 → 终止对话（`user_gate_failed`）
- 任何一次门控通过 → 重置计数器

---

## 6. 覆盖率计算

### 6.1 结构性文本排除

`_content_mask()` 排除不可测试的结构性文本：

| 排除模式 | 正则 | 示例 |
|---|---|---|
| Section 头 | `#[^#]*?(?=\s\|$)` | `# Role`, `# Task`, `# Call Flow` |
| 步骤编号 | `\d+\.\s*` | `1.`, `2.`, `3.`, `4.` |
| 列表标记 | `\-\s+` | `- ` |

覆盖率分母 = **内容字符位总数**（排除结构性文本 + 空白），不是非空字符总数。

### 6.2 约束标准化去重

`_normalize_constraint()` 去除末尾标点差异：
```python
re.sub(r"[。.！!？?；;，,、\s]+$", "", text.strip())
```

`_merge_normalized_counts()` 将标准化后相同的约束合并为一组，取最长变体为代表，测试次数累加。

### 6.3 段落覆盖率提示

`_build_section_hint()` 按 `# Section` 头分割指令，计算每个段落的覆盖率百分比，注入到 USER_PROMPT 中引导 LLM 优先选低覆盖段落的约束。

---

## 7. 对话组编排

### 7.1 批次循环（`collect`）

```
for batch_idx in 1..max_batches:
    ① 计算当前 insufficient 约束
    ② 覆盖率 ≥ targeted_threshold 且 insufficient 非空 → 开启定向模式
    ③ 派发 parallel_conversations 组对话（前 n//2 定向，后 n//2 自由）
    ④ 合并结果，更新 stats/coverage
    ⑤ 中间报告保存
    ⑥ 退出检查
```

### 7.2 退出条件（优先级从高到低）

| 条件 | completion_reason |
|---|---|
| 覆盖率 ≥ target 且所有约束 ≥ min_tests | `coverage_and_min_tests_reached` |
| 所有约束充分测试 + 连续 N 批覆盖率不涨 | `stale_and_sufficient_stopped` |
| 覆盖率和测试次数同时停滞 N 批 | `stale_but_insufficient_stopped` |
| 达到 max_batches 上限 | `max_batches_reached` |

`stale_batches_limit` 默认 = 3。

### 7.3 定向补充模式

**触发**：`coverage ≥ targeted_threshold`（默认 0.5）且有 `insufficient` 约束。

**机制**：
- 每批前 `parallel // 2` 组使用 TARGET_USER_PROMPT，仅从 insufficient 约束列表中选题
- 后 `parallel // 2` 组继续自由发现，可能发现新约束
- insufficient 为空时自动关闭；新约束出现但未充分测试时自动重开

### 7.4 中间报告保存

每批完成后自动保存中间报告和 artifacts 到 output 目录。用户可随时 Ctrl+C 中断，已收集数据不丢失。

---

## 8. "不要选择"注入

USER_PROMPT 和 TARGET_USER_PROMPT 都包含"约束选择限制"段落，列出不应选择的约束：

| 列表 | 范围 | 代码拦截 |
|---|---|---|
| tested_constraints | 单组对话 | ✅ `_code_gate` |
| failed_constraints | 单组对话 | ✅ `_next_user_candidate` 附加检查 |
| over_tested_global（≥ min_tests × 4） | 全部对话 | ✅ `_next_user_candidate` 附加检查 |

LLM 如果无视 prompt 选了这些约束，会被代码拦截并给出对应重试反馈。

---

## 9. 报告输出

### 9.1 量化指标

```
总体评分:
  约束覆盖率:     64.66%        # 已测试约束覆盖长指令内容字符的比例
  已测试约束数:   17            # 去重后的独立约束数量
  测试片段总数:   74            # 成功通过门控的 segment 数
  评估片段总数:   74            # Eval LLM 评估的 segment 数
  总通过率:       77.0%         # pass / (pass + fail + invalid)
```

### 9.2 逐约束明细

```
约束                                          片段  通过  失败  无效  通过率
告知骑手今天飞毛腿合同已生效...                   8     8     0     0   100%
如果骑手坚持确实无法配送...                       10    3     7     0    30%  ← Agent 弱点
```

### 9.3 输出产物

```
output/<timestamp>_<stem>/
├── report.json                      # 完整报告（V4DatasetReport JSON）
└── report_artifacts/
    ├── 00_cleaned_instruction.txt    # 清洗后的长指令
    ├── 00b_opening_lines.json        # Agent 开场白列表
    ├── 01_constraint_stats.json      # 约束覆盖统计
    ├── 02_turns.json                 # 所有对话轮次详情
    ├── 02a_conversation_groups.json  # 对话组
    ├── 03_evaluations.json           # 评估结果
    ├── 03b_segments.json             # 测试片段
    ├── 04_diagnostics.json           # 诊断信息
    └── summary.md                    # 人类可读报告
```

---

## 10. 运行命令

### 10.1 环境配置

```bash
# .env 文件
DG_LLM_API_KEY=your-api-key
DG_LLM_BASE_URL=https://your-api-endpoint
DG_LLM_MODEL=gpt-4o
```

### 10.2 常用命令

```bash
# 完整测试（推荐生产用）
uv run python run_v4_dataset.py data/sample_instruction_rider.md \
    --max-turns 100 --min-tests 5 --coverage 0.9 --parallel 5 --evaluate

# 快速冒烟测试
uv run python run_v4_dataset.py data/sample_instruction_rider.md \
    --max-turns 5 --min-tests 1 --coverage 0.3 --parallel 2 --evaluate

# 启用定向补充（覆盖率 ≥ 50% 后自动开启）
uv run python run_v4_dataset.py data/sample_instruction_rider.md \
    --max-turns 30 --min-tests 5 --coverage 0.9 --parallel 5 \
    --evaluate --targeted-threshold 0.5

# 只收集数据集，不评估
uv run python run_v4_dataset.py data/sample_instruction_merchant.md \
    -o output/merchant_report.json --max-turns 10 --parallel 3
```

### 10.3 参数说明

| 参数 | 默认值 | 说明 |
|---|---|---|
| `instruction` | — | 长指令 Markdown 文件路径（必填） |
| `-o / --output` | 自动生成 | 输出 JSON 路径 |
| `--max-turns` | 100 | 每组对话最大轮数 |
| `--max-retries` | 3 | 每轮门控重试次数 |
| `--max-pending-turns` | 3 | 多轮约束最大轮数 |
| `--coverage` | 0.9 | 目标覆盖率 |
| `--min-tests` | 5 | 每条约束最少测试次数 |
| `--parallel` | 5 | 每批并行对话组数 |
| `--evaluate` | off | 启用 LLM 评估 |
| `--targeted-threshold` | 0.5 | 覆盖率达到此值后开启定向补充 |

---

## 11. 依赖

```
Python 3.12+
openai >= 2.38
python-dotenv >= 1.2
pydantic（openai 传递依赖）
```

包管理使用 `uv`，无需手动安装依赖。

---

## 12. 关键设计决策

| 决策 | 原因 |
|---|---|
| 不预解析指令结构 | V1-V3 的 node-edge 解析不稳定；直接用原文更鲁棒 |
| 代码门控 + LLM 门控双重验证 | 代码门控拦截机械错误（子串/去重），LLM 门控拦截语义错误（消息不适配） |
| 标准化去重 | 同一约束可能被选为"文本。"和"文本"（末尾标点不同），需合并 |
| 排除结构性文本计算覆盖率 | `# Section`、`1.`、`- ` 不可测试，不应影响覆盖率 |
| 定向补充模式 | 自由发现后期 LLM 总选已测约束；定向组强制选题，7批达标 vs 20+批卡住 |
| 中间报告保存 | Ctrl+C 不丢数据 |
| 跳过机制 | 门控失败不立即终止对话，连续3次才停，更充分利用对话上下文 |
| 多模块拆分 | 原 pipeline.py（1532行）拆为 prompts/coverage/collector/render 四个模块，职责单一 |
