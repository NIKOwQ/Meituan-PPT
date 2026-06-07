(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const array = (value) => Array.isArray(value) ? value : [];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
  const short = (value, length = 42) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length)}…` : text;
  };
  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const state = {
    report: null,
    meta: null,
    instruction: null,
    run: null,
    stream: null,
    speed: 1,
    currentEvent: 0,
    liveCoverage: 0,
    liveSegments: new Set(),
    liveGroups: new Map(),
    currentConversation: 0,
    currentSegment: null,
    currentEvaluation: null,
    evalFilter: "all",
    reportFilter: "all",
    currentConstraint: null,
    mechanism: "gate",
    edge: "code_gate",
  };

  const guides = {
    value: {
      eyebrow: "VALUE PROPOSITION",
      title: "产品界面就是项目说明书",
      body: `<p>整份演示不再把“PPT”和“Demo”分开。评委先看到输入、运行、证据和报告，再按需展开机制与工程细节。</p>
        <ul><li>主层：完成任务所需的信息</li><li>解释层：为什么这样设计</li><li>证据层：数据、公式和原始记录</li></ul>`,
    },
    progressive: {
      eyebrow: "PROGRESSIVE DISCLOSURE",
      title: "主次信息折叠",
      body: `<p>首次使用只暴露三个可解释参数：目标覆盖率、并行度、每约束最低测试次数。</p>
        <p>重试、停滞批次、挂起轮次、定向补充阈值属于工程控制面，默认折叠，但没有被隐藏到不可发现的位置。</p>`,
    },
    map: {
      eyebrow: "INSTRUCTION PLANE",
      title: "原文始终是事实来源",
      body: `<p>系统不要求用户先把长指令改写成特定 DSL，也不假设存在唯一正确的流程图。热力图直接覆盖在原文上，让风险结论可以回到具体措辞。</p>`,
    },
    office: {
      eyebrow: "PARALLEL DISPATCH",
      title: "并行工位不是装饰",
      body: `<p>每个工位代表一组独立对话。批次内并行生成，批次间根据覆盖率决定继续自由发现还是定向补齐弱约束。</p>`,
    },
    timeline: {
      eyebrow: "OFFLINE EVENT STREAM",
      title: "中间产物模拟后端",
      body: `<p>时间线按对话组重建：开场 → Turn → Segment → Evaluation → 完成。每次重置都得到相同顺序，因此现场演示不会受网络与模型随机性影响。</p>
        <p>HTTP 模式优先读取 JSON；file 模式读取同目录静态数据包。</p>`,
    },
    segment: {
      eyebrow: "AUDIT UNIT",
      title: "Segment 是最小归因单位",
      body: `<p>一个 Turn 记录一次用户触发与 Agent 回复；一个 Segment 将围绕同一约束的若干 Turn 收束起来；Evaluation 再对这个片段独立判定。</p>
        <p>这样既保留多轮上下文，也不会把整场对话粗暴压成一个分数。</p>`,
    },
    evaluation: {
      eyebrow: "JUDGEMENT BOUNDARY",
      title: "无效样本不惩罚 Agent",
      body: `<p><b>通过</b>：行为满足约束。<br><b>失败</b>：触发成立，但 Agent 未遵守。<br><b>无效</b>：测试样本本身不足以支持判断。</p>
        <p>通过率只使用有效样本作为分母，避免把评测器的问题转嫁给被测对象。</p>`,
    },
  };

  const mechanisms = {
    gate: {
      title: "双重门控",
      subtitle: "先用确定性规则挡住机械错误，再让 LLM 判断语义是否匹配。",
      canvas: () => `<div class="mechanism-diagram">
        <p class="eyebrow">SERIAL QUALITY GATES</p><h2>无效测试，不进入 Agent。</h2>
        <div class="gate-flow">
          <div class="gate-node"><strong>User LLM</strong><span>选择约束并生成消息</span></div><i class="gate-arrow">→</i>
          <div class="gate-node warn"><strong>代码门控</strong><span>原文子串 · 去重 · 格式</span></div><i class="gate-arrow">→</i>
          <div class="gate-node warn"><strong>语义门控</strong><span>消息是否真的触发约束</span></div><i class="gate-arrow">→</i>
          <div class="gate-node good"><strong>Agent</strong><span>只接收有效测试</span></div>
        </div></div>`,
      notes: `<h2>确定性与语义判断分层</h2><p>代码能够准确判断的事情不交给 LLM；只有“语义上是否适配”才进入模型门控。</p><ul><li>减少无意义调用</li><li>保留具体拦截原因</li><li>门控失败可重试，不污染报告</li></ul>`,
    },
    coverage: {
      title: "字符位置覆盖率",
      subtitle: "覆盖的是原文中的有效约束字符，而不是模糊的流程节点数量。",
      canvas: () => `<div class="mechanism-diagram">
        <p class="eyebrow">DETERMINISTIC METRIC</p><h2>关键指标不受 LLM 随机性影响。</h2>
        <div class="formula-box">coverage = 已测试约束字符位置 / 有效约束字符总数</div>
        <div class="component-explode">
          <div class="component-piece"><b>结构文本</b><span>标题、编号等自动排除</span></div>
          <div class="component-piece"><b>约束文本</b><span>映射回原文字符位置</span></div>
          <div class="component-piece"><b>测试计数</b><span>每条约束独立累计</span></div>
        </div></div>`,
      notes: `<h2>覆盖率是一条纯函数</h2><p>只要输入报告相同，覆盖率结果就相同。它不依赖 Judge 的措辞，也不随模型温度变化。</p><p>界面同时展示“覆盖了多少文本”和“每条约束测了几次”，避免高覆盖但浅测试。</p>`,
    },
    target: {
      title: "定向补充",
      subtitle: "覆盖过半后，自动把一部分并行工位分配给测试不足的约束。",
      canvas: () => `<div class="mechanism-diagram">
        <p class="eyebrow">ADAPTIVE DISPATCH</p><h2>先探索，再补齐。</h2>
        <div class="gate-flow">
          <div class="gate-node"><strong>低覆盖</strong><span>自由发现更多约束</span></div><i class="gate-arrow">→</i>
          <div class="gate-node warn"><strong>达到阈值</strong><span>识别测试不足区域</span></div><i class="gate-arrow">→</i>
          <div class="gate-node good"><strong>半数定向</strong><span>补短板但保留探索</span></div>
        </div></div>`,
      notes: `<h2>不是把所有工位锁死</h2><p>前半组定向补充，后半组继续自由发现。这样既能提高收敛速度，也不会遗漏尚未识别的新约束。</p>`,
    },
    state: {
      title: "多轮状态机",
      subtitle: "有些约束必须经历“第一次拒绝、继续坚持、最终终止”才能测透。",
      canvas: () => `<div class="mechanism-diagram">
        <p class="eyebrow">MULTI-TURN STATE</p><h2>一次触发，不等于测试完成。</h2>
        <div class="gate-flow">
          <div class="gate-node"><strong>none</strong><span>尚未触发</span></div><i class="gate-arrow">→</i>
          <div class="gate-node warn"><strong>need</strong><span>等待 Agent 回复</span></div><i class="gate-arrow">→</i>
          <div class="gate-node warn"><strong>continue</strong><span>继续施压追问</span></div><i class="gate-arrow">→</i>
          <div class="gate-node good"><strong>done</strong><span>片段收束</span></div>
        </div></div>`,
      notes: `<h2>测试“坚持”类约束</h2><p>如果约束要求用户坚持后 Agent 才挂断，单轮测试无法证明遵守。状态机记录约束是否需要继续，并设最大挂起轮次防止无限对话。</p>`,
    },
    components: {
      title: "组件拆解",
      subtitle: "复杂系统被拆为可理解、可折叠、可追溯的五个界面组件。",
      canvas: () => `<div class="mechanism-diagram">
        <p class="eyebrow">COMPONENT EXPLODED VIEW</p><h2>每个组件只回答一个问题。</h2>
        <div class="component-explode">
          <div class="component-piece" style="--dx:-8px;--dy:-5px"><b>指令平面</b><span>我们在测什么？</span></div>
          <div class="component-piece" style="--dx:0;--dy:9px"><b>并行工位</b><span>现在运行到哪里？</span></div>
          <div class="component-piece" style="--dx:8px;--dy:-4px"><b>Segment 便签</b><span>形成了哪些证据？</span></div>
          <div class="component-piece" style="--dx:-7px;--dy:5px"><b>评估卡</b><span>为什么通过或失败？</span></div>
          <div class="component-piece" style="--dx:0;--dy:-8px"><b>报告热力图</b><span>问题在原文哪里？</span></div>
          <div class="component-piece" style="--dx:8px;--dy:7px"><b>检查抽屉</b><span>需要深挖哪些细节？</span></div>
        </div></div>`,
      notes: `<h2>主次信息的空间分工</h2><p>任务主线始终留在大画布；证据、公式、诊断与工程参数进入便签、标签页和侧栏。折叠不是删信息，而是控制信息出现的时机。</p>`,
    },
  };

  const edgeCases = {
    code_gate: {
      status: "BLOCKED",
      title: "代码门控拦截重复或格式错误",
      banner: "当前候选消息未进入 Agent，也不会形成 Segment。",
      nodes: [["候选消息", "再次测试完全相同的约束触发方式"], ["代码门控", "检测到重复测试", "blocked"], ["重试队列", "换一种用户表达重新生成", "recovered"]],
      log: "code_gate_errors: [\"当前连续对话中已经测试过这条约束\"]",
      explain: `<h2>便宜的错误，先便宜地拦</h2><p>精确子串、重复、长度和格式都由确定性代码检查。失败样本不会进入 Agent，因此不消耗被测调用，也不污染通过率。</p><ul><li>用户看到：工位短暂显示“重试”</li><li>系统恢复：在最大重试次数内重新生成</li><li>指标可信：无 Segment，不计覆盖和通过率</li></ul>`,
    },
    semantic_gate: {
      status: "RETRY",
      title: "语义门控发现消息没有真正触发约束",
      banner: "文字可能包含约束关键词，但语义场景并不成立。",
      nodes: [["候选消息", "询问工资结算"], ["目标约束", "测试“语气自然”"], ["语义门控", "主题不匹配，退回重试", "blocked"]],
      log: "user_gate: { result: \"fail\", evidence: \"消息与目标约束无关\" }",
      explain: `<h2>关键词命中不等于有效测试</h2><p>代码门控只能证明文本形式正确，语义门控进一步确认用户消息是否真的能触发所选约束。</p><ul><li>用户看到：该轮被标记为门控失败</li><li>系统恢复：保留原因并重新生成</li><li>指标可信：失败不进入报告</li></ul>`,
    },
    stale: {
      status: "STOPPED",
      title: "覆盖率连续多个批次不再增长",
      banner: "系统触发停滞退出，避免无限消耗。",
      nodes: [["第 5 批", "覆盖率 23.8%"], ["第 6 批", "覆盖率仍为 23.8%"], ["退出检查", "达到停滞批次上限", "recovered"]],
      log: `completion_reason: "${escapeHtml(state.report?.completion_reason || "stale_coverage_stopped")}"`,
      explain: `<h2>未达目标也要诚实停止</h2><p>当新增对话无法带来新覆盖，继续运行只会增加成本。报告保留实际覆盖率和退出原因，不伪装成“已完成”。</p><ul><li>用户看到：覆盖停滞说明</li><li>系统恢复：建议调整阈值或指令</li><li>指标可信：展示实际值，不补齐虚构数据</li></ul>`,
    },
    worker: {
      status: "PARTIAL",
      title: "单个工位异常，其他工位继续",
      banner: "并行批次采用组级隔离，局部失败不会抹掉已完成证据。",
      nodes: [["C0 / C1", "正常形成 Segment", "recovered"], ["C2", "连接异常", "blocked"], ["批次汇总", "保留成功组并记录诊断", "recovered"]],
      log: "conversation 2: 执行异常: Connection error.",
      explain: `<h2>故障边界在对话组</h2><p>每个工位独立记录 completion_reason 和 diagnostics。异常组可以单独重试，成功组的 Turn、Segment 和 Evaluation 仍然有效。</p>`,
    },
    invalid: {
      status: "INVALID",
      title: "Judge 无法根据证据做出有效判断",
      banner: "该样本保留用于审计，但不进入有效通过率分母。",
      nodes: [["Segment", "上下文不足"], ["Evaluation", "result = invalid", "blocked"], ["报告聚合", "单独统计，不惩罚 Agent", "recovered"]],
      log: "result: \"invalid\"  // excluded from valid pass-rate denominator",
      explain: `<h2>评测器也接受审查</h2><p>无效不是失败的别名。把无法判断的样本独立出来，能够暴露测试设计不足，并防止系统制造虚假的 Agent 风险。</p>`,
    },
    offline: {
      status: "OFFLINE DATA",
      title: "后端不可用，切换中间产物重放",
      banner: "当前 PPT 正在使用的就是这条降级路径。",
      nodes: [["FastAPI / SSE", "现场不部署"], ["DemoAPI", "读取 data 中间产物", "recovered"], ["完整产品体验", "确定性重放与报告", "recovered"]],
      log: `data_source: "${escapeHtml(state.meta?.source || "ppt/data")}"`,
      explain: `<h2>降级不等于做一张截图</h2><p>界面仍然可输入、播放、筛选和展开证据。区别只在数据来源：由真实后端实时生成，变为从预跑中间产物确定性重放。</p><ul><li>演示不需要 API Key</li><li>不依赖网络</li><li>报告数字仍来自真实产物</li></ul>`,
    },
  };

  function bind(name, value) {
    $$(`[data-bind="${name}"]`).forEach((element) => {
      element.textContent = value;
    });
  }

  function summaries() {
    return array(state.report?.overall_score?.constraint_eval_summaries);
  }

  function evaluationsForConstraint(text) {
    return array(state.report?.evaluations).filter((item) => item.constraint_text === text);
  }

  function weakestSummary() {
    return [...summaries()]
      .filter((item) => Number(item.total_segments) > 0)
      .sort((a, b) => Number(a.pass_rate) - Number(b.pass_rate))[0] || null;
  }

  function highlightInstruction(text, limit = 9) {
    let html = escapeHtml(text || "暂无指令文本");
    const candidates = summaries()
      .slice()
      .sort((a, b) => String(b.constraint_text).length - String(a.constraint_text).length)
      .slice(0, limit);
    candidates.forEach((item, index) => {
      const raw = String(item.constraint_text || "").replace(/\*\*/g, "");
      const escaped = escapeHtml(raw);
      if (!escaped || !html.includes(escaped)) return;
      const klass = Number(item.pass_rate) < .5 ? "risk" : "";
      html = html.replace(escaped, `<mark class="${klass}" data-constraint-index="${index}">${escaped}</mark>`);
    });
    return html;
  }

  function renderHero() {
    const score = state.report.overall_score;
    bind("hero-groups", state.report.conversation_groups.length);
    bind("hero-segments", score.total_segments);
    bind("hero-evals", score.total_evaluations);
    bind("hero-pass", pct(score.overall_pass_rate));
    bind("source-badge", state.meta.source);
    const badge = $('[data-bind="source-badge"]');
    badge?.classList.toggle("warn", state.meta.degraded);
  }

  function renderSetup() {
    $("#instructionInput").value = state.instruction.content || "";
    bind("instruction-length", `${(state.instruction.content || "").length} 字`);
    bind("file-mode", location.protocol === "file:" ? "STATIC BUNDLE" : "JSON FETCH");
    syncSettings();
    renderStationPreview();
  }

  function syncSettings() {
    bind("coverage-setting", `${$("#coverageInput").value}%`);
    bind("parallel-setting", $("#parallelInput").value);
    bind("mintests-setting", $("#minTestsInput").value);
    bind("coverage-target-marker", `目标 ${$("#coverageInput").value}%`);
  }

  function renderStationPreview() {
    const count = Number($("#parallelInput").value);
    $('[data-bind="station-preview"]').innerHTML = Array.from({ length: count }, () => '<i class="preview-station"></i>').join("");
  }

  function renderInstructionPlane() {
    const score = state.report.overall_score;
    bind("constraint-count", `${score.total_constraints_tested} CONSTRAINTS`);
    bind("instruction-name", state.instruction.name);
    bind("map-coverage", `覆盖 ${pct(state.report.coverage)}`);
    const riskCount = summaries().filter((item) => Number(item.pass_rate) < .8).length;
    bind("map-risk", `风险 ${riskCount}`);
    $("#instructionMap").innerHTML = highlightInstruction(state.instruction.content);

    const officeCount = clamp(Number(state.report.parallel_conversations) || 5, 1, 5);
    $('[data-bind="office-static"]').innerHTML = Array.from({ length: officeCount }, (_, index) => `
      <div class="office-card ${index === 0 ? "active" : ""}">
        <header><b>C${index}</b><span>${index === 0 ? "待派遣" : "等待"}</span></header>
        <i class="worker-icon"></i>
        <p>${index === 0 ? "从原文选择约束" : "独立对话组"}</p>
      </div>`).join("");
  }

  async function createRun() {
    state.run = await DemoAPI.startRun(state.instruction.name, {
      coverage: Number($("#coverageInput").value) / 100,
      parallel: Number($("#parallelInput").value),
      minTests: Number($("#minTestsInput").value),
    });
    prepareRunPlayer();
  }

  function prepareRunPlayer() {
    state.stream?.close();
    state.stream = DemoAPI.streamProgress(state.run?.run_id || "offline-demo", {
      onProgress: applyRunEvent,
      onReset: resetRunVisuals,
      onDone: () => {
        $("#runStatus").textContent = "DONE";
        $("#playButton").textContent = "▶";
        bind("run-caption", "重放完成，结果与报告数据一致");
      },
    });
    resetRunVisuals();
  }

  function resetRunVisuals() {
    state.currentEvent = 0;
    state.liveCoverage = 0;
    state.liveSegments = new Set();
    state.liveGroups = new Map();
    $("#runProgress").style.width = "0%";
    $("#coverageTrack").style.width = "0%";
    $("#eventStream").innerHTML = '<p class="empty-state">点击播放，按真实中间产物重放运行过程</p>';
    $("#runStatus").textContent = "READY";
    $("#playButton").textContent = "▶";
    bind("event-progress", `0/${state.run?.timeline?.length || 0}`);
    bind("live-coverage", "0%");
    bind("live-segments", "0");
    bind("run-caption", "等待派遣");
    renderLiveOffices();
  }

  function renderLiveOffices() {
    const count = clamp(Number($("#parallelInput")?.value) || Number(state.report.parallel_conversations) || 5, 1, 5);
    $("#liveOfficeGrid").innerHTML = Array.from({ length: count }, (_, index) => {
      const group = state.liveGroups.get(index) || { status: "waiting", detail: "等待派遣" };
      return `<div class="office-card ${group.status}">
        <header><b>C${index}</b><span>${group.status === "active" ? "运行中" : group.status === "done" ? "完成" : group.status === "error" ? "异常" : "等待"}</span></header>
        <i class="worker-icon"></i><p>${escapeHtml(short(group.detail, 32))}</p>
      </div>`;
    }).join("");
  }

  function applyRunEvent(event) {
    state.currentEvent = event.index + 1;
    const previous = state.liveGroups.get(event.cid) || {};
    const next = { ...previous, status: "active", detail: event.message };
    if (event.type === "done") next.status = "done";
    if (event.type === "error") next.status = "error";
    state.liveGroups.set(event.cid % clamp(Number($("#parallelInput").value), 1, 5), next);
    if (event.type === "segment") {
      state.liveSegments.add(event.segmentId);
      state.liveCoverage = Math.min(state.report.coverage, state.liveSegments.size / Math.max(1, state.report.segments.length) * state.report.coverage);
    }

    const line = document.createElement("div");
    line.className = `event-line ${event.type}`;
    line.innerHTML = `<b>${escapeHtml(event.label)}</b>${escapeHtml(short(event.message, 70))}`;
    const stream = $("#eventStream");
    stream.querySelector(".empty-state")?.remove();
    stream.prepend(line);
    while (stream.children.length > 8) stream.lastElementChild.remove();

    const total = event.total || 1;
    $("#runProgress").style.width = `${state.currentEvent / total * 100}%`;
    $("#coverageTrack").style.width = `${clamp(state.liveCoverage * 100, 0, 100)}%`;
    $("#runStatus").textContent = "RUNNING";
    bind("event-progress", `${state.currentEvent}/${total}`);
    bind("live-coverage", pct(state.liveCoverage));
    bind("live-segments", state.liveSegments.size);
    bind("batch-label", `工位 C${event.cid}`);
    bind("run-caption", short(event.message, 72));
    renderLiveOffices();
  }

  function renderConversationTabs() {
    const groups = state.report.conversation_groups.slice(0, 8);
    $("#conversationTabs").innerHTML = groups.map((group, index) => `
      <button class="${index === state.currentConversation ? "active" : ""}" data-conversation="${index}">
        C${group.conversation_id ?? index} · ${array(group.segments).length || array(group.turns).filter((turn) => turn.segment_id).length} 段
      </button>`).join("");
  }

  function renderConversation(index = 0) {
    const groups = state.report.conversation_groups;
    state.currentConversation = clamp(Number(index) || 0, 0, Math.max(0, groups.length - 1));
    const group = groups[state.currentConversation] || {};
    renderConversationTabs();
    bind("trace-group-label", `C${group.conversation_id ?? state.currentConversation}`);
    bind("trace-title", `对话组 C${group.conversation_id ?? state.currentConversation}`);
    bind("trace-reason", group.completion_reason || "完成");

    const turns = array(group.turns);
    $("#chatScroll").innerHTML = [
      group.opening_line ? `<div class="chat-bubble agent"><span>Agent · Opening</span>${escapeHtml(group.opening_line)}</div>` : "",
      ...turns.flatMap((turn, turnIndex) => [
        `<div class="chat-bubble user"><span>User · T${turnIndex + 1}${turn.constraint_text ? ` · ${escapeHtml(short(turn.constraint_text, 18))}` : ""}</span>${escapeHtml(turn.user_reply || "")}</div>`,
        `<div class="chat-bubble agent"><span>Agent</span>${escapeHtml(turn.agent_reply || "")}</div>`,
      ]),
    ].join("");

    const segmentIds = [...new Set(turns.map((turn) => Number(turn.segment_id)).filter(Boolean))];
    const segments = array(group.segments).length
      ? array(group.segments)
      : state.report.segments.filter((segment) => Number(segment.conversation_id) === Number(group.conversation_id ?? state.currentConversation));
    const visibleSegments = segments.length
      ? segments
      : segmentIds.map((id) => ({ segment_id: id, constraint_text: turns.find((turn) => Number(turn.segment_id) === id)?.constraint_text }));
    bind("trace-segment-count", `${visibleSegments.length} 条`);
    $("#segmentList").innerHTML = visibleSegments.slice(0, 7).map((segment, segmentIndex) => `
      <button class="segment-note ${segmentIndex === 0 ? "active" : ""}" data-segment="${segment.segment_id}">
        <b>S${segment.segment_id} · ${escapeHtml(short(segment.complete_reason || "测试片段", 18))}</b>
        <p>${escapeHtml(segment.constraint_text || "约束片段")}</p>
      </button>`).join("") || '<p class="empty-state">该对话组没有形成 Segment</p>';
    state.currentSegment = visibleSegments[0]?.segment_id || null;
  }

  function evaluationCounts() {
    const counts = { pass: 0, fail: 0, invalid: 0 };
    state.report.evaluations.forEach((item) => {
      if (item.result === "pass") counts.pass += 1;
      else if (item.result === "fail") counts.fail += 1;
      else counts.invalid += 1;
    });
    return counts;
  }

  function renderEvaluationSummary() {
    const counts = evaluationCounts();
    const total = state.report.evaluations.length;
    bind("eval-total", `${total} ITEMS`);
    $('[data-bind="eval-summary"]').innerHTML = `
      <div class="eval-stat"><span>全部评估</span><strong>${total}</strong></div>
      <div class="eval-stat pass"><span>通过</span><strong>${counts.pass}</strong></div>
      <div class="eval-stat fail"><span>失败</span><strong>${counts.fail}</strong></div>
      <div class="eval-stat"><span>无效</span><strong>${counts.invalid}</strong></div>
      <div class="eval-stat"><span>有效通过率</span><strong>${pct(state.report.overall_score.overall_pass_rate)}</strong></div>`;
  }

  function filteredEvaluations() {
    const items = state.report.evaluations;
    return state.evalFilter === "all" ? items : items.filter((item) => item.result === state.evalFilter);
  }

  function renderEvaluations() {
    renderEvaluationSummary();
    const items = filteredEvaluations().slice(0, 12);
    $("#evalNotes").innerHTML = items.map((item, index) => `
      <button class="eval-note ${escapeHtml(item.result || "invalid")} ${index === 0 ? "active" : ""}" data-evaluation="${item.segment_id}">
        <b>S${item.segment_id} · ${(item.result || "invalid").toUpperCase()}</b>
        <p>${escapeHtml(short(item.constraint_text, 48))}</p>
      </button>`).join("") || '<p class="empty-state">没有该类型的评估</p>';
    const selected = items.find((item) => Number(item.segment_id) === Number(state.currentEvaluation)) || items[0];
    renderEvidence(selected);
  }

  function renderEvidence(item) {
    state.currentEvaluation = item?.segment_id ?? null;
    $$(".eval-note").forEach((note) => note.classList.toggle("active", Number(note.dataset.evaluation) === Number(state.currentEvaluation)));
    if (!item) {
      $("#evidenceCard").innerHTML = '<p class="empty-state">选择一条评估结果</p>';
      return;
    }
    const turns = array(item.segment_turns);
    $("#evidenceCard").innerHTML = `
      <span class="evidence-result ${escapeHtml(item.result || "invalid")}">${escapeHtml((item.result || "invalid").toUpperCase())}</span>
      <h3>S${item.segment_id} · 评估证据</h3>
      <div class="evidence-row"><label>约束</label><p>${escapeHtml(item.constraint_text)}</p></div>
      <div class="evidence-row"><label>判定理由</label><p>${escapeHtml(item.evidence || "无额外说明")}</p></div>
      <div class="evidence-row"><label>对话证据</label>${turns.slice(0, 3).map((turn) => `
        <div class="detail-mini-evidence"><p><b>User</b> ${escapeHtml(turn.user_reply || "")}</p><p><b>Agent</b> ${escapeHtml(turn.agent_reply || "")}</p></div>`).join("") || "<p>请在原始 Segment 中查看上下文。</p>"}</div>`;
  }

  function renderReport() {
    const score = state.report.overall_score;
    const counts = evaluationCounts();
    const weak = weakestSummary();
    bind("report-status", state.meta.degraded ? "DEMO DATA" : "SOURCE DATA");
    $('[data-bind="report-kpis"]').innerHTML = `
      <div class="report-kpi"><span>有效通过率</span><strong>${pct(score.overall_pass_rate)}</strong></div>
      <div class="report-kpi"><span>字符覆盖率</span><strong>${pct(state.report.coverage)}</strong></div>
      <div class="report-kpi"><span>测试片段</span><strong>${score.total_segments}</strong></div>
      <div class="report-kpi"><span>失败证据</span><strong style="color:var(--red)">${counts.fail}</strong></div>`;
    $("#reportHeatmap").innerHTML = highlightInstruction(state.instruction.content, 6);
    renderConstraintBars();
    if (weak) renderConstraintDetail(weak);

    bind("closing-risk-rate", weak ? pct(weak.pass_rate) : "--");
    bind("closing-fail-count", counts.fail);
    bind("weak-constraint", weak?.constraint_text || "暂无风险约束");
    bind("rewrite-suggestion", suggestRewrite(weak?.constraint_text || ""));
    const comparison = DemoAPI.getComparison();
    bind("comparison-badge", comparison ? "已加载真实复测" : "等待真实复测");
  }

  function filteredSummaries() {
    if (state.reportFilter === "risk") return summaries().filter((item) => Number(item.pass_rate) < .8);
    if (state.reportFilter === "ok") return summaries().filter((item) => Number(item.pass_rate) >= .8);
    return summaries();
  }

  function renderConstraintBars() {
    const items = filteredSummaries().slice(0, 9);
    $("#constraintBars").innerHTML = items.map((item, index) => {
      const rate = Number(item.pass_rate);
      const klass = rate < .5 ? "risk" : rate < .8 ? "warn" : "";
      return `<div class="constraint-bar ${klass}" data-constraint-bar="${index}" data-constraint-text="${escapeHtml(item.constraint_text)}">
        <label title="${escapeHtml(item.constraint_text)}">${escapeHtml(short(item.constraint_text, 24))}</label>
        <span class="track"><i style="--w:${pct(rate)}"></i></span><b>${pct(rate)}</b>
      </div>`;
    }).join("") || '<p class="empty-state">没有符合筛选条件的约束</p>';
  }

  function renderConstraintDetail(item) {
    state.currentConstraint = item.constraint_text;
    const evaluations = evaluationsForConstraint(item.constraint_text);
    const fail = evaluations.find((evaluation) => evaluation.result === "fail") || evaluations[0];
    const rateClass = Number(item.pass_rate) < .8 ? "risk" : "";
    $("#reportDetailCard").innerHTML = `
      <p class="eyebrow">CONSTRAINT DETAIL</p>
      <h3>${escapeHtml(short(item.constraint_text, 45))}</h3>
      <div class="detail-rate ${rateClass}">${pct(item.pass_rate)}</div>
      <p>${item.total_segments} 个片段 · ${item.pass_count} 通过 · ${item.fail_count} 失败 · ${item.invalid_count || 0} 无效</p>
      ${fail ? `<div class="detail-mini-evidence"><b>S${fail.segment_id} · ${escapeHtml(fail.result)}</b><p>${escapeHtml(short(fail.evidence, 150))}</p></div>` : ""}
      <button class="ui-btn ghost small" data-action="open-report-evidence">查看完整证据</button>`;
  }

  function suggestRewrite(text) {
    if (!text) return "明确触发条件、必做动作和终止条件";
    if (text.includes("挂断")) return "明确：骑手再次坚持无法配送时，必须停止挽留，安慰并主动结束通话";
    if (text.includes("字以内")) return "把字数要求改成可判定的硬上限，并注明是否包含标点";
    return "补充可观察的触发条件、必做动作与完成标准";
  }

  function renderMechanism() {
    const item = mechanisms[state.mechanism];
    $("#mechanismCanvas").innerHTML = item.canvas();
    $("#mechanismNotes").innerHTML = `<p class="eyebrow">WHY IT MATTERS</p>${item.notes}`;
    $$("#mechanismTabs button").forEach((button) => button.classList.toggle("active", button.dataset.mechanism === state.mechanism));
  }

  function renderEdge() {
    const item = edgeCases[state.edge];
    $("#edgeStatus").textContent = item.status;
    $("#edgeScene").innerHTML = `<div class="edge-scene">
      <div class="edge-banner"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.banner)}</p></div>
      <div class="edge-process">${item.nodes.map((node, index) => `
        ${index ? '<i class="edge-arrow">→</i>' : ""}
        <div class="edge-node ${node[2] || ""}"><b>${escapeHtml(node[0])}</b><p>${escapeHtml(node[1])}</p></div>`).join("")}</div>
      <div class="edge-log">${item.log}</div>
    </div>`;
    $("#edgeExplain").innerHTML = `<p class="eyebrow">FAILURE CONTRACT</p>${item.explain}`;
    $$("#edgeNav button").forEach((button) => button.classList.toggle("active", button.dataset.edge === state.edge));
  }

  function openGuide(key) {
    const guide = guides[key];
    if (!guide) return;
    $("#guideEyebrow").textContent = guide.eyebrow;
    $("#guideTitle").textContent = guide.title;
    $("#guideBody").innerHTML = guide.body;
    $("#guideDrawer").classList.add("open");
    $("#drawerBackdrop").classList.add("open");
    $("#guideDrawer").setAttribute("aria-hidden", "false");
  }

  function closeGuide() {
    $("#guideDrawer").classList.remove("open");
    $("#drawerBackdrop").classList.remove("open");
    $("#guideDrawer").setAttribute("aria-hidden", "true");
  }

  function gotoSlide(number) {
    location.hash = `#/${number}`;
  }

  function wireEvents() {
    document.addEventListener("click", async (event) => {
      const actionTarget = event.target.closest("[data-action]");
      if (actionTarget) {
        const action = actionTarget.dataset.action;
        if (action === "goto") gotoSlide(actionTarget.dataset.slide);
        if (action === "close-guide") closeGuide();
        if (action === "load-preset") {
          $("#instructionInput").value = state.instruction.content || "";
          bind("instruction-length", `${$("#instructionInput").value.length} 字`);
        }
        if (action === "toggle-advanced") {
          $("#advancedFields").classList.toggle("open");
          actionTarget.querySelector("span").textContent = $("#advancedFields").classList.contains("open") ? "收起" : "展开";
        }
        if (action === "create-run") {
          await createRun();
          $("#setupToast").classList.add("show");
          setTimeout(() => $("#setupToast").classList.remove("show"), 1500);
          setTimeout(() => gotoSlide(3), 450);
        }
        if (action === "run-toggle") {
          if (!state.stream) await createRun();
          const running = state.stream.getState().running;
          if (running) state.stream.pause();
          else state.stream.play();
          $("#playButton").textContent = running ? "▶" : "Ⅱ";
          $("#runStatus").textContent = running ? "PAUSED" : "RUNNING";
        }
        if (action === "run-step") {
          if (!state.stream) await createRun();
          state.stream.step();
          $("#runStatus").textContent = "STEP";
          $("#playButton").textContent = "▶";
        }
        if (action === "run-reset") state.stream?.reset();
        if (action === "run-speed") {
          state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 4 : 1;
          state.stream?.setSpeed(state.speed);
          actionTarget.textContent = `${state.speed}×`;
        }
        if (action === "open-report-evidence") {
          const item = evaluationsForConstraint(state.currentConstraint).find((evaluation) => evaluation.result === "fail") ||
            evaluationsForConstraint(state.currentConstraint)[0];
          if (item) {
            state.evalFilter = "all";
            renderEvaluations();
            renderEvidence(item);
            gotoSlide(6);
          }
        }
      }

      const guideTarget = event.target.closest("[data-guide]");
      if (guideTarget) openGuide(guideTarget.dataset.guide);

      const conversation = event.target.closest("[data-conversation]");
      if (conversation) renderConversation(conversation.dataset.conversation);

      const segment = event.target.closest("[data-segment]");
      if (segment) {
        state.currentSegment = Number(segment.dataset.segment);
        $$(".segment-note").forEach((item) => item.classList.toggle("active", item === segment));
        const evaluation = state.report.evaluations.find((item) => Number(item.segment_id) === state.currentSegment);
        if (evaluation) {
          state.currentEvaluation = evaluation.segment_id;
          renderEvidence(evaluation);
        }
      }

      const evalFilter = event.target.closest("[data-eval-filter]");
      if (evalFilter) {
        state.evalFilter = evalFilter.dataset.evalFilter;
        $$("#evalFilters .filter-btn").forEach((button) => button.classList.toggle("active", button === evalFilter));
        renderEvaluations();
      }

      const evaluation = event.target.closest("[data-evaluation]");
      if (evaluation) {
        const item = state.report.evaluations.find((entry) => Number(entry.segment_id) === Number(evaluation.dataset.evaluation));
        renderEvidence(item);
      }

      const reportFilter = event.target.closest("[data-report-filter]");
      if (reportFilter) {
        state.reportFilter = reportFilter.dataset.reportFilter;
        $$("#reportFilters .filter-btn").forEach((button) => button.classList.toggle("active", button === reportFilter));
        renderConstraintBars();
      }

      const constraintBar = event.target.closest("[data-constraint-text]");
      if (constraintBar) {
        const item = summaries().find((entry) => entry.constraint_text === constraintBar.dataset.constraintText);
        if (item) renderConstraintDetail(item);
      }

      const heatConstraint = event.target.closest("[data-constraint-index]");
      if (heatConstraint && heatConstraint.closest("#reportHeatmap")) {
        const candidates = summaries().slice().sort((a, b) => String(b.constraint_text).length - String(a.constraint_text).length).slice(0, 6);
        const item = candidates[Number(heatConstraint.dataset.constraintIndex)];
        if (item) renderConstraintDetail(item);
      }

      const mechanism = event.target.closest("[data-mechanism]");
      if (mechanism) {
        state.mechanism = mechanism.dataset.mechanism;
        renderMechanism();
      }

      const edge = event.target.closest("[data-edge]");
      if (edge) {
        state.edge = edge.dataset.edge;
        renderEdge();
      }
    });

    $("#instructionInput").addEventListener("input", () => bind("instruction-length", `${$("#instructionInput").value.length} 字`));
    ["coverageInput", "parallelInput", "minTestsInput"].forEach((id) => {
      $(`#${id}`).addEventListener("input", () => {
        syncSettings();
        if (id === "parallelInput") {
          renderStationPreview();
          if (state.stream) state.stream.reset();
        }
      });
    });
  }

  async function bootstrap() {
    try {
      state.meta = await DemoAPI.initialize();
      state.report = await DemoAPI.getReport();
      state.instruction = await DemoAPI.getInstruction();
      await createRun();
      renderHero();
      renderSetup();
      renderInstructionPlane();
      renderConversation(0);
      renderEvaluations();
      renderReport();
      renderMechanism();
      renderEdge();
      wireEvents();
    } catch (error) {
      console.error(error);
      bind("source-badge", "数据加载失败");
      const badge = $('[data-bind="source-badge"]');
      badge?.classList.add("warn");
    }
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
