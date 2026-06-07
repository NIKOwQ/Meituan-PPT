# 模块 3 约束激活分析优化说明

> 本文记录 `constraint_analyzer.py` 第一版实验结果、暴露的问题、优化方向和后续改造顺序。目标是让模块三保持可替换、可删除，同时为模块四生成自然语言 User 输入提供更干净的数据结构。

## 当前实验结论

本轮测试命令：

```bash
uv run python run_constraint_analysis.py output\N=5\parsed1.json data\sample_instruction_merchant.md -o output\constraint_test.json
```

测试已完整跑通：

- 节点数：20
- 原子约束数：43
- 矩阵规模：20 x 43 = 860

状态分布：

| status | count |
|---|---:|
| already_active | 284 |
| triggerable_by_user | 156 |
| edge_related | 17 |
| not_applicable | 403 |

结论：路线可行，但当前矩阵过宽。`active / trigger / edge` 合计 457 格，超过总量一半，后续模块四如果直接生成测试用例，会产生大量冗余和误触发。

## 当前版本边界

当前模块三只做两件事：

1. 将 `ParsedInstruction` 中的 hard / soft / flow constraints 拆成 `AtomicConstraint`。
2. 对每个 `node x constraint` 输出激活机会分类。

v2 之后新增一条边界：`Step N` 这类已经由模块二流程图表达的结构性流程约束，不再进入 `AtomicConstraint`。模块三只在报告中以 `graph_transitions` 展示 `ParsedInstruction.nodes/branches` 的确定性边，作为模块二真源的快照。

当前刻意不做：

- 不生成自然语言 User 输入。
- 不调用 Agent。
- 不调用 Judge。
- 不对 LLM 失败做启发式回退。

设计原则：实验阶段让错误暴露出来。若 LLM 超时、JSON 不合格、漏返回某条约束，应直接失败或报错，不要用本地猜测结果补齐。

## 暴露的问题

### 1. 四分类过粗

当前状态：

```text
not_applicable
already_active
triggerable_by_user
edge_related
```

问题是 `triggerable_by_user` 同时承载了两种完全不同的含义：

- 全局异常：用户任何节点都可能说「忙」「开车」「打断」。
- 节点专属触发：只有在当前节点才有意义，例如「是否负责人」「是否知情」「是否已显示低延迟直播」。

这会导致 C9-C12 这类全局异常约束在所有节点都变成 `triggerable_by_user`，矩阵膨胀。

### 2. OR 关系被拆成多条必测约束

报告中：

- C22：若对话被打断，使用「您刚才提到……」作为过渡语
- C23：若对话被打断，使用「我刚说到……」作为过渡语

原文语义是二选一，但拆解后变成两条独立约束。若模块四/五逐条验证，会错误要求 Agent 同时满足两条。

需要表达：

```text
group_id = interruption_transition_phrase
satisfy_mode = any
```

### 3. edge_related 判定不够严格

报告里有明显误判：

```text
A1 x C24 -> B
D1a x C24 -> 第2步
D1a x C25 -> 第2步
D x C13 -> D2
```

这些不是当前节点真实可验证的 outgoing edge。`edge_related` 应只允许两种情况：

1. 约束对应当前节点的真实出边。
2. 约束对应当前节点的终止动作，例如挂断。

如果当前节点没有对应出边，也不是终止动作，则应为 `not_applicable`。

### 4. expected_edge_target 不规范

当前报告中 target 混用了：

```text
B
F1
挂断
hang_up
第2步
D1a 或 D1b
```

这会让后续模块难以机器处理。

建议拆成两个字段：

```text
expected_edge_target_node_id: str | null
terminal_action: "hangup" | "end_call" | null
```

规则：

- 如果目标是流程节点，只填 node id。
- 如果目标是挂断/结束，只填 terminal_action。
- 不允许填写自然语言目标，如「第2步」。
- 不允许填写复合目标，如「D1a 或 D1b」；应拆成多个 edge opportunity。

### 5. already_active 含义过宽

例如 C8「给出信息后暂停等待商家回应再继续」被大量标成 `already_active`。但它不是无条件生效，而是当本轮 Agent 给出信息时才生效。

这类约束更准确的状态是：

```text
conditional_active
activation_condition = "当 Agent 本轮给出业务信息或说明时"
```

## 建议的数据模型 v2

### ActivationStatus

建议从四类改为六类：

```python
ActivationStatus = Literal[
    "not_applicable",
    "always_active",
    "conditional_active",
    "global_triggerable_by_user",
    "node_triggerable_by_user",
    "edge_related",
]
```

含义：

| status | 含义 | 示例 |
|---|---|---|
| not_applicable | 当前节点不适用 | Step 6 约束在 Step 1 |
| always_active | 每次 Agent 回复都要满足 | 字数、禁用语气词、语气风格 |
| conditional_active | 满足某个上下文条件时生效 | 给出信息后暂停、任务完成后有疑问继续回答 |
| global_triggerable_by_user | 用户任何时刻都可能触发 | 忙、开车、打断、索要优惠券 |
| node_triggerable_by_user | 只有当前节点适合触发 | 是否负责人、是否知情、发布方式选择 |
| edge_related | 验证当前节点真实流程跳转 | A -> B、B -> C、挂断 |

### AtomicConstraint v2

建议新增字段：

```python
class AtomicConstraint(BaseModel):
    id: str
    text: str
    source_type: Literal["hard", "soft", "flow", "derived"]
    check_target: Literal["agent_reply", "state_transition", "both"]
    scope: Literal["global", "node", "path", "terminal"]
    group_id: str | None = None
    satisfy_mode: Literal["all", "any"] = "all"
    rationale: str = ""
```

字段说明：

- `scope=global`：全局回复规则或全局异常处理。
- `scope=node`：只和某些节点有关。
- `scope=path`：跨节点顺序要求，例如「请其转达后进入第2步」。
- `scope=terminal`：结束/挂断类要求。
- `group_id`：表达 OR / AND 组合关系。
- `satisfy_mode=any`：同组约束满足任一即可。

### ConstraintNodeFit v2

建议新增/替换字段：

```python
class ConstraintNodeFit(BaseModel):
    node_id: str
    constraint_id: str
    status: ActivationStatus
    rationale: str
    activation_condition: str = ""
    activation_goal: str = ""
    user_trigger_intent: str = ""
    expected_agent_behavior: str = ""
    expected_edge_target_node_id: str | None = None
    terminal_action: Literal["hangup", "end_call"] | None = None
```

删除字段：

```python
expected_edge_target
```

原因：它现在既能放 node id，又能放自然语言，机器不可控。

## Prompt 优化方向

### 约束拆解 prompt

新增要求：

```text
1. 必须识别约束 scope：global / node / path / terminal。
2. 如果多条约束是「或」关系，必须使用相同 group_id，并设置 satisfy_mode="any"。
3. 如果多条约束有顺序依赖，在 notes 中说明，但不要把顺序依赖误写成每个节点都要测试。
4. 不要把示例话术拆成多条必须同时满足的约束；示例话术若是可选表达，应进入同一个 any 组。
```

### 节点适配 prompt

新增判定规则：

```text
1. edge_related 只能用于当前节点真实 outgoing branch，或当前节点可执行的 terminal_action。
2. 如果约束目标节点不在当前节点 branches.target 中，不得输出 edge_related。
3. global_triggerable_by_user 不代表每个节点都必须生成测试用例，只代表该节点允许被全局异常打断。
4. node_triggerable_by_user 只能在当前节点目标或当前节点分支条件与约束直接相关时使用。
5. conditional_active 必须填写 activation_condition。
6. expected_edge_target_node_id 只能填写当前节点 branches.target 中存在的 node id。
7. 挂断只填 terminal_action="hangup"，不要写到 expected_edge_target_node_id。
```

### 输出完整性

继续保持严格要求：

```text
每个节点必须为每条约束输出一行。
不允许漏 constraint_id。
不允许输出未知 constraint_id。
不允许用自然语言代替 node id。
```

这部分不做回退，失败就暴露 prompt 或模型输出问题。

## 后续实施顺序

### Step 1：只改数据模型和渲染

目标：不改变 LLM 调用流程，只让 JSON schema 更准确。

改动：

- 更新 `ActivationStatus`。
- 给 `AtomicConstraint` 增加 `scope / group_id / satisfy_mode`。
- 给 `ConstraintNodeFit` 增加 `activation_condition / expected_edge_target_node_id / terminal_action`。
- CLI 矩阵渲染增加短标签：

```text
skip   = not_applicable
always = always_active
cond   = conditional_active
gtrig  = global_triggerable_by_user
ntrig  = node_triggerable_by_user
edge   = edge_related
```

验收：

- JSON 可序列化。
- `run_constraint_analysis.py --limit 3` 能跑通。
- 不做模块四。

### Step 2：收紧约束拆解 prompt

目标：减少 OR 关系误拆和 scope 丢失。

重点观察：

- C22/C23 是否进入同一个 any 组。
- 忙/开车/打断是否标记为 global。
- Step 类流程约束是否标记为 node/path/terminal，而不是泛化为 global。

验收：

- `constraints` 中出现合理的 `scope`。
- `notes` 能保留顺序依赖和 OR 关系说明。

### Step 3：收紧节点适配 prompt

目标：减少错误 edge 和过宽 trigger。

重点观察：

- `A1 x C24` 不应再是 edge。
- `D1a x C24` 不应再是 edge。
- 慢引导/等待类约束不应在上一层选择节点输出 edge，除非当前节点本身就是执行慢引导/等待动作的节点。
- C9-C12 应是 `global_triggerable_by_user`，而不是普通 `triggerable_by_user`。

验收：

- `edge_related` 的 `expected_edge_target_node_id` 必须能在当前节点 branches 中找到。
- 挂断统一输出 `terminal_action="hangup"`。

#### v2 limit=3 新观察

`constraint_test_v2_limit3.json` 相比 v1 已明显收敛：

- 约束数从 43 收敛到 29。
- C22/C23 不再被拆成两条必测约束，而是合并为「打断时使用简短过渡语」。
- 前 3 个节点中 `edge_related` 基本只落在真实出边上。
- 状态分布开始区分 `always / cond / gtrig / edge / skip`。

仍需继续收紧：

| 现象 | 应调整为 |
|---|---|
| 「说忙」在 A1 被判为 `conditional_active` | 应为 `global_triggerable_by_user` |
| 「对话被打断」在 A1 被判为 `conditional_active` | 应为 `global_triggerable_by_user` |
| 「开车后挂断」在 A1/B 被判为 `not_applicable` | 应为 `global_triggerable_by_user` |
| 「任务完成后有疑问继续作答」在 A/B 被判为 `conditional_active` | 早期节点应为 `not_applicable` |

本次已将这些规则写入 prompt：

- 用户输入触发的全局异常不得判为 `conditional_active`。
- 「商家说忙」「开车」「打断」属于 `global_triggerable_by_user`。
- 「任务完成后」类约束只在任务完成或接近结束节点激活。
- 非 `edge_related` 不允许填写 edge/terminal 字段。

#### v2 graph-source 决策

最新结果仍出现：

```text
C14 [flow/state_transition/node]: Step 1...
C15 [flow/both/node]: Step 2...
...
C20 [flow/both/terminal]: Step 7...
```

这些约束本质上是模块二流程图的构建材料，而不是模块三要逐条激活的回复约束。继续把它们放进 `AtomicConstraint` 会导致两个真源：

- `ParsedInstruction.nodes/branches`
- `AtomicConstraint(C14-C20)`

因此后续实现已采用以下规则：

```text
flow_constraints 中以 /^Step\s*\d+[:：]/ 开头的结构性流程约束
  -> 不传给 LLM 拆 AtomicConstraint
  -> 只在报告 graph_transitions 中展示 parsed.nodes.branches

其他 flow constraints，例如「若对话被打断...」
  -> 继续作为 activation constraint 进入模块三
```

这样模块二负责「走哪条边」，模块三负责「在当前解空间里哪些回复约束激活」。

### Step 4：增加报告诊断统计

目标：让每次测试后能快速判断矩阵是否过宽。

建议 CLI 增加：

```text
status 分布
每条 constraint 的 status 分布
edge_related 合法性检查
global_triggerable 数量
node_triggerable 数量
未覆盖约束：某条 constraint 在本次分析节点范围内全是 skip
```

诊断规则：

- 如果某条 node-scope 约束在超过 30% 节点上触发，提示可能过宽。
- 如果 edge target 不是当前节点出边，直接报错。
- 如果 any 组中的每条约束都被当成 all 约束，提示拆解错误。
- 如果某条约束在所有已分析节点上都是 `not_applicable`，在 `coverage_issues` 中列出。注意：使用 `--limit` 时，这只表示小样本范围未覆盖，不代表全量流程永远不会覆盖。

#### v2 full 新观察

全量 `constraint_test_v2_full_c.json` 的结构已经基本正确：

- `Step N` 流程构建项已从原子约束中移除。
- `Graph Transitions` 单独展示模块二图边。
- 全量覆盖检查发现 C8「学员端费用配置引导每步暂停3秒」完全未覆盖。

继续暴露的问题：

| 现象 | 判断 | 后续规则 |
|---|---|---|
| C6「开车后挂断」有时被输出为 `edge_related` | 错误。它是用户任意时刻触发的全局异常，不是当前节点图边 | global 约束不得输出 edge_related |
| 样本中的「每步暂停3秒」在上一层选择节点被输出为 `edge` | 错误。节奏/等待约束不是跳转约束 | 节奏/等待约束不得输出 edge_related |
| 样本中的某条慢引导约束全量未覆盖 | 可能是 LLM 没把约束主题和对应慢引导节点匹配起来 | 约束主题与节点语义匹配时才 conditional_active，不能写死业务名 |

本轮已加入：

- prompt 规则：global 约束不得输出 edge_related。
- prompt 规则：节奏/等待约束只在当前节点本身执行该约束描述的动作、对象、场景时 conditional_active。
- 校验规则：global + edge_related 直接报错。
- 校验规则：节奏/等待约束 + edge_related 直接报错。

#### v2 full_c vs full_d 差异分析

`full_c` 到 `full_d` 的主要变化：

- `edge_related` 从 5 降为 0，说明流程跳转和全局异常的边界更稳定。
- `C6`「开车后挂断」从部分节点 `edge_related` 收敛为 `global_triggerable_by_user`。
- `C7`「慢引导每步暂停」从上一层选择节点 `edge` 收敛为慢引导节点 `conditional_active`。
- `C8` 仍然全量未覆盖。

关键判断：`C8` 未覆盖不是继续写业务特例能解决的问题，而是当前分类输入只包含 current node 与 outgoing branches，缺少 incoming edge / parent node / ancestor path。像 `E2：缓慢引导设置（每步暂停3秒）` 这种节点，当前节点名只说明「缓慢引导」，真正说明它属于「学员端费用配置」的是父节点 `E：Step5 检查学员端费用/加速线路费` 与入边「无法自行配置」。

因此新增通用图上下文：

```text
incoming_edges
is_merge_node
ancestor_paths_depth_2
```

判定原则：

- `current_node` 与 `incoming_edges` 是当前节点所属场景的强证据。
- `ancestor_paths_depth_2` 只能作为背景。
- 如果当前节点前已经经过合并点，不得因为某条较早祖先路径匹配约束主题，就让约束激活。
- 节奏/等待约束需要当前节点本身执行对应动作，且当前节点或直接入边支持对应对象/场景。

#### v2 full_e 新观察

加入上游上下文后：

- `C8` 不再全量未覆盖，说明 incoming edge / parent node 对识别节点所属场景有效。
- `C7/C8` 仍出现轻微过度激活：上一层判断节点也被判为 `conditional_active`。

例子：

```text
D2：询问低延迟直播是否已显示
E：Step5 检查学员端费用/加速线路费
```

这类节点是前置询问/检查，不是实际执行「每步暂停」的节点。节奏/等待约束应该落在真正执行分步骤动作的节点，例如名称中出现「缓慢」「每步」「逐步」「分步骤」「暂停」「等待」等节奏词，或当前节点动作明确是引导/设置/配置/开通/发送步骤。

已追加通用规则：

- 上游上下文只能帮助识别业务场景，不能单独让节奏/等待约束激活。
- 当前节点如果只是询问/确认/选择/检查/判断，节奏/等待约束应为 `not_applicable`。
- 当前节点自身执行分步骤动作时，才输出 `conditional_active`。

### Step 5：再接模块四

模块四只消费：

```text
node_triggerable_by_user
global_triggerable_by_user
edge_related
conditional_active
```

并且生成测试用例时要做去重：

- 全局异常约束不需要在每个节点都测，可以按路径关键节点抽样。
- OR 组只生成一个测试目标。
- edge_related 每条真实出边生成一个测试目标。

## 回归检查样例

以后每次改 prompt 或模型字段，都用 `output\constraint_test.json` 对照以下现象：

| 检查项 | 期望 |
|---|---|
| C22/C23 | 同 group，any 关系 |
| C9-C12 | global_triggerable_by_user |
| A x C24 | edge，target=B |
| A x C25 | edge，target=A1 |
| A1 x C24 | not_applicable 或 path/conditional，不应 edge |
| B x C26 | node_triggerable_by_user 或 edge/both，关联 B1 |
| B x C27 | edge，target=C |
| D1a x C24 | not_applicable |
| E x C36 | edge，target=F |
| F x C39 | edge，target=F1 |
| G x C43 | terminal_action=end_call 或 hangup |

## 当前不建议做的事

- 不要给 LLM 输出失败加启发式回退。
- 不要在模块三里生成 User 自然语言话术。
- 不要把全局异常在所有节点直接展开成测试用例。
- 不要让 `expected_edge_target` 继续承载自然语言。
- 不要修改 `parser.py` 中已调优的提示词来适配模块三。

## 一句话方向

模块三下一步不是追求更多 `trigger`，而是减少错误激活：把「全局可打断」和「当前节点专属测试」分开，把 OR 关系显式建模，把 edge 限定为当前节点真实出边或终止动作。
