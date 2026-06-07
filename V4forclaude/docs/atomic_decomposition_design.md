# 原子拆分校验方案设计文档

> 版本：v1.0 · 2026-06-04 · 模块 1 parse 管线改造

---

## 1. 背景与动机

### 1.1 旧方案

模块 1 的 parse 管线原有流程：

```
原始 Markdown
  → LLM 文本抽取
  → LLM 一次性生成完整节点图（_FLOW_USER，并行 3 次 + 多路投票合并）
  → 路径枚举 + 剪枝
  → ParsedInstruction
```

其中 `_FLOW_USER` prompt 要求 LLM 在一次调用中完成：
1. 阅读整条长指令
2. 理解所有步骤和分支关系
3. 推理完整的 Mermaid 流程图（`<thinking_process>`）
4. 输出严格的 JSON 节点图（`<final_output>`）

三个并行结果通过 `_vote_merge_nodes` 投票合并。

### 1.2 问题

用 `sample_instruction_rider.md` 连续运行 7 次，产出了 **7 种不同的图结构**：

| 运行 | 节点数 | 拓扑 | 歧义数 | Block 诊断 |
|---|---|---|---|---|
| 1 | 5 | A→B→C→E, B→D→E | 8 | 0 |
| 2 | 5 | A→B→C→D→E, B→D | 9 | 0 |
| 3 | 5 | A→B→C→D→E | 7 | 0 |
| 4 | 5 | A→B, A→C→D, E 孤立 | 5 | 2 (unreachable + multiple starts) |
| 5 | 5 | A→B→C, B→D→E | 7 | 1 (action has conditional) |
| 6 | 6 | A→B→C, B→D→E, F 孤立 | 7 | 0 |
| 7 | 5 | A→B→C→D→E, D→E | 6 | 2 (insufficient branches + action has conditional) |

**根因**：让 LLM 一次性理解整条长指令并输出完整图，模糊空间太大。rider 指令的 5 条 flow_constraints 是一个平铺列表，不包含显式的分支结构，LLM 必须自行推断哪些是顺序步骤、哪些是条件分支，这个推断过程是非确定性的。

### 1.3 核心思路

> **将模糊空间从「整个图」缩小到「单条边」。**

不再让 LLM 一次生成完整图，而是分步完成：
1. **抽取原子节点** — 只识别「有几个步骤」，不涉及连接关系
2. **抽取原子边** — 给定节点列表，识别转移关系
3. **逐三元组投票校验** — 对每条边独立验证是否忠实于原文

每一步的 LLM 任务更聚焦、输出更简短，非确定性显著降低。

---

## 2. 方案设计

### 2.1 四阶段管线

```
原始 Markdown
  → Phase A: 原子节点抽取（_NODES_USER，并行 3 次 + 投票合并）
  → Phase B: 原子边抽取（_EDGES_USER，并行 3 次 + 投票合并）
  → Phase C: 逐三元组投票校验（_VALIDATE_TRIPLET_USER，每条边 3 次 + 多数通过）
  → Phase D: 组装 FlowNode 图（过滤孤立节点 + 自动修正 node_type）
```

### 2.2 Phase A：原子节点抽取

**目标**：从原始指令中识别所有独立的对话步骤/决策点。

**LLM 调用**：3 次并行，每次返回节点列表。

**Prompt 设计要点**（`_NODES_USER`）：
- 任务单一：仅识别「有几个动作/决策点」，**不涉及它们之间的连接关系**
- 禁止为决策结果创建子节点 — 决策的各个出口（「是/否」）是边，不是独立节点
- 禁止拆分同一步骤的子动作 — 顺序子动作合并为一个节点
- 禁止相邻节点语义重复
- 输出简短 JSON 数组

**投票规则**：
- 节点 ID 出现 ≥ 2 次 → 保留
- `name`：多数一致的取一致的，全不一致取最长的，记录歧义
- `node_type`：多数投票

**输出**：`list[AtomicNode]` + `list[str]`（歧义列表）

### 2.3 Phase B：原子边抽取

**目标**：给定共识节点列表，识别节点之间的转移关系。

**LLM 调用**：3 次并行，每次返回边列表。输入包含原始指令 + Phase A 产出的共识节点。

**Prompt 设计要点**（`_EDGES_USER`）：
- 输入中列出所有已识别节点（ID + 名称 + 类型）
- 识别节点间的转移条件和目标
- condition 为空字符串表示顺序执行（无需用户选择）
- 禁止遗漏、禁止重复边

**投票规则**：
- `(source, target)` 对出现 ≥ 2 次 → 保留
- `condition`：多数一致的取一致的，全不一致取最长的
- 记录哪些边在所有调用中完全一致 → 用于 Phase C 跳过优化

**输出**：`list[AtomicEdge]` + `list[str]`（歧义列表）+ 标记全一致的边

### 2.4 Phase C：逐三元组投票校验

**目标**：对每条共识边，独立校验其是否忠实反映了原始指令。

**LLM 调用**：
- **跳过优化**：Phase B 中 3 次调用完全一致的边（条件文本一字不差）自动通过，不调用 LLM
- 其余边：每条边 3 次并行 LLM 调用

**Prompt 设计要点**（`_VALIDATE_TRIPLET_USER`）：
- 输入：原始指令 + 单个三元组 (source_name, condition, target_name)
- 任务：判断该转移是否在原文中有明确依据
- 输出：`{"valid": true/false, "evidence": "...", "issue": "..."}`
- 该 prompt 非常聚焦，LLM 只需检查一条边

**投票规则**：
- ≥ 2/3 判定为 valid → 通过
- 否则标记为 ambiguous（仍保留在图中，但记录 issue）

**输出**：`list[TripletVerdict]`

### 2.5 Phase D：组装

**目标**：将原子节点 + 验证过的边组装为 `dict[str, FlowNode]`。

**处理步骤**：
1. 报告 Phase C 校验失败的边（作为歧义记录）
2. 过滤孤立节点 — 不在任何边中且不是起点的节点被移除
3. 过滤指向不存在节点的边
4. **自动修正 node_type**：
   - `action` 节点有 ≥ 2 个条件分支 → 修正为 `decision`
   - `decision` 节点条件分支不足 → 修正为 `action`
5. 组装为 `FlowNode` 字典

**输出**：`dict[str, FlowNode]` + `list[str]`（歧义列表）

---

## 3. 数据模型

### 3.1 新增模型

```python
class AtomicNode(BaseModel):
    """原子节点：从指令中提取的最小动作/决策点"""
    id: str
    name: str
    node_type: str  # "action" | "decision"

class AtomicEdge(BaseModel):
    """原子边：两个节点之间的转移"""
    source_id: str
    condition: str
    target_id: str

class TripletVerdict(BaseModel):
    """三元组校验结果"""
    source_id: str
    condition: str
    target_id: str
    valid: bool
    votes: int          # 通过票数（满分 3）
    evidence: str = ""
    issue: str = ""
```

### 3.2 模型关系

```
Phase A: AtomicNode[] ────┐
                          ├─→ Phase D: FlowNode{branches: Branch[]}
Phase B: AtomicEdge[] ────┤
                          │
Phase C: TripletVerdict[] ┘
```

`TripletVerdict` 不进入最终 `ParsedInstruction`，仅在管线内部使用，通过歧义列表间接暴露。

---

## 4. LLM 调用量分析

| 阶段 | 调用次数 | 说明 |
|---|---|---|
| Phase A | 3 | 节点抽取 × 3 投票 |
| Phase B | 3 | 边抽取 × 3 投票 |
| Phase C | 最多 N×3 | N = 非全一致边数；全一致的边跳过 |
| **典型总计** | **6 ~ 24** | rider: 6+0=6; merchant: 6+18=24 |

- rider 指令（5 节点 5 边）：Phase B 通常全一致 → Phase C 全跳过 → 总计 **6 次**
- merchant 指令（20 节点 25 边）：Phase B 有分歧 → Phase C 需校验 → 总计 **~24 次**

**对比旧方案**：旧方案固定 3 次（但每次 prompt 更长、更复杂，生成完整图）

所有 Phase 内的并行调用均可并发执行（`ThreadPoolExecutor`），实际墙钟时间取决于最慢的单次调用。

---

## 5. 实验结果

### 5.1 Rider 指令稳定性

用 `sample_instruction_rider.md` 连续运行 6 次：

| 运行 | 节点数 | 拓扑 | 歧义数 | Block 诊断 |
|---|---|---|---|---|
| 1 | 5 | A→B→C→E, B→D→E | 0 | 0 |
| 2 | 5 | A→B→C→E, B→D→E | 0 | 0 |
| 3 | 5 | A→B→C→E, B→D→E | 0 | 0 |
| 4 | 5 | A→B→C→E, B→D→E | 0 | 0 |
| 5 | 5 | A→B→C→E, B→D→E | 0 | 0 |
| 6 | 5 | A→B→C→E, B→D→E | 0 | 0 |

**6/6 运行拓扑完全一致，0 block 诊断。**

节点名称措辞略有差异（如"提醒"vs"说明"），但结构和语义完全一致。

### 5.2 新旧方案对比

| 指标 | 旧方案（7 次运行） | 新方案（6 次运行） |
|---|---|---|
| 一致的拓扑结构 | **0/7** | **6/6** |
| 一致的节点类型 | **0/7** | **6/6** |
| Block 诊断出现率 | **3/7 (43%)** | **0/6 (0%)** |
| 节点数范围 | 5-6 不一致 | 5 一致 |
| 分支条件变体数 | 8 种 | 1 种 |
| 歧义数范围 | 5-9 | 0 |

### 5.3 Merchant 指令

Merchant 指令更复杂（~20 节点、多层嵌套分支），新方案仍能产出合理的图结构。

Phase C 的三元组校验精准捕获了多条语义错误的边（0/3 票否决）：
- A→B 跳过了 Step 2（身份确认后应先确认是否知情）
- G→I 跳过了中间步骤
- J/K→N 错误连接了不相关的步骤

这些错误在旧方案中**完全不可见**（旧方案没有逐边校验机制）。

---

## 6. 代码变更

### 6.1 修改文件

**`parser.py`**（唯一改动的文件）

| 变更 | 说明 |
|---|---|
| +3 个数据模型 | `AtomicNode`, `AtomicEdge`, `TripletVerdict` |
| +3 个 prompt | `_NODES_USER`, `_EDGES_USER`, `_VALIDATE_TRIPLET_USER` |
| +4 个方法 | `_extract_nodes_voted`, `_extract_edges_voted`, `_validate_triplets`, `_assemble_graph` |
| +2 个辅助方法 | `_extract_nodes_single`, `_extract_edges_single` |
| ~1 个方法 | `parse()` 步骤 2 改为调用新管线 |
| 保留不动 | `_generate_flow_voted`, `_generate_flow_single`, `_FLOW_USER`（不再被调用，保留作对比） |

### 6.2 不受影响的部分

- `_extract_structured_info()` / `_EXTRACT_USER` — 文本抽取不变
- `_nodes_to_mermaid()` — 原样复用
- `_enumerate_paths()` / `_prune_at_merges()` / `_validate_graph_spec()` — 全部保留
- `run_parser.py` CLI 入口 — 不变
- 所有下游模块（`flow_tester.py`, `constraint_analyzer.py`）— 不变

---

## 7. 已知局限与后续方向

### 7.1 当前局限

1. **Merchant 指令的 node_type 歧义**：Phase A 和 Phase B 对节点类型的判断可能不一致（如 G、M 在 Phase A 被 classification 为 action，但 Phase B 给了条件分支）。Phase D 的自动修正是权宜之计，理想情况下 Phase A 应更准确地判断 node_type。

2. **缺少「不是负责人」分支**：rider 指令中 A 节点（身份确认）缺少 "不是负责人" 分支，因为原文对这种情况只有一句话（"请其转达"），LLM 倾向于不为其创建独立路径。

3. **Phase C 调用量**：对于 Phase B 有大量分歧的复杂指令，Phase C 可能产生较多 LLM 调用。

### 7.2 可能的改进方向

1. **Phase A 增加上下文**：在节点抽取时提供 flow_constraints 列表，帮助 LLM 更准确判断哪些是分支点。

2. **迭代修正**：Phase C 校验失败后，将 issue 反馈给 LLM 重新生成该边的条件或目标，而非仅记录。

3. **条件分支检测**：在 Phase B 之后增加一步，检测「action 节点有条件分支」的情况，自动将 node_type 修正为 decision。

4. **缓存优化**：对同一指令的多次运行缓存 Phase A 结果（节点列表通常很稳定），只重跑 Phase B/C。
