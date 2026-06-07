# PPT 图片生成 Prompt 清单

> 风格要求（所有图片共享）：
> - 扁平化矢量插画风格，微立体感，线条干净利落
> - 主色美团黄 #FFD100，辅色深灰 #333333，点缀色 #FF4D4F（红色/警示）、#52C41A（绿色/通过）
> - 白色或极浅灰 #FAFAFA 背景
> - 无照片质感，无渐变光晕，无 3D 渲染
> - 中文标注用思源黑体风格（如果 Gemini 能渲染中文的话）
> - 16:9 比例，适合 PPT 全屏

---

## P2 · 痛点 + 方案 + 定位

### 图 2A：三列痛点卡片

```
Create a flat vector illustration in 16:9 aspect ratio for a presentation slide.

Three cards side by side on a white background:

Left card: A clock icon with speed lines, representing "too slow / time-consuming". The clock is styled in warm gray (#333333). A small red badge shows "×" mark.

Center card: A magnifying glass scanning a small dot, representing "low coverage / can't see the full picture". The magnifying glass is in warm gray. The dot is tiny compared to the glass.

Right card: A tangled maze or knot of lines with question marks floating around, representing "hard to trace root cause". The maze lines are in warm gray with red (#FF4D4F) question marks.

Style: flat vector, minimal, clean lines, no gradients, no 3D, no shadows except a very subtle drop shadow under each card. Cards have rounded corners. Color palette: #333333 (primary), #FFD100 (accent on card borders), #FF4D4F (warning), white background. No text.
```

### 图 2B：产品流程一图

```
Create a flat vector illustration in 16:9 aspect ratio showing a simple 3-step pipeline flowing left to right.

Step 1 (left): A document icon (representing "input instruction"). Border color #FFD100.
Step 2 (center): A chat bubble icon with a gear inside (representing "auto simulate & evaluate"). Border color #FFD100.
Step 3 (right): A report card icon with a red highlight on one line and a green checkmark on another (representing "diagnostic report with per-constraint results"). Border color #FFD100.

Between each step, a right-pointing arrow in #333333.

Below the pipeline, a subtle dividing line, and beneath it a small tagline area (empty, no text needed).

Style: flat vector, minimal, clean lines, no gradients, no 3D. Color palette: #FFD100 (borders and accents), #333333 (arrows and icons), #FF4D4F (red highlight on report), #52C41A (green checkmark), white background. Rounded corners on icons.
```

---

## P3 · V2 的 7 次 7 种图

### 图 3A：7 张混乱的小流程图并排

```
Create a flat vector illustration in 16:9 aspect ratio.

Seven small flowchart diagrams arranged in a 2-row grid (4 on top, 3 on bottom). Each flowchart is different — different number of nodes, different connections, some with isolated nodes floating disconnected, some with branches going different directions. The visual impression should be "chaos" and "inconsistency" — none of the seven look alike.

Each flowchart uses small circles as nodes connected by lines with arrows. Node colors alternate between #333333 and #FFD100. One or two flowcharts have a node colored #FF4D4F to indicate errors.

Background: white. A thin #FFD100 border around the entire illustration. No text labels on nodes.

Style: flat vector, schematic, clean thin lines, no gradients, no 3D. The seven diagrams should genuinely look different from each other — different topologies, different branching patterns.
```

---

## P4 · V3 的 6/6 稳定

### 图 4A：6 张一致的小流程图并排

```
Create a flat vector illustration in 16:9 aspect ratio.

Six small flowchart diagrams arranged in a single row. All six are IDENTICAL — same 5 nodes in the same topology with the same connections. The visual impression should be "stability" and "consistency" — perfect alignment.

Each flowchart uses small circles as nodes connected by lines with arrows. Node colors: #333333. A subtle green #52C41A checkmark badge in the corner of each diagram.

Background: white. A thin #FFD100 border around the entire illustration. No text labels.

Style: flat vector, schematic, clean thin lines, no gradients, no 3D. The six diagrams must be pixel-perfect copies of each other to emphasize the contrast with the previous slide's chaos.
```

---

## P5 · V3 的局限 → V4 的转向

### 图 5A：从图到文本的转向

```
Create a flat vector illustration in 16:9 aspect ratio showing a conceptual transition.

Left half: A complex flowchart/graph diagram with nodes and edges, crossed out with a large diagonal red line (#FF4D4F). The graph looks intricate but unstable — some edges are dashed to suggest uncertainty.

Right half: A clean paragraph of text (represented as horizontal lines of varying length, like a text placeholder) with several spans highlighted in #FFD100. An arrow points from one highlighted span to a small chat bubble, suggesting "pick a constraint from the original text directly."

A large curved arrow connects the left (crossed-out graph) to the right (text approach), suggesting a pivot or paradigm shift.

Style: flat vector, minimal, clean lines, no gradients, no 3D. Color palette: #333333 (primary elements), #FFD100 (highlights and arrow), #FF4D4F (cross-out line), white background.
```

---

## P6 · V4 核心思路

### 图 6A：V4 单轮数据流

```
Create a flat vector illustration in 16:9 aspect ratio showing a horizontal data flow pipeline.

Left to right flow:

1. "Original Instruction" — represented as a text document icon
2. Arrow pointing right
3. "User LLM" — represented as a brain/robot head icon
4. Arrow pointing right, with a small label "constraint + user message"
5. "Dual Gate" — represented as two overlapping shield icons, one with a gear symbol (code gate) and one with a brain symbol (LLM gate). The gear shield is solid #333333, the brain shield is #FFD100.
6. Arrow pointing right
7. "Agent" — represented as a headset/customer service icon
8. Arrow pointing right
9. "Eval" — represented as a clipboard with checkmark icon

Below the main flow, a subtle annotation showing "Segment" spanning steps 4-8.

Style: flat vector, minimal, clean lines, no gradients, no 3D. Color palette: #FFD100 (User LLM and LLM gate), #333333 (code gate, arrows, other icons), #52C41A (eval checkmark), white background. Rounded corners where applicable. No text — icons only.
```

---

## P7 · 架构一页

### 图 7A：V4 系统架构鸟瞰

```
Create a flat vector illustration in 16:9 aspect ratio showing a system architecture overview.

The layout has three horizontal layers:

Top layer: A row of 4 small "conversation worker" cards (each with a chat bubble icon), labeled C0, C1, C2, C3. They are connected by thin lines to the middle layer. These represent parallel conversation groups.

Middle layer: A central rectangular block labeled "V4Collector" in the center. Inside the block, a circular arrow suggesting a loop/batch cycle. Two small icons inside: one shield (gate) and one bar chart (coverage).

Bottom layer: Two output items side by side — a JSON document icon and a report/chart icon.

Arrows flow: bottom-up from a document icon "Instruction.md" into the V4Collector. V4Collector dispatches to the 4 workers. Workers feed back into V4Collector. V4Collector outputs to the bottom layer.

Color: #FFD100 for the V4Collector block border, #333333 for arrows and worker cards, #52C41A for the report output, white background. Very subtle grid pattern in the background.

Style: flat vector, clean architecture diagram style, thin lines, no gradients, no 3D, no shadows. Minimal and professional.
```

---

## P10 · 报告解读

### 图 10A：终端报告截图（不需要 Gemini，直接用真实终端输出截图）

但可以准备一张美化版：

```
Create a flat vector illustration in 16:9 aspect ratio showing a stylized terminal/report output.

A dark-gray (#333333) rounded rectangle representing a terminal window. Inside, simulate a report with several rows of data:

- 3 rows with a green bar (#52C41A) on the left and horizontal lines representing text (placeholder)
- 1 row with a RED bar (#FF4D4F) on the left, this row is slightly larger/highlighted to draw attention. A small warning triangle icon next to it.

The red row should be visually dominant — perhaps a subtle glow or slightly larger than the green rows.

Top of terminal: three dots (red, yellow, green) mimicking a macOS window title bar.

Style: flat vector, clean, the terminal should look modern and professional. No actual text needed — just colored bars and placeholder lines. Color palette: #333333 (terminal background), #52C41A (green rows), #FF4D4F (red highlighted row), #FFD100 (subtle accent), white slide background.
```

---

## P11 · Before/After 闭环

### 图 11A：Before/After 对比

```
Create a flat vector illustration in 16:9 aspect ratio showing a before-and-after comparison.

Left half (Before):
- Label area at top (empty, no text)
- A horizontal bar chart showing a bar at 47% height, colored red (#FF4D4F)
- Below the bar: a small instruction document icon with a red underline on one line
- Overall mood: problem identified

Center: A large right-pointing arrow in #FFD100, with a small pencil/edit icon above it, suggesting "change the instruction"

Right half (After):
- Label area at top (empty, no text)
- A horizontal bar chart showing a bar at 85% height, colored green (#52C41A)
- Below the bar: the same instruction document icon but with the previously-red line now highlighted in #FFD100 and showing a different wording (represented by slightly different line patterns)
- Overall mood: problem solved

Style: flat vector, minimal, clean lines, no gradients, no 3D. The before and after sides should be clearly separated by the central arrow. Color palette: #FF4D4F (before bar), #52C41A (after bar), #FFD100 (arrow and highlights), #333333 (documents and labels), white background.
```

---

## P12 · 收尾

### 图 12A：三列闭环卡片

```
Create a flat vector illustration in 16:9 aspect ratio showing three matched pairs in a row.

Three columns, each with a small icon on top and a larger icon below:

Column 1:
- Top icon: A stopwatch (representing "slow")
- Downward arrow in #FFD100
- Bottom icon: A rocket or lightning bolt (representing "fast/automated")

Column 2:
- Top icon: A small magnifying glass over a tiny area (representing "low coverage")
- Downward arrow in #FFD100
- Bottom icon: A full scan/grid pattern (representing "full coverage")

Column 3:
- Top icon: A question mark inside a tangled knot (representing "hard to diagnose")
- Downward arrow in #FFD100
- Bottom icon: A pinpoint/location marker on a specific line of a document (representing "precise diagnosis")

Each column has a subtle #FFD100 vertical line connecting the arrow to both icons.

Style: flat vector, minimal, clean lines, no gradients, no 3D. Top icons in #FF4D4F (problem), bottom icons in #52C41A (solution), arrows in #FFD100, white background.
```

---

## 封面图（可选）

### 图 1A：封面插画

```
Create a flat vector illustration in 16:9 aspect ratio for a presentation cover slide.

Center composition: A large document icon on the left, with several lines of "text" (represented as horizontal bars) inside it. From this document, 4-5 thin colored lines flow rightward into a central "evaluation engine" represented as a circular gear-like shape in #FFD100. From the gear, lines flow further right into a report card with a red line and a green line, and a small target/bullseye icon.

The overall visual metaphor: instruction → evaluation engine → pinpointed diagnostic.

Background: white with a very subtle dot grid pattern in light gray.

Style: flat vector, minimal, clean geometric lines, no gradients, no 3D, no characters, no photos. Color palette: #FFD100 (gear and accent lines), #333333 (document, report, and primary lines), #FF4D4F (one red line in report), #52C41A (one green line in report), white background. Professional and modern.
```

---

## 使用说明

1. 所有 prompt 都是英文写的，直接喂给 Gemini
2. 如果 Gemini 生成效果偏写实或偏 3D，在 prompt 末尾追加：`Strictly flat 2D vector style. No realistic rendering. No 3D perspective. Think of illustrations in Stripe's website or Linear's marketing pages.`
3. 图片生成后建议统一调整色调，确保 #FFD100 的黄色和 PPT 主题色一致
4. P3 和 P4 是对比页，两张图要一脉相承：同样的节点圆圈、同样的连线风格，唯一区别是 P3 混乱、P4 一致
5. P10 的报告截图建议直接用真实终端输出截图，Gemini 生成的美化版作为备选
