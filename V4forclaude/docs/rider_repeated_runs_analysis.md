# Rider 长指令四次重复运行分析

本文从科研实验视角分析 `output/rider_run1` 到 `output/rider_run4` 的模块 1/2/3 产物。重点不是判断某一次运行是否“对”，而是识别系统性误差、随机方差来源、以及当前评估框架的效度威胁。

## 实验对象

原始指令：`data/sample_instruction_rider.md`

四次运行产物：

| run | Module 1 parsed | Module 2 report | Module 3 constraints |
|---|---|---|---|
| `rider_run1` | yes | yes | yes |
| `rider_run2` | yes | yes | yes |
| `rider_run3` | yes | yes | missing |
| `rider_run4` | yes | yes | yes |

Run 3 的模块 3 失败原因：LLM 返回了不合规的 `edge_related`，缺少目标字段。

## 原始任务结构

原始 rider 指令的流程其实较短：

1. 告知合同已生效，并询问是否可以开始配送。
2. 说明单日合同需要连续 `Y` 天完成配送，否则合同受影响。
3. 挽留不想配送的骑手，鼓励能配送的骑手，并提醒注意安全。
4. 说明报名按排名进行，减少拒单/取消/超时，恶劣天气工作有助于保住资格。

约束包括：

- 约 30 字以内。
- 不重复回复。
- 超范围问题使用固定回复。
- 语气随意自然。
- 坚持无法配送时安慰后挂断。

## 观测摘要

### Module 1：流程图方差很高

| run | nodes | main path | paused paths | 明显问题 |
|---|---:|---|---:|---|
| run1 | 5 | `A-B-C-E` | 1 | 相对合理，但 D 分支后接 E 的语义依赖较弱 |
| run2 | 5 | `A-B-C-D-E` | 2 | `可以配送` 后进入挽留/排名分支，路径语义混乱 |
| run3 | 5 | `A-B-C-D-E` | 1 | B 缺少“不想配送”分支；C 同时承担说明和意愿判断 |
| run4 | 6 | `A-B-D-E` | 0 | F 孤立；B 标为 action 但有分支；主路径漏掉可以配送说明路径 |

最严重的问题是：同一原始指令重复运行后，模块 1 产生的流程图不是同构图。

这意味着后续模块的输入条件本身发生变化，模块 2/3 的结果不能直接被视为 Agent 能力差异，而混入了 parser 方差。

### Module 2：测试结果受上游图结构强烈影响

| run | total paths | completed | fail nodes |
|---|---:|---:|---|
| run1 | 2 | 1 | D |
| run2 | 3 | 0 | A |
| run3 | 2 | 0 | C, E |
| run4 | 1 | 0 | A |

Run 2 和 Run 4 的报告很短，说明路径很早失败。这个失败不一定代表 Agent 更差，也可能是节点目标被模块 1 合并得过重。

例如 run2 的 A 节点包含：

```text
开场白 + 身份确认 + 通知合同生效 + 提醒高峰期上线 + 单量要求 + 询问是否可以开始配送
```

Agent 回复完成了前半部分，但没有询问是否可以开始配送，于是 A fail。这里的问题是节点粒度过大，Judge 对“核心动作”的期望也随之变得过重。

### Module 3：约束拆解数量和状态矩阵不稳定

| run | constraints | matrix cells | status 特征 | coverage |
|---|---:|---:|---|---|
| run1 | 9 | 45 | 含 3 个 edge | 无缺口 |
| run2 | 14 | 70 | 以 skip 为主 | 无缺口 |
| run3 | missing | - | schema failure | - |
| run4 | 14 | 84 | 含 2 个 edge | 无缺口 |

模块 3 的约束拆解也不稳定：

- run1 把“坚持无法配送，安慰后挂断”拆为 terminal constraint。
- run2 把同一条放入 hard/global/both。
- run4 又拆成 terminal flow/both。
- run1 的 flow 约束较粗，run2/run4 拆得更细。

这说明模块 3 目前还没有形成稳定的 constraint ontology。同一条语义在不同运行中可能落到不同 `source_type / check_target / scope`。

## 主要系统问题

### 1. Parser 方差污染后续模块

这是当前最大问题。模块 2 和模块 3 都依赖 `ParsedInstruction`，但四次 `parsed.json` 的图结构差异较大：

- 节点数量不同。
- 节点类型不同。
- 主路径不同。
- paused path 数量不同。
- 有的图出现孤立节点。
- 有的 decision/action 类型与 branches 不一致。

在科研实验中，这叫 measurement pipeline instability：测量管线本身不稳定，导致下游评估结果不能直接归因于被测 Agent。

### 2. 节点粒度缺少稳定准则

模块 1 有时把多个动作合并成一个节点，有时拆成多个节点。

例子：

- run1 的 A 同时承担启动通话、身份确认、合同生效、提醒高峰期、单量要求。
- run2 的 A 又额外要求询问是否开始配送。
- run3 把意愿判断移到 C。

节点粒度不稳定会影响：

- Judge 期望。
- user_input 生成。
- path prefix 复用。
- module 3 的 node-constraint activation。

### 3. 流程分支语义不稳定

原始指令中 Step 3 是“挽留不想配送的人，鼓励能配送的人”，它隐含了用户意愿分支。

四次解析对这个分支处理不同：

- run1：B 分出 `可以配送 -> C` 与 `不想配送 -> D`。
- run2：B 分出 `可以配送 -> C` 与 `不想配送 -> D`，但 C 又进入 D，语义混乱。
- run3：B 只有 `可以配送 -> C`，C 再分 `不愿意/愿意`。
- run4：B 是 action 却带分支，且主路径走 `不想配送`。

这说明 parser 对“显式步骤”与“隐含分支”的关系缺少稳定策略。

### 4. Module 2 早停使路径覆盖不足

模块 2 当前遇到 fail 即停止路径。这个设计适合诊断单路径是否通过，但不适合做覆盖性评估。

例如 run2/run4 都在 A fail 后，后续节点没有被测试。结果会导致：

- 后续节点能力未知。
- 节点错误统计偏向早期节点。
- 不同 run 的报告长度不可比。

科研上这会造成 informative censoring：失败不是随机缺失，而是早期失败导致后续观测被截断。

### 5. Judge 被节点描述牵引，缺少可重复判准

Module 2 的 Judge 是 per-turn LLM Judge。它根据节点名称判断核心动作。

当节点名称变重，Judge 就会要求更多动作；当节点名称变轻，Judge 就更容易 pass。

这使 Judge 结果不仅测 Agent，也测 parser 生成的节点命名方式。

### 6. Module 3 schema 严格性带来可观测失败，但也暴露 LLM 格式不稳定

Run 3 的模块 3 缺失是好信号：严格 schema 没有吞掉错误。

但科研上要区分两类失败：

- semantic failure：LLM 判断错。
- protocol failure：LLM 输出格式不满足 schema。

Run 3 属于 protocol failure。它不应被混入模型能力评估，而应作为工具链可靠性指标单独统计。

### 7. Constraint ontology 尚未稳定

相同语义在不同 run 中被拆为不同类型：

```text
坚持无法配送，安慰后挂断
```

可能被拆为：

- `hard/both/global`
- `flow/both/terminal`
- `flow/both/node`

这说明当前 `source_type / check_target / scope` 仍有不稳定性。尤其是“用户异常触发 + 终止动作”的混合约束，容易在 global 与 terminal 之间摇摆。

## 科研效度威胁

### Construct Validity

当前系统声称测“Agent 遵循长指令能力”，但实际混合测量了：

- parser 图构建能力。
- judge 对节点名称的解释。
- agent 回复能力。
- constraint analyzer 输出协议稳定性。

如果不隔离这些来源，就难以证明最终分数代表 Agent 能力。

### Internal Validity

同一输入重复运行产生不同图结构，说明随机 LLM 解析是强混杂变量。模块 2 的失败不能直接归因于 Agent。

### Reliability

四次 run 的模块 1/3 结果不稳定，test-retest reliability 不足。当前更像探索性评估系统，还不能作为稳定 benchmark。

### External Validity

Rider 指令比 merchant 指令更短，但仍产生高方差。说明系统对不同类型长指令的泛化稳定性还不足。

## 建议的实验改进

### 1. 增加 Module 1 图结构一致性检查

每次 parser 输出后，先做 deterministic validation：

- action 节点是否有多个分支。
- decision 节点是否没有分支。
- 是否存在孤立节点。
- 是否所有节点从 start 可达。
- 是否存在终端节点过多或不可解释终端。
- branch target 是否存在。
- main_path 是否覆盖关键 flow steps。

Run 4 的孤立 F 应在这里被抓到。

### 2. 增加跨 run consensus parser

既然单次 parser 方差高，可以把模块 1 从“单 run 输出”改成“多 run 共识”：

- 并行生成 N 个候选图。
- 做 graph-level alignment。
- 对节点、边、路径做投票。
- 对不一致处输出 ambiguity。
- 只有通过一致性阈值的 graph 进入模块 2/3。

当前 parser 内部已有多路投票思想，但 rider 四次结果说明图级稳定性仍不足，需要更强的 graph validation 和 consensus。

### 3. 将流程图与回复约束彻底分离

模块 2 负责 graph transition。

模块 3 负责非结构性约束：

- 回复长度。
- 禁止重复。
- 风格。
- 超范围回复。
- 异常用户输入。
- 终止动作相关回复。

对于 rider，这类 flow constraint：

```text
告知合同生效
说明连续 Y 天
说明排名机制
```

其实处在灰区：它既像节点动作，又像回复内容约束。建议在数据模型上区分：

- `GraphNodeGoal`：节点核心动作。
- `ActivationConstraint`：跨节点或全局约束。

否则模块 2 和模块 3 会重复评估节点目标。

### 4. Module 2 增加 non-stopping 模式

除了当前 fail-stop 模式，增加 coverage mode：

```text
fail 后仍继续模拟后续节点
```

这样能区分：

- 早期节点失败。
- 后续节点是否也失败。
- 是否只是一个节点目标过重导致早停。

报告中可同时保留：

- strict_completion。
- coverage_completion。

### 5. 固定 Agent 输出随机性

Agent 当前每次 LLM 回复可能不同。若目标是测试 pipeline 稳定性，应该先降低 Agent 随机性：

- temperature 降低。
- 或记录并复用 Agent 回复。
- 或用固定 mock agent 做 pipeline regression。

否则 parser 方差、agent 方差、judge 方差混在一起。

### 6. 给 Module 3 增加协议失败统计

Run 3 的 missing constraints 不应只是“失败”，应进入报告：

```json
{
  "module": "constraint_analysis",
  "failure_type": "protocol_error",
  "node_id": "...",
  "constraint_id": "...",
  "raw_error": "edge_related missing target"
}
```

这样后续能统计：

- semantic error rate。
- schema/protocol error rate。
- coverage issue rate。

## 建议优先级

### P0：先修 Module 1 结构稳定性

原因：模块 1 是上游真源。图不稳定时，模块 2/3 的差异都难以解释。

最小改动：

- 加 graph validation。
- 对 action 多分支、孤立节点、不可达节点直接报错或记录 ambiguity。
- 输出 parser stability diagnostics。

### P1：Module 2 增加 coverage mode

原因：减少早停带来的观测缺失。

### P2：Module 3 增加失败产物

原因：不要让 Run 3 只留下缺文件；失败本身是重要实验数据。

### P3：建立跨 run 对比工具

自动比较：

- graph edit distance。
- constraint set Jaccard similarity。
- status matrix agreement。
- report fail-node agreement。

目前这些分析靠人工，不利于迭代。

## 一句话结论

这四次 rider 实验说明：当前系统已经能跑完整链路，但它测到的不只是 Agent 遵循指令能力，而是 parser、agent、judge、constraint analyzer 四个随机组件的联合输出。下一阶段最重要的科研问题不是继续丰富模块三，而是提高模块一图结构的 test-retest reliability，并把 pipeline failure 作为一等实验结果记录下来。

## 已落地的最小改进：规格守门器

一个重要补充判断是：流程图不稳定并不一定全是 parser 错。长指令本身可能就是欠规格化的：步骤是线性描述的，但隐含了用户分支、终止条件、跳回点或多种合理解释。

因此系统不应强行把所有长指令解析成唯一流程图。更合理的行为是：

```text
能形成稳定测试规格 -> 进入模块 2/3
不能形成稳定测试规格 -> 输出 spec_unstable / graph_diagnostics
```

当前已实现轻量规格守门器：

- `ParsedInstruction.graph_diagnostics`
- `GraphDiagnostic(severity, code, message, node_id, evidence)`
- 模块 2/3 遇到 `severity="block"` 会停止，不继续评估 Agent。

当前 block 规则包括：

- 多个起点。
- 不可达节点。
- action 节点包含条件分支。
- decision 节点缺少至少两个有效条件分支。
- 无完整路径。
- 主路径为空。
- 路径包含图中不存在的边。

warn 规则包括：

- 多路投票阶段存在 ambiguity。

用历史 `rider_run4/parsed.json` 回放诊断，可以抓到：

- `multiple_start_nodes`: A 和 F 都是起点。
- `unreachable_node`: F 无法从 A 到达。
- `action_has_conditional_branch`: B/D 是 action 但带条件分支。
- `vote_ambiguities_present`: 多个节点和边在投票时存在严重不一致。

这一步的意义不是修复图，而是阻止明显不稳定的图继续污染模块 2/3。它把“源指令模糊或 parser 不稳定”从隐藏混杂变量变成可观测实验结果。

## 已落地的补充：模块 0 并行可规格化审计

为了在进入 parser 之前暴露原始长指令本身的欠规格化问题，新增模块 0：

```bash
uv run python run_instruction_lint.py data/sample_instruction_rider.md -o output/rider_lint.json -n 5
```

模块 0 的设计原则：

- 并行运行 `n` 路 LLM 审计，默认 5 路。
- 不生成流程图，只找细粒度欠规格化点。
- 以 finding 为投票单位，而不是只投最终分数。
- 每个 finding 都有 `support_count / confidence / variants`。
- 保留每一路候选报告，方便观察 LLM 分歧。
- 诊断粒度要细，但阻塞门槛要高：只有高置信、会直接改变 node-edge 拓扑的歧义才保留为 `block`。

当前 severity 校准规则：

- `undefined_placeholder`、`opening_flow_overlap`、`node_granularity_ambiguous` 默认不阻塞，只作为 `warn/info` 暴露。
- `flow_constraint_mixed` 只有在 Call Flow 与 Constraints 对同一条件给出冲突跳转时才阻塞。
- `missing_branch_target` 如果已有明确动作，只是不清楚动作后是否合并/终止，降为 `warn`。
- 共识 finding 需要达到 `confidence >= 0.8`，且类型属于拓扑阻塞类型，才会让整份报告变成 `low`。

当前 finding 类型包括：

```text
implicit_branch
missing_branch_target
missing_merge
unclear_terminal
opening_flow_overlap
flow_constraint_mixed
node_granularity_ambiguous
sequence_ambiguous
undefined_placeholder
other
```

这个模块要回答的问题是：

```text
这份长指令本身是否足够支持稳定测试规格？
哪些原文片段导致不同解析器可能产生不同流程图？
这些问题有几路 LLM 独立发现？
```

它不是 parser 的替代品，而是 parser 的前置质量控制。理想链路变为：

```text
Module 0: source instruction lint
  -> high/medium: 进入 Module 1
  -> low 或强 blocking findings: 先人工确认/改写长指令

Module 1: graph parse + graph_diagnostics
Module 2/3: 只消费稳定测试规格
```

因此模块 0 不是保守拒绝器，而是把“长指令本身的模糊性”作为实验变量提前记录下来。`medium + 多个 warn` 的指令仍然可以进入模块 1，但后续图不稳定时，应回看这些 findings，而不是把不稳定完全归因于 parser。
