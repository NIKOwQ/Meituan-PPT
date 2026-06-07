# Parse1 v2: 原文锚定的最小关系解析设计

> 目标：把长指令中的流程句拆成忠于原文的最小 node-edge 结构事实，降低 LLM 同时识别片段、改写节点、分配编号导致的错位风险。本文只定义设计，不直接替换当前 `parser.py`。

## 1. 根本问题

当前 parse1 虽然已拆成节点抽取、边抽取、三元组校验，但 Phase A 仍然要求 LLM 先产出全局节点 ID 和改写后的节点名称。这样会产生两个连锁问题：

- `node_id` 与原文内容可能不对齐。
- 后续 edge 抽取会基于已错位的 node list 继续推理，三元组校验也只能校验错位后的三元组。

因此 v2 不应先抽全局节点，而应先抽取原文锚定的局部关系事实。全局节点 ID 只能由后处理分配。

## 2. 核心原则

1. 每个 minimal graph 只表达一个最小结构事实。
2. node 的 `original_text` 必须逐字来自原文，第一版严格 exact match。
3. node 文本拆成两个字段：原文锚点与语义摘要。
4. LLM 的 local id 只在当前 minimal graph 内有效，不进入最终图。
5. 投票粒度是 minimal graph/relation fact，不是全局 node id。
6. 不补全隐含分支，第一版只接受原文明确表达的关系。
7. 允许散落 minimal graph，但不允许散落 node。node 必须依附于某个关系事实出现。
8. 全局节点合并使用 `original_text + normalized_goal`，不使用 LLM 生成的局部编号。

## 3. 数据结构草案

```python
class MinimalNode(BaseModel):
    local_id: str
    original_text: str
    normalized_goal: str
    source_sentence_id: str
    char_span: tuple[int, int] | None = None

class MinimalEdge(BaseModel):
    source_local_id: str
    target_local_id: str
    condition_original_text: str = ""
    condition_normalized: str = ""

class MinimalGraph(BaseModel):
    graph_id: str
    relation_type: Literal["sequence", "selection", "merge", "conditional_transition"]
    source_sentence_id: str
    evidence_text: str
    nodes: list[MinimalNode]
    edges: list[MinimalEdge]
```

`original_text` 和 `condition_original_text` 都应能在原始 Markdown 中匹配。`normalized_goal` 只用于合并和解释，不能作为原文证据。

## 4. 三类完整结构关系

### sequence

顺序关系：`A -> B`。

只表达“完成 A 后进入 B”。如果原文用“并”连接两个动作，且它们应在同一轮 Agent 回复中同时完成，则不拆成两个 node。

例：

```text
告知合同生效，并询问是否可以开始配送
```

这里“并”反映这是一个复合动作 node，而不是：

```text
告知合同生效 -> 询问是否可以开始配送
```

因此可形成一个 node：

```text
original_text = "告知合同生效，并询问是否可以开始配送"
normalized_goal = "告知合同生效并询问能否开始配送"
```

### selection

选择分支：同一个源节点下，原文明确给出多个选项/条件，形成多条带条件的边。

selection 的条件必须放在 edge 上：

```text
A --condition_1--> B
A --condition_2--> C
```

条件字段也必须保留原文：

```python
condition_original_text = "不想配送"
condition_normalized = "用户不想配送"
```

如果原文只有单个条件动作，不自动补全另一侧隐含分支。

### merge

汇合结构：多个上游节点明确进入同一目标节点。

```text
B -> D
C -> D
```

如果原文存在：

```text
B -> D, C -> E -> D
```

不应做成一个四节点 minimal graph，而应拆成两个局部事实：

```text
G1 sequence:
C -> E

G2 merge:
B -> D
E -> D
```

这样每个 minimal graph 只表达一个结构事实，后处理再将它们合并成全局图。

## 5. 条件动作不是自动 selection

例：

```text
如果骑手坚持确实无法配送，安慰他们后挂断电话
```

这里“用户坚持无法配送”是 edge condition，“安慰后挂断电话”是 target node。它本身不构成 selection，因为原文没有在同一句中给出多个并列选项。

它应依附于上游决策节点，例如：

```text
source node: 询问是否可以开始配送
edge condition: 用户坚持确实无法配送
target node: 安慰他们后挂断电话
```

如果当前局部句无法确定 source node，则该 relation fact 应被标为 `needs_anchor`，等待与其他 minimal graph 合并，而不是臆造 source。

## 6. 单条条件边：conditional_transition

除了三类完整结构关系，还需要保留一种中间态：

```text
conditional_transition
```

它表示原文明确给出了一条条件转移，但没有在同一局部事实中给出并列选项，因此不能构成完整 selection。

例：

```text
如果骑手坚持确实无法配送，安慰他们后挂断电话
```

这条事实可表示为：

```text
condition_original_text: "骑手坚持确实无法配送"
target original_text: "安慰他们后挂断电话"
anchor_status: needs_anchor
```

它不是完整 selection，因为没有同时出现另一个并列条件；但它也不能丢弃，因为测试时需要把它接入路径，触发“用户拒绝/坚持无法配送”场景，验证 Agent 是否进入预定流程。

### 接入规则

`conditional_transition` 需要在后处理阶段寻找锚点：

```text
source candidate: 询问是否可以开始配送
condition: 骑手坚持确实无法配送
target: 安慰他们后挂断电话
```

锚点匹配依据：

1. source node 是一个询问/确认/决策类节点。
2. condition 与 source node 的询问主题语义相关。
3. condition 和 target 均有原文 exact match。
4. 多个 source 都可匹配时，不自动选择，输出 ambiguity。

接入后，它可以进入测试路径：

```text
询问是否可以开始配送
  --骑手坚持确实无法配送-->
安慰他们后挂断电话
```

这样主流程可以保持完整，异常/拒绝分支也能作为可测试路径挂接到图上。

## 7. Node 与 Constraint 的边界

不改变流程状态、只规定某类输入下如何回答的句子，不应进入 node-edge 图，应交给后续约束解析。

例：

```text
如用户询问优惠券，回复“本活动暂无优惠券”
```

这不是 minimal graph，而是约束/知识库问答：

```text
trigger: 用户询问优惠券
expected_response: 本活动暂无优惠券
flow_effect: none
```

判断标准：

- 推进流程、询问用户选择、进入下一步、结束/挂断：可以成为 node-edge 事实。
- 只规定回答内容，回答后不改变流程：constraint。

## 8. 投票与合并

### 8.1 并行抽取

并行运行多个 LLM，每路输出 `MinimalGraph[]`。每个 minimal graph 必须包含原文证据。

### 8.2 投票 key

投票不使用 local id，而使用结构事实：

```text
relation_type
source original_text
edge condition_original_text
target original_text
```

对 merge，key 是一组入边事实的集合。

对 conditional_transition，key 是：

```text
condition_original_text
target original_text
anchor hint / source candidate original_text
```

如果多个 LLM 都识别到同一条件转移，但 source anchor 不一致，则保留该 transition，并把 anchor 分歧写入 diagnostics。

### 8.3 节点合并

全局节点合并使用：

```text
exact original_text match 优先
original_text + normalized_goal 次级
```

第一版不做激进语义合并。无法合并的节点先保留，并在 diagnostics 中暴露。

### 8.4 全局 ID 分配

全局 ID 在所有 minimal graph 投票合并完成后由程序分配：

```text
N1, N2, N3...
```

或再渲染为：

```text
A, B, C...
```

LLM 输出的 `local_id` 不允许进入最终 `FlowNode.id`。

## 9. 严格校验

第一版建议失败暴露，不做回退：

- `original_text` 无法在原文中 exact match：该 minimal graph 无效。
- `condition_original_text` 非空但无法匹配原文：该 edge 无效。
- minimal graph 中存在未被 edge 使用的 node：无效。
- selection 只有一条边：降级为 `conditional_transition`，不作为完整 selection。
- merge 少于两条入边：无效。
- inferred/隐含分支：不进入主图，只能进入 diagnostics。

## 10. 测试路径生成

最终需要生成两类路径：

1. `complete_flow_paths`：由 sequence / selection / merge 组成的完整主流程路径。
2. `conditional_test_paths`：由 conditional_transition 接入某个 source node 后形成的专项测试路径。

`conditional_test_paths` 的作用不是补全原文没有写出的完整业务流程，而是主动触发某条条件边，验证 Agent 是否能从当前节点跳到预期处理。

例如：

```text
完整路径:
告知合同生效并询问是否可以开始配送 -> 说明合同要求 -> 鼓励并提醒安全

条件测试路径:
告知合同生效并询问是否可以开始配送
  --骑手坚持确实无法配送-->
安慰他们后挂断电话
```

因此，“被动检查主路径”与“主动触发条件转移”需要分开记录，但可以共享同一套全局节点。

## 11. 中间产物可观察性

为了定位不确定性从哪里引入，实验 CLI 必须保存分阶段产物，而不是只保存最终图。

当前 `run_minimal_relation_parse.py` 会在总报告旁边生成 artifacts 目录：

```text
<report_stem>_artifacts/
  00_source_texts.json
  01_candidates.json
  01b_rejected_graphs.json
  02_voted_graphs.json
  03_global_nodes.json
  04_flow_edges.json
  05_conditional_edges.json
  06_paths.json
  07_diagnostics.json
  summary.md
```

对应排查问题：

- `00_source_texts.json`：看 deterministic source sentence 切分是否正确。
- `01_candidates.json`：看三路 LLM 原始 minimal graph 是否一致。
- `01b_rejected_graphs.json`：看被 strict validation 丢弃的 graph 原始内容和原因。
- `02_voted_graphs.json`：看投票是否丢掉了关键结构事实。
- `03_global_nodes.json`：看原文节点合并是否错误。
- `04_flow_edges.json`：看完整主流程边是否错误。
- `05_conditional_edges.json`：看单条条件边是否正确接入 source。
- `06_paths.json`：看完整路径和条件测试路径是否符合预期。
- `07_diagnostics.json`：看 exact match、锚定、少数派丢弃等问题。

## 12. 待定问题

1. Markdown exact match 是否保留格式字符，例如 `**Y 天**`。
2. “挂断电话/结束通话”是否建 terminal node，还是使用 terminal edge。
3. `conditional_transition` 的 source anchor 打分规则如何设计。
4. `并`、`且`、`同时` 作为同一 node 的规则是否只限同一轮 Agent 回复。
5. 是否需要先做 deterministic sentence segmentation，再让 LLM 引用 `source_sentence_id`。

## 13. v3 方向：逐句两阶段 LLM 捕捉关系

如果长指令格式不断变化，基于标题和 Markdown 结构的切分会很脆。v3 实验改成句子中心：

```text
全局一次性抽取
  -> 先让 LLM 基于完整长指令抽取全部 minimal graph

全文上下文 + 当前行（单行层）
  -> 第一次调用：优先捕捉当前行内部关系

全文上下文 + 五行滑动窗口（小窗口层）
  -> 如果单行层为 none，第二次调用当前行上下各两行
  -> 捕捉局部 sequence / selection / merge / conditional_transition

合并候选池
  -> 单行候选 + 小窗口候选 + 全局候选一起投票
```

这个方案的核心不是让 LLM 标 span，而是让 LLM 同时从三个尺度捕捉关系事实：全局调用负责补齐长程 selection/merge 和完整流程；单行调用负责保留句内/行内敏感性；五行窗口调用负责捕捉局部跨行关系。行内部可以有多个 node/edge；如果行内没有关系，再看上下各两行是否构成 sequence/selection/merge/conditional_transition。这里刻意按非空行切分，而不是按标点切分，避免把一句话术中的多个动作提前切碎。

实验入口：

```bash
uv run python run_sentence_relation_parse.py data/sample_instruction_rider.md -o output/rider_sentence_v1.json -n 3 --limit 20
```

中间产物：

```text
<report_stem>_artifacts/
  00_sentences.json
  00b_global_results.json
  01_internal_results.json
  02_context_results.json
  03_candidates.json
  04_rejected_graphs.json
  05_voted_graphs.json
  06_global_nodes.json
  07_edges.json
  08_paths.json
  09_diagnostics.json
  summary.md
```

排查重点：

- `00b_global_results.json`：完整长指令一次性抽取出的 minimal graph。
- `01_internal_results.json`：句内关系是否被捕捉。
- `02_context_results.json`：单行 none 后，五行滑动窗口关系是否被捕捉。
- `04_rejected_graphs.json`：LLM 输出的关系是否因原文不匹配或结构不合法被丢弃。
- `05_voted_graphs.json`：多路投票是否把少数但关键的关系丢掉。

### Merge 的当前实现边界

`merge` 有两层：

1. LLM 可以显式输出 `relation_type="merge"`，但这要求它在同一个 minimal graph 中给出至少两条入边。
2. 后处理会从组装后的 `flow_edges` 中派生 `merge_points`：任意节点如果有两个及以上不同 source 指向它，就作为汇合点展示。

因此即使 `05_voted_graphs.json` 中没有显式 `merge`，也要看 `07_edges.json` 里的 `merge_points`。这层解决的是“图中实际存在汇合，但报告没有显式暴露”的问题。
