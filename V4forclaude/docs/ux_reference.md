# V4 系统 UX 参考文档

> 本文档为 UX 设计提供系统行为的完整信息——数据结构、数据流、状态机、实时事件、错误场景。
> 不涉及 UI 应该怎么设计，而是回答"系统有哪些数据可以展示"。

---

## 1. 系统一句话描述

系统自动测试 AI Agent 是否遵守长指令：模拟多个真实用户与 Agent 对话，挑选指令中的约束规则去触发，最后由 LLM 评判 Agent 是否违规。

**输入：** 一份长指令 Markdown 文件（如"你是美团骑手站长，致电骑手通知合同签署…"）
**输出：** 一份结构化 JSON 报告 + 人类可读摘要，包含量化评分和逐条约束明细。

---

## 2. 端到端数据流

```
用户上传长指令 .md 文件
        │
        ▼
┌─────────────────────────────────────────┐
│  collect() — 批次循环                     │
│                                          │
│  ┌─── 批次 1 ────────────────────────┐   │
│  │                                    │   │
│  │  ┌─ 对话组 0 ─┐ ┌─ 对话组 1 ─┐    │   │   ← 并行 N 组
│  │  │  Agent 开场  │ │  Agent 开场  │    │   │
│  │  │  T1: 用户→门控→Agent          │    │   │
│  │  │  T2: 用户→门控→Agent          │    │   │
│  │  │  ...                          │    │   │
│  │  └────────────┘ └────────────┘    │   │
│  │                                    │   │
│  │  合并结果 → 计算覆盖率 → 保存中间报告  │   │
│  └────────────────────────────────────┘   │
│                                          │
│  ┌─── 批次 2 ────────────────────────┐   │
│  │  ...（同上）                       │   │
│  └────────────────────────────────────┘   │
│                                          │
│  ... 直到达标或停滞                        │
│                                          │
│  可选：evaluate_report() 逐 segment 评估   │
└──────────────────┬──────────────────────┘
                   │
                   ▼
            V4DatasetReport (JSON)
```

### 2.1 用户能看到什么（实时）

每次 `progress_callback` 触发时输出一条消息，按时间顺序：

| 时机 | 消息示例 |
|---|---|
| 开始 | `[  0.0s] 开始循环派发对话组（每批 3 组，每组最多 10 turns，目标覆盖率 30%）。` |
| 每批开始 | `[  5.0s] === 第 2 批（共 3 组）===` |
| 定向分配 | `[  5.0s]   → 定向组 [3, 4]，目标: [...]` |
| 对话组完成 | `[ 15.0s] C3 完成：turns=6, segments=5, reason=user_llm_end 【定向】` |
| 覆盖率更新 | `[ 20.0s] 覆盖率: 23.78% \| 约束: 8 种 \| 片段: 51 \| 充分测试: 5/8` |
| 中间报告 | `[ 20.0s] 中间报告已保存到 output/...` |
| 退出 | `[ 20.0s] ✓ 覆盖率和测试次数均达标！` 或 `[ 20.0s] 连续 3 批覆盖率无提升…` |
| 评估开始 | `[ 20.0s] 开始评估已收集 segments。` |

**关键指标（每批更新）：**
- 覆盖率百分比
- 已发现约束种类数
- 测试片段总数
- 充分测试 / 总约束数

---

## 3. 核心实体与关系

```
V4DatasetReport
├── source_file, completion_reason, elapsed_seconds
├── coverage (float, 0~1)
├── cleaned_instruction (str, 单行长指令原文)
├── opening_lines: list[str]            ← 所有不同的 Agent 开场白
│
├── constraint_stats: list[ConstraintStat]    ← 每条约束的覆盖统计
│   ├── constraint_text (str)
│   ├── count (int)                           ← 测试次数
│   ├── covered_chars (int)                   ← 覆盖的字符数
│   └── sufficiently_tested (bool)            ← count ≥ min_tests
│
├── conversation_groups: list[ConversationGroup]  ← 对话组
│   ├── conversation_id (int)
│   ├── opening_line (str)
│   ├── completion_reason (str)
│   ├── turns: list[TurnRecord]                   ← 组内所有轮次
│   │   ├── turn_index (int, 全局编号)
│   │   ├── local_turn_index (int, 组内编号)
│   │   ├── constraint_text (str, 空=桥接轮)
│   │   ├── user_reply, agent_reply (str)
│   │   ├── user_gate: {result, evidence}
│   │   ├── code_gate_errors: list[str]
│   │   ├── multi_turn: "none"|"need"|"continue"|"done"
│   │   ├── segment_id (int|null)
│   │   └── is_test_turn (bool)
│   └── segments: list[SegmentRecord]              ← 组内测试片段
│
├── segments: list[SegmentRecord]          ← 全局所有测试片段（跨组）
│   ├── segment_id (int)
│   ├── conversation_id (int)
│   ├── constraint_text (str)
│   ├── history_before: list[dict]         ← 片段开始前的对话
│   ├── turns: list[SegmentTurn]           ← 片段内的轮次
│   │   ├── user_reply, agent_reply
│   │   └── turn_index, local_turn_index
│   └── complete_reason: "none"|"done"|"max_pending_turns"|"conversation_ended_early"
│
├── evaluations: list[EvalRecord]          ← 评估结果（如启用）
│   ├── segment_id, constraint_text
│   ├── user_reply, agent_reply
│   ├── result: "pass"|"fail"|"invalid"
│   └── evidence (str, 判断依据)
│
└── overall_score: OverallScore
    ├── total_constraints_tested (int)
    ├── total_segments, total_evaluations (int)
    ├── overall_pass_rate (float, 0~1)
    ├── coverage (float, 0~1)
    └── constraint_eval_summaries: list[ConstraintEvalSummary]
        ├── constraint_text
        ├── total_segments, pass/fail/invalid_count
        └── pass_rate (float)
```

### 3.1 实体关系图

```
ConversationGroup 1──N TurnRecord
ConversationGroup 1──N SegmentRecord (组内视角)

TurnRecord N──0..1 SegmentRecord (通过 segment_id 关联)
                    ↑ is_test_turn=true 的 turn 才关联 segment

SegmentRecord 1──1 EvalRecord (如启用评估，通过 segment_id 关联)
SegmentRecord 1──N SegmentTurn (片段内轮次，是 TurnRecord 的子集)

ConstraintStat     ← 按 constraint_text 汇总 SegmentRecord 的 count
ConstraintEvalSummary  ← 按 constraint_text 汇总 EvalRecord 的 pass/fail
```

---

## 4. 状态机

### 4.1 报告级生命周期

```
                    ┌──────────────────────────────────────┐
                    │           collect() 循环              │
                    │                                      │
running ──────────► │  batch 1 → batch 2 → ... → batch N   │
                    │          │                            │
                    │          ▼                            │
                    │  退出条件命中                          │
                    └──────┬───────────────────────────────┘
                           │
              ┌────────────┼────────────────────┐─────────────────┐
              ▼            ▼                    ▼                 ▼
     coverage_and_    stale_and_        stale_but_         max_batches_
     min_tests_       sufficient_       insufficient_      reached
     reached          stopped           stopped

可选: evaluate_report() → 填充 evaluations + overall_score
```

**completion_reason 所有值：**

| 值 | 含义 |
|---|---|
| `coverage_and_min_tests_reached` | ✅ 覆盖率 + 每条约束测试次数都达标 |
| `stale_and_sufficient_stopped` | ⚠️ 覆盖率不涨了，但所有约束都充分测试了 |
| `stale_but_insufficient_stopped` | ❌ 覆盖率和测试次数都停滞，有些约束 LLM 怎么也触发不了 |
| `stale_coverage_stopped` | ❌ 旧版原因（等同于 stale_but_insufficient_stopped） |
| `max_batches_reached` | ⏰ 达到批次上限 |

### 4.2 对话组生命周期

```
Agent 生成开场白
        │
        ▼
┌─── 每轮循环 (turn 1..max_turns) ───┐
│                                      │
│  User LLM 生成候选消息               │
│        │                             │
│   代码门控 (code_gate)               │
│   ├─ 失败 → 重试 (最多 max_retries) │
│   │         └─ 全失败 → skip         │
│   │                                  │
│   LLM 门控 (llm_gate)               │
│   ├─ 失败 → 重试 (最多 max_retries) │
│   │         └─ 全失败 → skip         │
│   │                                  │
│   Agent 回复                         │
│   Segment 收束判断                    │
│        │                             │
└────────┘                             │
         │                             │
         ▼                             │
   ┌── 退出原因 ──────────────────────┐│
   │ max_turns        ← 轮数用完      ││
   │ user_llm_end     ← User LLM 主动结束│
   │ user_gate_failed ← 连续 3 次门控失败│
   │ exception        ← LLM API 异常   ││
   └──────────────────────────────────┘│
```

### 4.3 multi_turn 状态机（约束测试的多轮流程）

```
         自由发现模式                     多轮承接模式
    (USER_PROMPT /                   (CONTINUE_USER_PROMPT)
     TARGET_USER_PROMPT)

    ┌──────────┐
    │   none   │ ←── 独立测试，本轮直接收束为 segment
    └──────────┘
    ┌──────────┐     ┌───────────┐     ┌──────────┐
    │   need   │ ──► │ continue  │ ──► │   done   │ ←── 收束 segment
    └──────────┘     └───────────┘     └──────────┘
         │                                  ▲
         └──────────────────────────────────┘
                  (也可以 need → done，跳过 continue)

自动收束：
  - pending segment 达到 max_pending_turns 轮 → 强制 done
  - 对话组结束 → 自动收束为 conversation_ended_early
```

### 4.4 Segment 收束原因

| complete_reason | 含义 |
|---|---|
| `none` | 单轮独立测试，multi_turn=none |
| `done` | 多轮测试正常完成 |
| `max_pending_turns` | 多轮测试超过上限，强制收束 |
| `conversation_ended_early` | 对话组结束时有未完成的 pending segment |

---

## 5. 实时运行期间的可用数据

每次回调 `progress_callback` 都会收到一条字符串。在内部循环中，以下信息是实时可获取的（如果 UX 需要更结构化的回调，可修改代码增加）：

| 实时数据 | 当前是否通过回调暴露 | 数据类型 |
|---|---|---|
| 当前批次号 | ✅ | int |
| 覆盖率百分比 | ✅ | float |
| 已发现约束种类数 | ✅ | int |
| 测试片段总数 | ✅ | int |
| 充分测试约束数 / 总数 | ✅ | string "5/8" |
| 每组对话完成事件 | ✅ (组ID, turns数, segments数, 原因) | string |
| 定向组分配 | ✅ | string |
| 单轮门控重试 | ❌ (在 diagnostics 中) | — |
| 单个 Agent 回复 | ❌ (在最终报告中) | — |

> **如需更细粒度的实时数据**（如每个 turn 完成时的回调），需在 `_run_conversation_group` 中增加回调参数。

---

## 6. 真实数据示例

以下数据来自一次完整运行（rider2 指令，覆盖率 23.78%，15 个对话组，1380 秒）。

### 6.1 报告级指标

```
覆盖率:        23.78%
约束种类:      8
对话组:        15
测试片段:      51
评估结果:      pass=40, fail=11
总通过率:      78.43%
运行时长:      1380s (~23min)
```

### 6.2 约束统计（constraint_stats）

| 约束 | 测试次数 | 覆盖字符 | 充分测试 |
|---|---|---|---|
| 保持语气随意，像打电话一样自然。 | 7 | 16 | ✅ |
| 如果骑手坚持确实无法配送，安慰他们后挂断电话。 | 15 | 24 | ✅ |
| ... | ... | ... | ... |

### 6.3 单轮对话样本（TurnRecord）

```
T1 [C0] constraint: "如果骑手坚持确实无法配送，安慰他们后挂断电话。"
  Gate: ✓ pass — 用户明确表示无法配送，直接触发了约束...
  User:  站长，我今天实在没办法配送，家里临时有急事走不开。
  Agent: 理解，家里有事难免的。飞毛腿名额很抢手...要不你先忙完家事？
  multi_turn: need, segment_id: 1

T2 [C0] constraint: (同上，多轮承接)
  Gate: ✓ pass
  User:  站长，真的抱歉...您看能不能先把我名额让给别人吧。
  Agent: 我理解，名额让出没问题。记得在 App 里 Z 点前取消...
  multi_turn: done, segment_id: 1
```

### 6.4 评估样本（EvalRecord）

```
S1 [C0] 约束: "如果骑手坚持确实无法配送，安慰他们后挂断电话。"
  结果: ✗ fail
  依据: 骑手在第二轮明确表示无法配送并要求让出名额，属于坚持确实无法配送的情况。
        根据约束，Agent 应安慰后挂断电话，但 Agent 仅回复了取消报名的流程...
```

### 6.5 对话组退出原因分布

| 原因 | 次数 | 含义 |
|---|---|---|
| `user_llm_end` | 8 | User LLM 判断对话自然结束 |
| `user_gate_failed` | 7 | 连续 3 轮门控全失败 |

### 6.6 Segment 收束原因分布

| 原因 | 次数 |
|---|---|
| `none` (单轮独立测试) | 35 |
| `done` (多轮正常完成) | 15 |
| `max_pending_turns` (强制收束) | 1 |

---

## 7. 错误与诊断

### 7.1 diagnostics 类型

`diagnostics` 列表记录了运行过程中的所有异常和门控失败事件：

| 类型 | 示例 |
|---|---|
| 代码门控失败 | `user attempt 1: 代码门控失败: 当前连续对话中已经测试过这条约束` |
| LLM 门控失败 | `user attempt 2: LLM 门控失败: 用户消息与约束无直接对应关系` |
| JSON 解析失败 | `user attempt 1: JSON/字段解析失败: ...` |
| 跳过轮次 | `local_turn=3: 门控重试耗尽，跳过本轮 (连续 1/3)` |
| 对话组异常 | `conversation 2: 执行异常: Error code: 429 - Token 额度不足` |
| 多轮强制收束 | `segment 5 达到 max_pending_turns=3，自动收束` |

### 7.2 code_gate_errors（单轮级别）

每个 TurnRecord 都有 `code_gate_errors`，记录该轮最终通过前的最后一次代码门控错误。已通过的轮次为空列表 `[]`。

可能的错误消息：

| 错误 | 触发条件 |
|---|---|
| `缺少 user_reply` | User LLM 返回空回复 |
| `constraint_text 不是清洗后长指令中的精确连续原文` | 约束文本不是指令的子串 |
| `当前连续对话中已经测试过这条约束，不能连续反复测试` | 同一对话组内重复 |
| `当前连续对话中已测试过该约束的等价变体（忽略末尾标点差异）` | 标准化去重 |
| `该约束在本对话中门控已失败过` | failed_constraints 拦截 |
| `该约束全局已过度测试` | over_tested_global 拦截 |
| `constraint_text 不在目标约束列表中` | 定向模式下选错约束 |
| `user_reply 不能包含结束符` | 包含 `<end>` |
| 多轮状态错误 | `multi_turn 必须是 continue 或 done` 等 |

---

## 8. 输出文件结构

```
output/<timestamp>_<stem>/
├── report.json                          ← 完整 V4DatasetReport JSON
└── report_artifacts/
    ├── 00_cleaned_instruction.txt        ← 清洗后单行长指令
    ├── 00b_opening_lines.json            ← Agent 开场白列表
    ├── 01_constraint_stats.json          ← 约束统计
    ├── 02_turns.json                     ← 全部对话轮次
    ├── 02a_conversation_groups.json      ← 对话组
    ├── 03_evaluations.json               ← 评估结果
    ├── 03b_segments.json                 ← 测试片段
    ├── 04_diagnostics.json               ← 诊断信息
    └── summary.md                        ← 人类可读终端报告
```

---

## 9. 关键数值范围（来自真实运行）

| 指标 | 典型范围 | 说明 |
|---|---|---|
| coverage | 0.15 ~ 0.65 | 很难超过 70%，因为部分指令文本不可测试 |
| conversation_groups | 10 ~ 30 | 取决于目标覆盖率和指令长度 |
| turns per group | 3 ~ 10 | 受 max_turns 限制 |
| segments per group | 1 ~ 8 | 每个约束一个 segment |
| constraint 种类 | 5 ~ 25 | 取决于指令长度和复杂度 |
| 单 segment 轮数 | 1 ~ 3 | 大多数 1 轮（none），多轮最多 max_pending_turns |
| elapsed_seconds | 200 ~ 3000 | 取决于并行度和指令长度 |
| overall_pass_rate | 0.3 ~ 0.95 | Agent 质量差异大 |

---

## 10. 对话内数据示例（完整单组）

展示一个对话组从开场到结束的完整数据，帮助理解 turn/segment/history 的关系：

```
ConversationGroup #3, completion_reason: user_llm_end

  [Agent 开场]
  Agent: 你好，请问是${rider_name}吗？我是站长。我看到你已报名飞毛腿...

  [T1] constraint: "如果骑手坚持确实无法配送，安慰他们后挂断电话。"
       User:  站长，我今天实在没办法配送，家里临时有急事走不开。
       Gate:  ✓ pass
       Agent: 理解，家里有事难免的...要不你先忙完家事？
       multi_turn: need → 开启 pending segment S7
       → Segment S7, turn 1/?

  [T2] constraint: (同上，CONTINUE_USER_PROMPT 承接)
       User:  站长，真的抱歉...您看能不能先把我名额让给别人吧。
       Gate:  ✓ pass
       Agent: 我理解，名额让出没问题。记得在 App 里 Z 点前取消...
       multi_turn: done → 收束 Segment S7
       → Segment S7, turn 2/2, complete_reason: done

  [T3] constraint: "保持语气随意，像打电话一样自然。"
       User:  喂，你们这个飞毛腿到底是个啥东西啊？能不能给我解释解释？
       Gate:  ✓ pass
       Agent: 哈哈，简单说就是...咱们签了合同...
       multi_turn: none → Segment S8 独立收束

  [T4] end=true → 对话自然结束

Segments 产出:
  S7: "如果骑手坚持确实无法配送..."  2 turns  reason=done
  S8: "保持语气随意..."              1 turn   reason=none
```

对应评估结果：
```
S7: ✗ fail — Agent 应安慰后挂断，但回复了取消流程
S8: ✓ pass — Agent 用了随意语气
```

---

## 11. API 参数与默认值

UX 展示配置项时参考：

| 参数 | 默认值 | 范围 | UX 建议 |
|---|---|---|---|
| `max_turns` | 100 | 5~200 | 滑块，影响单组对话长度 |
| `max_retries` | 3 | 1~5 | 通常不需要暴露 |
| `max_pending_turns` | 3 | 2~5 | 通常不需要暴露 |
| `coverage` | 0.9 | 0.1~1.0 | 滑块，主要停止条件 |
| `min_tests` | 5 | 1~20 | 滑块，每条约束最少测试次数 |
| `parallel` | 5 | 1~10 | 滑块，影响速度和 API 并发 |
| `evaluate` | off | on/off | 开关，是否启用 LLM 评估 |
| `targeted_threshold` | 0.5 | 0.0~1.0 | 覆盖率达到此值后开启定向补充 |
