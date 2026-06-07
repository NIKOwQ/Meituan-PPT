# AI 长指令遵循能力自动评测系统

> 给 AI Agent 一段超长指令（客服话术、操作规范、SOP），它真的每条都遵守了吗？
> 本系统自动生成多轮测试对话，逐条验证，输出量化评分报告。

---

## 一句话说明

系统接收一段 **Markdown 格式的长指令**，自动派发多个并行测试对话——用 LLM 扮演用户，按指令中的约束逐一试探 Agent 是否遵守——最终输出 **逐约束通过率 + 覆盖率 + 完整对话流** 的结构化报告。

## 它能测什么

长指令中的**任何文本片段**都是可测试的约束，覆盖六大维度：

| 维度 | 测试方式 | 示例 |
|---|---|---|
| **角色** (Role) | 诱导 Agent 偏离角色 | "你是 AI 吗？"、"帮我查快递" |
| **任务** (Task) | 诱导执行职责外任务 | 让客服帮忙投诉、退款 |
| **流程** (Call Flow) | 跳步 / 提前问 / 拒绝配合 | 跳过通知直接问退出规则 |
| **知识** (Knowledge) | 提问检查回答准确性 | "单日合同每天要完成几单？" |
| **开场白** (Opening Line) | 触发第一轮对话 | 直接问"你是谁？" |
| **显式约束** (Constraints) | 直接触发条件 | 连续追问测试"不重复回复" |

---

## 快速开始（3 分钟上手）

### 1. 安装依赖

```bash
# 方式 A：uv（推荐）
uv sync

# 方式 B：pip
pip install -r requirements.txt
```

需要 **Python 3.12+**。

### 2. 配置 API Key

```bash
cp .env.example .env
```

编辑 `.env`，填入你的 LLM API 信息：

```env
DG_LLM_API_KEY=sk-your-key-here
DG_LLM_BASE_URL=https://api.openai.com/v1
DG_LLM_MODEL=gpt-4o
```

> 系统通过 OpenAI SDK 调用 LLM，因此**兼容任何 OpenAI 格式的 API**（Azure、自部署网关等）。
> 三个 LLM 角色（User/Agent/Judge）共用同一组配置。

### 3. 运行测试

#### 方式 A：Web 界面（推荐体验）

```bash
uvicorn V4forclaude.server:app --host 0.0.0.0 --port 8000
```

打开 http://localhost:8000 ，在浏览器中：
1. 选择或粘贴一段长指令
2. 点击「开始评测」
3. 实时观看 SSE 进度流
4. 查看量化报告 + 逐条对话详情

#### 方式 B：命令行

```bash
# 快速冒烟测试（约 2-5 分钟）
uv run python V4forclaude/run_v4_dataset.py V4forclaude/data/sample_instruction_rider.md \
    --max-turns 10 --min-tests 2 --coverage 0.4 --parallel 3 --evaluate

# 完整测试
uv run python V4forclaude/run_v4_dataset.py V4forclaude/data/sample_instruction_rider.md \
    --max-turns 30 --min-tests 3 --coverage 0.6 --parallel 5 --evaluate
```

### 4. 查看报告

CLI 模式下，报告自动保存到 `V4forclaude/output/<时间戳>_<文件名>/`：

```
output/20260607_171110_sample_instruction_rider/
├── report.json                           # 完整结构化报告
└── report_artifacts/
    ├── 00_cleaned_instruction.txt         # 清洗后的长指令
    ├── 00b_opening_lines.json             # Agent 开场白
    ├── 01_constraint_stats.json           # 逐约束覆盖统计
    ├── 02_turns.json                      # 所有对话轮次
    ├── 02a_conversation_groups.json       # 对话组
    ├── 03_evaluations.json                # LLM 评估结果
    ├── 03b_segments.json                  # 测试片段
    ├── 04_diagnostics.json                # 诊断信息
    └── summary.md                         # 人类可读摘要
```

Web 界面下，报告在页面内直接渲染，也可从历史记录中加载。

---

## 报告解读

### 终端输出示例

```
================ V4 评测报告 ================
来源文件: sample_instruction_rider.md
耗时: 234.5s

总体评分:
  约束覆盖率:     64.66%
  已测试约束数:   17
  测试片段总数:   74
  评估片段总数:   74
  总通过率:       77.0%  [██████████████████████████████░░░░░░░░░░]

逐约束评估明细:
  约束                                          片段  通过  失败  无效  通过率
  ─────────────────────────────────────────────────────────────────────
  告知骑手今天飞毛腿合同已生效...                   8     8     0     0   100%  ████████
  保持语气随意，像打电话一样自然                    12    9     3     0    75%  ██████░░
  如果骑手坚持确实无法配送...                       10    3     7     0    30%  ███░░░░░ ← Agent 弱点
  每次回复控制在约30个字以内                        6     1     5     0    17%  █░░░░░░░ ← Agent 弱点
```

### 关键指标

| 指标 | 含义 |
|---|---|
| **覆盖率** | 被至少一条约束文本覆盖的内容字符 / 总内容字符（排除了标题、编号等结构性文本） |
| **通过率** | Agent 在所有测试片段中通过评估的比例 |
| **逐约束明细** | 每条约束被测了几次、Agent 通过了几次，一目了然地暴露 Agent 弱点 |

---

## 工作原理

```
原始 Markdown 长指令
  │
  ▼ ① 清洗为单行（删除换行，保留全文）
  │
  ▼ ② 循环派发批次（每批 N 组并行对话）
  │
  └─── 每组对话 ──────────────────────────────┐
       │                                      │
       │  Agent 生成开场白                     │
       │         │                            │
       │         ▼ 循环：                      │
       │  User LLM 生成候选消息 ──┐            │
       │         │               │            │
       │         ▼               │            │
       │  代码门控（精确子串检查、│            │
       │  去重、格式校验）        │            │
       │         │ 失败 → 跳过本轮 ──→ 回到 ▲  │
       │         ▼ 通过                      │
       │  LLM 门控（语义验证消息能│            │
       │  否有效触发该约束）      │            │
       │         │ 失败 → 跳过本轮 ──→ 回到 ▲  │
       │         ▼ 通过                      │
       │  Agent 回复                          │
       │         │                            │
       │         ▼ 记录 Turn + Segment        │
       │  覆盖率更新 → 达标？→ 退出循环        │
       │                                      │
       └──────────────────────────────────────┘
                │
                ▼ ③ 定向补充（覆盖率达标后，半数组
                │    强制从未充分测试的约束中选题）
                ▼ ④ 可选：对每个 Segment LLM 评估
                ▼ ⑤ 输出结构化报告
```

### 核心设计

- **双重门控**：代码门控拦截机械错误（非原文子串 / 重复 / 格式），LLM 门控拦截语义错误（消息不适配约束）。两层过滤确保测试数据质量。
- **覆盖率驱动**：不是盲目生成对话，而是实时计算覆盖率，自动识别低覆盖区域并优先补充测试。
- **定向补充**：覆盖率达标后，半数对话组强制从未充分测试的约束中选题，加速补齐短板。
- **标准化去重**：同一约束末尾标点不同时自动合并，避免重复测试。

---

## CLI 参数

```bash
uv run python V4forclaude/run_v4_dataset.py <指令文件.md> [选项]
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `instruction` | — | 长指令 Markdown 文件路径（必填） |
| `-o / --output` | 自动生成 | 输出 JSON 路径 |
| `--max-turns` | 100 | 每组对话最大轮数 |
| `--max-retries` | 3 | 每轮门控重试次数 |
| `--max-pending-turns` | 3 | 多轮约束最大轮数 |
| `--coverage` | 0.9 | 目标覆盖率（0~1） |
| `--min-tests` | 5 | 每条约束最少测试次数 |
| `--parallel` | 5 | 每批并行对话组数 |
| `--evaluate` | 关闭 | 启用 LLM 评估（对每个 Segment 评判 Agent 是否通过） |
| `--targeted-threshold` | 0.5 | 覆盖率达到此值后开启定向补充对话 |

**推荐参数组合：**

```bash
# 快速冒烟（2-5 分钟，验证系统能跑通）
--max-turns 10 --min-tests 2 --coverage 0.3 --parallel 2 --evaluate

# 标准测试（10-20 分钟，得到有参考价值的报告）
--max-turns 30 --min-tests 3 --coverage 0.6 --parallel 5 --evaluate

# 深度测试（30-60 分钟，覆盖率拉满）
--max-turns 50 --min-tests 5 --coverage 0.8 --parallel 5 --evaluate
```

---

## Web API

`server.py` 同时提供 REST API 和 SSE 实时进度，供前端或第三方集成：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/instructions` | 列出 data/ 中的指令文件 |
| `GET` | `/api/instructions/{name}` | 读取指定指令内容 |
| `POST` | `/api/instructions` | 保存新指令到 data/ |
| `POST` | `/api/runs` | 启动评测任务 |
| `GET` | `/api/runs/{id}` | 查询任务状态和结果 |
| `GET` | `/api/runs/{id}/stream` | SSE 实时进度流 |
| `POST` | `/api/runs/{id}/cancel` | 取消任务 |
| `GET` | `/api/reports` | 列出历史报告 |
| `POST` | `/api/evaluations` | 对已有报告补跑评估 |

---

## 自定义长指令

把你的 Markdown 长指令放入 `V4forclaude/data/` 即可。推荐的格式：

```markdown
# Role
你是 [角色描述]

# Task
[任务描述]

# Opening Line
[开场白模板]

# Call Flow
1. 步骤一
2. 步骤二
3. ...

# Knowledge Points (FAQ)
- 知识点一
- 知识点二

# Constraints
- 约束一
- 约束二
```

系统会自动识别这些段落标题，计算**逐段落覆盖率**，引导 User LLM 优先测试低覆盖区域。

---

## 文件结构

```
V4forclaude/
├── run_v4_dataset.py   # CLI 入口：命令行运行评测
├── server.py           # Web 入口：FastAPI + SSE，托管前端
├── collector.py        # 核心编排：V4Collector 类，对话派发 + 门控 + 评估
├── agent.py            # Agent 模拟：FlowAgent，接收长指令 + 历史，返回回复
├── prompts.py          # Prompt 模板：User/Gate/Eval 三个 LLM 角色的提示词
├── models.py           # 数据模型：10 个 Pydantic 模型（报告/轮次/片段/评估等）
├── coverage.py         # 覆盖率计算：纯函数，无 LLM 依赖，可独立测试
├── render.py           # 报告输出：终端渲染 + JSON 持久化 + 中间产物
├── llm_utils.py        # LLM 工具：OpenAI 客户端创建 + JSON 提取/修复
├── .env                # API 配置（DG_LLM_API_KEY / BASE_URL / MODEL）
├── pyproject.toml      # 依赖声明
├── data/               # 长指令样本（.md）+ 自定义指令
├── output/             # 运行产物（报告 + artifacts）
└── docs/               # 系统设计文档
```

---

## 依赖

| 包 | 版本 | 用途 |
|---|---|---|
| `openai` | ≥ 2.38 | LLM 调用（User/Agent/Gate/Eval 四个角色） |
| `python-dotenv` | ≥ 1.2 | .env 环境变量加载 |
| `pydantic` | ≥ 2.0 | 数据模型 + JSON 序列化（openai 传递依赖） |
| `fastapi` | ≥ 0.110 | Web 服务 + REST API |
| `uvicorn[standard]` | ≥ 0.29 | ASGI 服务器 |
| `sse-starlette` | ≥ 2.0 | SSE 实时进度推送 |

---

## 示例长指令

`data/` 目录自带两个样本指令，可直接运行：

| 文件 | 场景 |
|---|---|
| `sample_instruction_rider.md` | 美团骑手站长致电"飞毛腿"骑手，通知合同生效 |
| `sample_instruction_merchant.md` | 美团 BD 致电商家，推广合作方案 |

---

## 部署

详见项目根目录的 [`DEPLOYMENT.md`](../DEPLOYMENT.md)。支持：
- 本地运行（`uvicorn`）
- Docker（`docker build && docker run`）
- 云平台（Render / Railway / Fly.io，已提供 `render.yaml` 和 `Dockerfile`）
