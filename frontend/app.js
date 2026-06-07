// API layer
const API = {
  async listInstructions() {
    const res = await fetch("/api/instructions");
    if (!res.ok) throw new Error("无法读取指令列表");
    return res.json();
  },
  async getInstruction(name) {
    const res = await fetch(`/api/instructions/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error("无法读取指令内容");
    return res.json();
  },
  async saveInstruction(name, content) {
    const res = await fetch("/api/instructions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content }),
    });
    if (!res.ok) throw new Error("无法保存指令");
    return res.json();
  },
  async listReports() {
    const res = await fetch("/api/reports");
    if (!res.ok) return [];
    return res.json();
  },
  async getReport(name) {
    const res = await fetch(`/api/reports/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error("无法读取历史报告");
    return res.json();
  },
  async startRun(instruction, opts = {}) {
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction, ...opts }),
    });
    return res.json();
  },
  async getRun(runId) {
    const res = await fetch(`/api/runs/${runId}`);
    return res.json();
  },
  streamProgress(runId, onProgress, onDone) {
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.addEventListener("progress", (event) => onProgress(event.data));
    es.addEventListener("done", () => {
      es.close();
      onDone();
    });
    es.addEventListener("error", () => es.close());
    return es;
  },
  async listActiveRuns() {
    const res = await fetch("/api/runs/active");
    if (!res.ok) return [];
    return res.json();
  },
  async cancelRun(runId) {
    await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
  },
  async getProgress(runId) {
    const res = await fetch(`/api/runs/${runId}/progress`);
    return res.json();
  },
  async startEvaluation(report) {
    const res = await fetch("/api/evaluations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report }),
    });
    return res.json();
  },
  async getEvaluation(evalId) {
    const res = await fetch(`/api/evaluations/${evalId}`);
    return res.json();
  },
  streamEvaluation(evalId, onProgress, onDone) {
    const es = new EventSource(`/api/evaluations/${evalId}/stream`);
    es.addEventListener("progress", (event) => onProgress(event.data));
    es.addEventListener("done", () => { es.close(); onDone(); });
    es.addEventListener("error", () => es.close());
    return es;
  },
};

const shell = document.querySelector(".app-shell");
const runToggle = document.querySelector("#runToggle");
const settingsPanel = document.querySelector("#settingsPanel");
const settingsToggle = document.querySelector("#settingsToggle");
const instructionSelect = document.querySelector("#instructionSelect");
const instructionTitle = document.querySelector("#instruction-title");
const instructionPlane = document.querySelector(".instruction-plane");
const summaryPill = document.querySelector(".summary-pill");
const officeStage = document.querySelector(".office-stage");
const historyButton = document.querySelector("#historyButton");
const viewReportButton = document.querySelector("#viewReportButton");
const evidenceButton = document.querySelector("#evidenceButton");
const exportButton = document.querySelector("#exportButton");
const reportBack = document.querySelector("#reportBack");
const reportTags = document.querySelector("#reportTags");
const reportSubtitle = document.querySelector("#reportSubtitle");
const reportKpis = document.querySelector("#reportKpis");
const reportBars = document.querySelector("#reportBars");
const reportDonutFill = document.querySelector("#reportDonutFill");
const reportDonutVal = document.querySelector("#reportDonutVal");
const reportDonutStats = document.querySelector("#reportDonutStats");
const reportInstructionText = document.querySelector("#reportInstructionText");
const reportDetail = document.querySelector("#reportDetail");
const reportTableBody = document.querySelector("#reportTableBody");
const reportTableFoot = document.querySelector("#reportTableFoot");
const batchIndicator = document.querySelector("#batchIndicator");
const evalStrip = document.querySelector("#evalStrip");
const evalDetailPanel = document.querySelector("#evalDetailPanel");
const evalStartBtn = document.querySelector("#evalStartBtn");
const inspector = document.querySelector("#inspector");
const inspectorTitle = document.querySelector("#inspectorTitle");
const inspectorEyebrow = document.querySelector("#inspectorEyebrow");
const inspectorBody = document.querySelector("#inspectorBody");
const inspectorClose = document.querySelector("#inspectorClose");
const batchLabel = document.querySelector("#batchLabel");
const batchPrev = document.querySelector("#batchPrev");
const batchNext = document.querySelector("#batchNext");
const setupInstruction = document.querySelector("#setupInstruction");
const setupEnter = document.querySelector("#setupEnter");
const setupLoadReport = document.querySelector("#setupLoadReport");
const setupParallel = document.querySelector("#setupParallel");
const setupInputs = {
  maxTurns: document.querySelector("#setupMaxTurns"),
  minTests: document.querySelector("#setupMinTests"),
  coverage: document.querySelector("#setupCoverage"),
  parallel: setupParallel,
  evaluate: document.querySelector("#setupEvaluate"),
  maxRetries: document.querySelector("#setupMaxRetries"),
  maxPendingTurns: document.querySelector("#setupMaxPendingTurns"),
  maxBatches: document.querySelector("#setupMaxBatches"),
  staleBatchesLimit: document.querySelector("#setupStaleBatchesLimit"),
  targetedThreshold: document.querySelector("#setupTargetedThreshold"),
};

let stationKeys = [];

const state = {
  instructionName: "",
  instructionContent: "",
  report: null,
  reports: [],
  evidence: {},
  currentRunId: null,
  currentEventSource: null,
  progressLines: [],
  currentEvidenceKey: "",
  currentParallel: 5,
  currentBatchIndex: 0,
  batchRunState: { status: "", lines: [] },
  liveBatches: {},
  liveParallel: 5,
  liveConstraintCounts: {},
  liveConstraintKeys: new Set(),
  liveCoverage: 0,
  liveSegmentSeq: 0,
  activeBatch: 1,
  segments: [],
  selectedSegId: null,
  evalRunning: false,
  currentEvalId: null,
  currentEvalES: null,
};

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

document.querySelector("#settingsMore").addEventListener("click", (event) => {
  const fields = document.querySelector("#settingsMoreFields");
  fields.classList.toggle("hidden");
  event.target.textContent = fields.classList.contains("hidden") ? "更多 ▾" : "收起 ▴";
});

document.querySelector("#setupMore").addEventListener("click", (event) => {
  const fields = document.querySelector("#setupMoreFields");
  fields.classList.toggle("hidden");
  event.target.textContent = fields.classList.contains("hidden") ? "更多 ▾" : "收起 ▴";
});

settingsPanel.addEventListener("input", () => {
  syncSettingsToSetup();
  setStationCount(state.currentParallel);
  renderParallelPreview();
  renderOfficePlaceholders();
});

instructionSelect.addEventListener("change", async () => {
  if (!instructionSelect.value) return;
  await loadInstruction(instructionSelect.value, { staySetup: shell.dataset.mode === "setup" });
});

Object.values(setupInputs).forEach((input) => {
  input.addEventListener("input", () => {
    syncSetupToSettings();
    setStationCount(Number(setupInputs.parallel.value) || 1);
    renderParallelPreview();
  });
});

setupEnter.addEventListener("click", async () => {
  await createEvaluationWorkspace();
});

setupLoadReport.addEventListener("click", async () => {
  enterWorkspace();
  await loadLatestReport();
});

historyButton.addEventListener("click", async () => {
  await openInspector("history");
});

viewReportButton.addEventListener("click", () => {
  if (!state.report) return;
  renderReportDashboard(state.report);
  enterReport();
});

reportBack.addEventListener("click", () => {
  enterWorkspace({ immediate: true });
});

evidenceButton.addEventListener("click", () => {
  openInspector("evidence");
});

inspectorClose.addEventListener("click", closeInspector);

inspector.addEventListener("click", (event) => {
  if (event.target === inspector) closeInspector();
});

inspectorBody.addEventListener("input", (event) => {
  if (event.target.matches("#evidenceSearch")) {
    renderEvidenceLibrary(event.target.value);
  }
});

inspectorBody.addEventListener("click", async (event) => {
  const reportButton = event.target.closest("[data-report]");
  if (reportButton) {
    await loadReport(reportButton.dataset.report);
    closeInspector();
    return;
  }

  const evidenceButton = event.target.closest("[data-evidence]");
  if (evidenceButton) {
    openInspector("trace", evidenceButton.dataset.evidence);
  }
});

batchPrev.addEventListener("click", () => {
  if (shell.dataset.state === "running") {
    selectLiveBatch(state.activeBatch - 1);
  } else if (state.currentBatchIndex > 0) {
    selectReportBatch(state.currentBatchIndex - 1);
  }
});

batchNext.addEventListener("click", () => {
  if (shell.dataset.state === "running") {
    selectLiveBatch(state.activeBatch + 1);
  } else {
    selectReportBatch(state.currentBatchIndex + 1);
  }
});

exportButton.addEventListener("click", () => {
  if (!state.report) return;
  const blob = new Blob([JSON.stringify(state.report, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${reportBaseName(state.report)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

officeStage.addEventListener("click", (event) => {
  const target = event.target.closest("[data-popover]");
  if (!target) return;
  const key = target.dataset.popover;
  // 点击同一个工位 → 取消选中，恢复干净状态
  if (state.currentEvidenceKey === key) {
    state.currentEvidenceKey = "";
    target.classList.remove("is-selected");
    restoreBatchRunState();
    return;
  }
  // 选中工位，显示对话历史
  document.querySelectorAll("[data-popover]").forEach((el) => el.classList.remove("is-selected"));
  target.classList.add("is-selected");
  previewConversationGroup(key);
});

runToggle.addEventListener("click", async () => {
  if (shell.dataset.state === "running" && state.currentRunId) {
    stopRun();
    return;
  }
  await startRun();
});

function readSettings() {
  const fd = new FormData(settingsPanel);
  return {
    max_turns: Number(fd.get("maxTurns")),
    min_tests_per_constraint: Number(fd.get("minTests")),
    target_coverage: Number(fd.get("coverage")),
    parallel_conversations: Number(fd.get("parallel")),
    evaluate: settingsPanel.elements.evaluate.checked,
    max_retries: Number(fd.get("maxRetries")),
    max_pending_turns: Number(fd.get("maxPendingTurns")),
    max_batches: Number(fd.get("maxBatches")),
    stale_batches_limit: Number(fd.get("staleBatchesLimit")),
    targeted_threshold: Number(fd.get("targetedThreshold")),
  };
}

function syncSetupToSettings() {
  settingsPanel.elements.maxTurns.value = setupInputs.maxTurns.value;
  settingsPanel.elements.minTests.value = setupInputs.minTests.value;
  settingsPanel.elements.coverage.value = setupInputs.coverage.value;
  settingsPanel.elements.parallel.value = setupInputs.parallel.value;
  settingsPanel.elements.evaluate.checked = setupInputs.evaluate.checked;
  settingsPanel.elements.maxRetries.value = setupInputs.maxRetries.value;
  settingsPanel.elements.maxPendingTurns.value = setupInputs.maxPendingTurns.value;
  settingsPanel.elements.maxBatches.value = setupInputs.maxBatches.value;
  settingsPanel.elements.staleBatchesLimit.value = setupInputs.staleBatchesLimit.value;
  settingsPanel.elements.targetedThreshold.value = setupInputs.targetedThreshold.value;
  state.currentParallel = clampParallel(Number(setupInputs.parallel.value));
}

function syncSettingsToSetup() {
  setupInputs.maxTurns.value = settingsPanel.elements.maxTurns.value;
  setupInputs.minTests.value = settingsPanel.elements.minTests.value;
  setupInputs.coverage.value = settingsPanel.elements.coverage.value;
  setupInputs.parallel.value = settingsPanel.elements.parallel.value;
  setupInputs.evaluate.checked = settingsPanel.elements.evaluate.checked;
  setupInputs.maxRetries.value = settingsPanel.elements.maxRetries.value;
  setupInputs.maxPendingTurns.value = settingsPanel.elements.maxPendingTurns.value;
  setupInputs.maxBatches.value = settingsPanel.elements.maxBatches.value;
  setupInputs.staleBatchesLimit.value = settingsPanel.elements.staleBatchesLimit.value;
  setupInputs.targetedThreshold.value = settingsPanel.elements.targetedThreshold.value;
  state.currentParallel = clampParallel(Number(setupInputs.parallel.value));
}

function enterSetup() {
  shell.dataset.mode = "setup";
  closeInspector();
  clearEvalDetail();
}

function enterWorkspace(options = {}) {
  if (options.immediate) {
    shell.dataset.mode = "workspace";
    return;
  }
  if (shell.dataset.mode === "workspace") {
    shell.dataset.mode = "workspace";
    return;
  }
  shell.classList.add("leaving-setup");
  setTimeout(() => {
    shell.classList.remove("leaving-setup");
    shell.dataset.mode = "workspace";
    shell.classList.add("entering-workspace");
    setTimeout(() => shell.classList.remove("entering-workspace"), 270);
  }, 230);
}

function enterReport() {
  closeInspector();
  shell.dataset.mode = "report";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function createEvaluationWorkspace() {
  const content = setupInstruction.value.trim();
  if (!content) {
    setRunState("缺少指令", ["请先输入长指令"]);
    return;
  }
  syncSetupToSettings();
  setState("ready");
  setRunState("创建中", ["正在生成评测平面"]);
  state.report = null;
  viewReportButton.disabled = true;

  try {
    const filename = `custom_instruction_${Date.now()}.md`;
    const payload = await API.saveInstruction(filename, content);
    state.instructionName = payload.name;
    state.instructionContent = payload.content;
    resetLiveConstraintCoverage();
    await refreshInstructionOptions(payload.name);
    instructionTitle.textContent = readableName(payload.name);
    renderInstructionText(payload.content);
    renderSummary();
    setStationCount(state.currentParallel);
    renderOfficePlaceholders();
    clearEvalDetail();
    enterWorkspace();
    setRunState("待开始", [`已创建 ${state.currentParallel} 个并行工位`, "点击开始评测后派遣对话组"]);
  } catch (error) {
    setRunState("创建失败", [error.message]);
  }
}

function clampParallel(value) {
  return Math.max(1, Math.min(10, Number(value) || 1));
}

async function refreshInstructionOptions(selectedName) {
  const instructions = await API.listInstructions();
  renderInstructionOptions(instructions);
  instructionSelect.value = selectedName;
}

function renderParallelPreview() {
  const count = clampParallel(setupInputs.parallel.value);
  document.querySelector("#parallelPreview").innerHTML = Array.from(
    { length: count },
    (_, index) => `
      <span class="preview-agent" aria-label="第 ${index + 1} 个派遣小人"></span>
    `
  ).join("");
}

function setStationCount(count) {
  const safeCount = clampParallel(count);
  state.currentParallel = safeCount;
  stationKeys = Array.from({ length: safeCount }, (_, index) => `c${index}`);

  officeStage.querySelectorAll(".station").forEach((station) => station.remove());
  const routes = officeStage.querySelector(".routes");
  routes.innerHTML = stationKeys.map((key, index) => {
    const pos = stationPosition(index);
    const y = pos.top + 46;
    return `<path class="route route-${key}" data-route="${key}" d="M 4 ${y + 26} C 126 ${y + 8}, 212 ${y - 12}, ${pos.left + 70} ${y}" />`;
  }).join("");

  stationKeys.forEach((key, index) => {
    const pos = stationPosition(index);
    const station = document.createElement("button");
    station.className = `station station-${key}`;
    station.type = "button";
    station.dataset.popover = key;
    station.dataset.route = key;
    station.style.top = `${pos.top}px`;
    station.style.left = `${pos.left}px`;
    station.innerHTML = `
      <span class="station-title">C${index}</span>
      <span class="desk"></span>
      <span class="worker waiting" aria-hidden="true"></span>
      <span class="status-chip">等待</span>
      <span class="problem-bubble" aria-hidden="true"></span>
    `;
    officeStage.appendChild(station);
  });

  const rows = Math.ceil(safeCount / stationColumns());
  const minHeight = Math.max(400, 116 + rows * 126 + 60);
  officeStage.style.minHeight = `${minHeight}px`;
  officeStage.style.height = `max(calc(100vh - 340px), ${minHeight}px)`;
}

function stationColumns() {
  return state.currentParallel <= 4 ? 2 : 3;
}

function stationPosition(index) {
  const columns = stationColumns();
  const col = index % columns;
  const row = Math.floor(index / columns);
  return {
    left: columns === 2 ? 64 + col * 190 : 34 + col * 176,
    top: 72 + row * 126,
  };
}

async function bootstrap() {
  setState("loading");
  syncSettingsToSetup();
  setStationCount(state.currentParallel);
  renderParallelPreview();
  renderOfficePlaceholders();
  setRunState("读取中", ["正在连接本地评测服务"]);

  try {
    const [instructions, reports] = await Promise.all([
      API.listInstructions(),
      API.listReports(),
    ]);
    state.reports = reports;
    renderInstructionOptions(instructions);
    if (instructions[0]) {
      await loadInstruction(instructions[0].name, { silent: true, staySetup: true });
    }

    // Auto-resume if there's a running evaluation in the background
    await checkActiveRun(instructions);

    enterSetup();
    setState("ready");
    if (!state.currentRunId) {
      setRunState("待开始", ["输入指令并配置本次派遣"]);
    }
  } catch (error) {
    setState("error");
    setRunState("服务异常", [error.message]);
    instructionPlane.innerHTML = `<p class="empty-copy">${escapeHtml(error.message)}</p>`;
  }
}

async function checkActiveRun(instructions) {
  try {
    const active = await API.listActiveRuns();
    if (!active.length) return;

    // Cancel all but the latest run to avoid wasting tokens
    if (active.length > 1) {
      for (let i = 1; i < active.length; i++) {
        API.cancelRun(active[i].run_id);
      }
    }

    const run = active[0];
    state.currentRunId = run.run_id;

    // Load the instruction if not already loaded
    const instrName = run.instruction;
    if (instrName && instructionSelect.value !== instrName) {
      const match = instructions.find((i) => i.name === instrName);
      if (match) await loadInstruction(match.name, { silent: true });
    }

    // Replay all accumulated progress
    const { progress, status } = await API.getProgress(run.run_id);
    state.liveParallel = readSettings().parallel_conversations;
    state.liveBatches = { 1: {} };
    state.activeBatch = 1;
    state.report = null;
    viewReportButton.disabled = true;
    state.evidence = {};
    resetLiveConstraintCoverage();
    state.currentEvidenceKey = "";
    clearEvalDetail();
    setStationCount(state.liveParallel);
    stationKeys.slice(0, state.liveParallel).forEach((key, index) => {
      state.evidence[key] = {
        title: `对话组 C${index}`,
        statusLabel: "聊天中",
        statusType: "active",
        statusDetail: "正在生成用户消息与 Agent 回复。",
        constraint: "等待首轮约束",
        latestUser: "等待用户模拟器生成消息",
        latestAgent: "等待 Agent 回复",
        turns: [],
        segments: [],
        evaluations: [],
      };
      updateStation(key, {
        title: `C${index}`,
        chip: "聊天中",
        type: "active",
        bubble: "",
        evidenceKey: key,
      });
    });
    renderLiveBatchControls();
    renderBatchSummary(0, state.liveParallel);
    enterWorkspace();
    setState("running");

    // Replay progress messages (they call updateFromProgress internally)
    if (progress && progress.length) {
      progress.forEach((msg) => appendProgressLine(msg));
      setRunState("运行中（已恢复）", [progress[progress.length - 1]]);
    }

    // Reconnect SSE stream for live updates going forward
    state.currentEventSource = API.streamProgress(
      run.run_id,
      appendProgressLine,
      async () => {
        const payload = await API.getRun(state.currentRunId);
        state.currentRunId = null;
        if (payload.error) throw new Error(payload.error);
        renderReport(payload.report);
        setRunState(
          Object.values(state.evidence).some((item) => item.statusType === "fail") ? "发现风险" : "评测完成",
          payload.progress?.slice(-4) || []
        );
      }
    );
  } catch (_e) {
    // If active run check fails, just proceed normally
  }
}

function renderInstructionOptions(instructions) {
  instructionSelect.innerHTML = '<option value="">选择指令文件...</option>';
  instructions.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = item.name;
    instructionSelect.appendChild(option);
  });
}

async function loadInstruction(name, options = {}) {
  const payload = await API.getInstruction(name);
  state.instructionName = payload.name;
  state.instructionContent = payload.content || "";
  resetLiveConstraintCoverage();
  setupInstruction.value = state.instructionContent;
  if (!options.keepReport) {
    state.report = null;
    viewReportButton.disabled = true;
  }
  instructionSelect.value = payload.name;
  instructionTitle.textContent = readableName(payload.name);
  renderInstructionText(state.instructionContent);
  renderOfficePlaceholders();
  renderSummary();
  clearEvalDetail();
  if (options.staySetup) {
    enterSetup();
  } else {
    enterWorkspace();
  }
  if (!options.silent) {
    setState("ready");
    setRunState("待开始", ["指令已载入", "等待派发对话组"]);
  }
}

async function loadLatestReport() {
  if (!state.reports.length) {
    state.reports = await API.listReports();
  }
  if (!state.reports.length) {
    setRunState("暂无历史", ["还没有可展示的报告"]);
    return;
  }
  await loadReport(state.reports[0].name);
}

async function openInspector(kind, key = "") {
  inspector.classList.add("visible");
  inspector.setAttribute("aria-hidden", "false");

  if (kind === "history") {
    inspectorEyebrow.textContent = "Past Runs";
    inspectorTitle.textContent = "历史报告";
    await renderHistoryPanel();
    return;
  }

  if (kind === "trace") {
    inspectorEyebrow.textContent = "Conversation Trace";
    inspectorTitle.textContent = "会话追溯";
    renderTracePanel(key || state.currentEvidenceKey);
    return;
  }

  inspectorEyebrow.textContent = "Evidence Library";
  inspectorTitle.textContent = "证据库";
  renderEvidenceLibrary();
}

function closeInspector() {
  inspector.classList.remove("visible");
  inspector.setAttribute("aria-hidden", "true");
}

async function renderHistoryPanel() {
  inspectorBody.innerHTML = '<div class="panel-empty">正在读取历史报告...</div>';
  if (!state.reports.length) {
    state.reports = await API.listReports();
  }
  if (!state.reports.length) {
    inspectorBody.innerHTML = '<div class="panel-empty">暂无历史报告。</div>';
    return;
  }

  const reports = await Promise.all(
    state.reports.slice(0, 12).map(async (item) => {
      try {
        const report = await API.getReport(item.name);
        const failures = new Set(
          (report.evaluations || [])
            .filter((evaluation) => evaluation.result === "fail")
            .map((evaluation) => evaluation.constraint_text)
        );
        return {
          name: item.name,
          source: readableName(report.source_file || item.name),
          coverage: Number(report.coverage) || 0,
          risks: failures.size,
          constraints: (report.constraint_stats || []).length,
          groups: (report.conversation_groups || []).length,
          reason: completionText(report.completion_reason),
          modified: item.modified,
          file: item.name,
        };
      } catch {
        return {
          name: item.name,
          source: readableName(item.name),
          coverage: 0,
          risks: 0,
          constraints: 0,
          groups: 0,
          reason: "无法读取",
          modified: item.modified,
          file: item.name,
        };
      }
    })
  );

  inspectorBody.innerHTML = `
    <div class="history-summary">
      <strong>${reports.length} 份报告</strong>
      <span>点击“打开报告”恢复对应评测现场</span>
    </div>
    <div class="history-strip">
      ${reports.map((report) => `
        <button class="history-node ${state.report && report.name.includes(reportBaseName(state.report)) ? "active" : ""}" type="button" data-report="${escapeHtml(report.name)}">
          <span class="node-top">
            <strong>${escapeHtml(report.source)}</strong>
            <em>${escapeHtml(reportStatusLabel(report.reason))}</em>
          </span>
          <span class="report-file">${escapeHtml(report.file)}</span>
          <span class="history-metrics">
            <span><b>${Math.round(report.coverage * 100)}%</b><small>覆盖率</small></span>
            <span><b>${report.constraints}</b><small>约束</small></span>
            <span><b>${report.groups}</b><small>对话组</small></span>
            <span class="${report.risks ? "risk-text" : ""}"><b>${report.risks}</b><small>风险</small></span>
          </span>
          <span class="node-bottom">
            <small>${escapeHtml(formatReportTime(report.modified))}</small>
            <strong>打开报告</strong>
          </span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderEvidenceLibrary(query = "") {
  const entries = Object.entries(state.evidence);
  if (!state.report || !entries.length) {
    inspectorBody.innerHTML = '<div class="panel-empty">当前报告还没有可查看的证据。</div>';
    return;
  }

  const normalized = query.trim().toLowerCase();
  const filtered = entries.filter(([, item]) => {
    const haystack = `${item.title} ${item.statusLabel} ${item.constraint} ${item.latestUser} ${item.latestAgent}`.toLowerCase();
    return !normalized || haystack.includes(normalized);
  });
  const blockedCount = entries.filter(([, item]) => item.statusType === "blocked").length;

  inspectorBody.innerHTML = `
    <div class="library-toolbar">
      <input id="evidenceSearch" type="search" placeholder="搜索对话组、状态、消息..." value="${escapeHtml(query)}" />
      <span>${entries.length} 组 · ${blockedCount} 卡住</span>
    </div>
    <div class="evidence-list">
      ${filtered.map(([key, item]) => `
        <button class="evidence-row ${item.statusType}" type="button" data-evidence="${escapeHtml(key)}">
          <span class="row-kicker">${escapeHtml(item.title)} · ${escapeHtml(item.statusLabel)} · ${item.turns.length} 轮</span>
          <strong>${escapeHtml(shortText(item.constraint, 46))}</strong>
          <small>${escapeHtml(shortText(item.latestUser || item.latestAgent || item.statusDetail, 72))}</small>
        </button>
      `).join("") || '<div class="panel-empty">没有匹配的证据。</div>'}
    </div>
  `;
  const input = document.querySelector("#evidenceSearch");
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function renderTracePanel(key) {
  const item = state.evidence[key];
  if (!item) {
    inspectorBody.innerHTML = '<div class="panel-empty">先点击一个工位或证据，再查看会话追溯。</div>';
    return;
  }

  const turns = item.turns || [];
  inspectorBody.innerHTML = `
    <div class="trace-summary ${item.statusType}">
      <span>${escapeHtml(item.title)} · ${escapeHtml(item.statusLabel)} · ${item.turns.length} 轮</span>
      <strong>${escapeHtml(item.constraint)}</strong>
      <small>${escapeHtml(item.statusDetail)}</small>
    </div>
    <div class="turn-list">
      ${turns.map((turn) => `
        <article class="turn-card">
          <header>
            <span>T${turn.local_turn_index || turn.turn_index || ""}</span>
            <small>${escapeHtml(shortText(turn.constraint_text || "桥接轮", 36))}</small>
          </header>
          <div class="utterance user">
            <b>用户</b>
            <p>${escapeHtml(turn.user_reply || "--")}</p>
          </div>
          <div class="utterance agent">
            <b>Agent</b>
            <p>${escapeHtml(turn.agent_reply || "--")}</p>
          </div>
          ${turn.code_gate_errors?.length ? `<div class="gate-errors">${turn.code_gate_errors.map(escapeHtml).join(" / ")}</div>` : ""}
        </article>
      `).join("") || '<div class="panel-empty">这组对话没有逐轮记录。</div>'}
    </div>
  `;
}

async function loadReport(name, options = {}) {
  const report = await API.getReport(name);
  state.report = report;
  state.progressLines = [];
  const parallel = clampParallel(report.parallel_conversations || state.currentParallel);
  setupInputs.parallel.value = parallel;
  settingsPanel.elements.parallel.value = parallel;
  state.currentParallel = parallel;
  setStationCount(parallel);
  enterWorkspace();
  syncInstructionSelectFromReport(report);
  renderReport(report);
  if (!options.silent) {
    setRunState("历史报告", [`已载入 ${name}`, completionText(report.completion_reason)]);
  }
}

function syncInstructionSelectFromReport(report) {
  const source = String(report.source_file || "").replaceAll("\\", "/");
  const sourceName = source.split("/").pop();
  if (sourceName && [...instructionSelect.options].some((option) => option.value === sourceName)) {
    instructionSelect.value = sourceName;
    state.instructionName = sourceName;
    instructionTitle.textContent = readableName(sourceName);
  } else if (report.source_file) {
    instructionTitle.textContent = readableName(report.source_file);
  }
}

function renderReport(report) {
  renderInstructionText(report.cleaned_instruction || state.instructionContent, report);
  renderSummary(report);
  buildEvidence(report);
  state.currentBatchIndex = 0;
  renderBatchControls(report);
  selectReportBatch(0);

  const firstRisk = Object.keys(state.evidence).find((key) => state.evidence[key].type === "fail");
  setState(firstRisk ? "risk" : "done");
  state.segments = buildSegmentsFromReport(report);
  clearSegDetail();
  renderSegmentStrip();
  renderReportDashboard(report);
  viewReportButton.disabled = false;
}

function renderReportDashboard(report) {
  if (!report) return;
  const summaries = getConstraintSummaries(report);
  const score = report.overall_score || {};
  const evaluations = report.evaluations || [];
  const passCount = evaluations.filter((item) => item.result === "pass").length;
  const failCount = evaluations.filter((item) => item.result === "fail").length;
  const invalidCount = evaluations.filter((item) => item.result === "invalid").length;
  const totalEval = evaluations.length || Number(score.total_evaluations) || 0;
  const passRate = totalEval ? passCount / totalEval : Number(score.overall_pass_rate) || 0;
  const coverage = Number(report.coverage ?? score.coverage) || 0;
  const target = Number(report.target_coverage) || 0;
  const groups = report.conversation_groups || [];
  const segments = report.segments || [];

  reportSubtitle.textContent = `${readableName(report.source_file || state.instructionName)} · 覆盖热力 + 数据面板`;
  reportTags.innerHTML = [
    `<span class="report-tag ${String(report.completion_reason || "").includes("stale") ? "warn" : ""}">${escapeHtml(completionText(report.completion_reason))}</span>`,
    `<span class="report-tag">目标覆盖 ${formatPercent(target)}</span>`,
    `<span class="report-tag">${groups.length} 个对话组</span>`,
    `<span class="report-tag">${report.parallel_conversations || state.currentParallel} 并行</span>`,
  ].join("");

  reportKpis.innerHTML = [
    reportKpi("覆盖率", formatPercent(coverage), `目标 ${formatPercent(target)}`),
    reportKpi("总通过率", formatPercent(passRate), `${passCount} / ${totalEval} 通过`),
    reportKpi("约束 / 片段", `${summaries.length} / ${segments.length || Number(score.total_segments) || 0}`, `${totalEval} 条评估`),
    reportKpi("运行耗时", formatDuration(report.elapsed_seconds), `${groups.length} 个对话组`),
  ].join("");

  renderReportBars(summaries);
  renderReportDonut(report, summaries, coverage);
  renderReportHeatmap(report, summaries);
  renderReportTable(summaries, report);
}

function reportKpi(label, value, sub) {
  return `<div class="report-kpi"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(sub)}</span></div>`;
}

function getConstraintSummaries(report) {
  const fromScore = report.overall_score?.constraint_eval_summaries;
  if (Array.isArray(fromScore) && fromScore.length) return fromScore;
  const evals = report.evaluations || [];
  const byConstraint = new Map();
  (report.constraint_stats || []).forEach((stat) => {
    const text = String(stat.constraint_text || "").trim();
    if (!text) return;
    byConstraint.set(text, {
      constraint_text: text,
      total_segments: constraintTestCount(stat),
      pass_count: 0,
      fail_count: 0,
      invalid_count: 0,
      pass_rate: 0,
    });
  });
  evals.forEach((ev) => {
    const text = String(ev.constraint_text || "").trim();
    if (!text) return;
    if (!byConstraint.has(text)) {
      byConstraint.set(text, {
        constraint_text: text,
        total_segments: 0,
        pass_count: 0,
        fail_count: 0,
        invalid_count: 0,
        pass_rate: 0,
      });
    }
    const item = byConstraint.get(text);
    item.total_segments += 1;
    if (ev.result === "pass") item.pass_count += 1;
    else if (ev.result === "fail") item.fail_count += 1;
    else item.invalid_count += 1;
  });
  return [...byConstraint.values()]
    .map((item) => ({
      ...item,
      pass_rate: item.total_segments ? item.pass_count / item.total_segments : 0,
    }))
    .sort((a, b) => a.pass_rate - b.pass_rate);
}

function renderReportBars(summaries) {
  reportBars.innerHTML = summaries.length
    ? summaries.map((item) => {
      const cls = reportColorClass(item.pass_rate);
      return `<div class="report-bar-row">
        <span class="report-bar-label" title="${escapeHtml(item.constraint_text)}">${escapeHtml(shortText(item.constraint_text, 34))}</span>
        <span class="report-bar-track"><span class="report-bar-fill ${cls}" style="width:${Math.max(item.pass_rate * 100, 4)}%"></span></span>
        <span class="report-bar-counts">${Number(item.pass_count) || 0}/${Number(item.fail_count) || 0}</span>
        <span class="report-bar-rate">${formatPercent(item.pass_rate)}</span>
      </div>`;
    }).join("")
    : '<div class="report-empty">暂无约束通过率数据</div>';
}

function renderReportDonut(report, summaries, coverage) {
  const circumference = 364.42;
  reportDonutFill.style.strokeDasharray = String(circumference);
  reportDonutFill.style.strokeDashoffset = String(circumference * (1 - Math.max(0, Math.min(1, coverage))));
  reportDonutVal.textContent = formatPercent(coverage);
  const stats = report.constraint_stats || [];
  const tested = stats.filter((item) => item.sufficiently_tested).length;
  const untested = Math.max(0, stats.length - tested);
  const risk = summaries.filter((item) => item.pass_rate < 0.8).length;
  reportDonutStats.innerHTML = [
    `<div class="report-donut-stat"><span>充分测试</span><strong>${tested || "--"}</strong></div>`,
    `<div class="report-donut-stat"><span>未充分测试</span><strong>${untested}</strong></div>`,
    `<div class="report-donut-stat"><span>需关注约束</span><strong>${risk}</strong></div>`,
  ].join("");
}

function renderReportHeatmap(report, summaries) {
  const source = String(report.cleaned_instruction || state.instructionContent || "");
  const highlights = buildReportHighlights(source, summaries);
  let html = "";
  let cursor = 0;
  highlights.forEach((item, index) => {
    if (item.start < cursor) return;
    html += escapeHtml(source.slice(cursor, item.start));
    html += `<span class="report-hl ${item.color}" data-report-hi="${index}">${escapeHtml(source.slice(item.start, item.end))}</span>`;
    cursor = item.end;
  });
  html += escapeHtml(source.slice(cursor));
  reportInstructionText.innerHTML = html || '<span class="report-empty">暂无指令文本</span>';
  reportDetail.innerHTML = '<div class="report-empty">点击左侧高亮约束查看测试证据</div>';
  reportInstructionText.querySelectorAll("[data-report-hi]").forEach((el) => {
    el.addEventListener("click", () => openReportConstraintDetail(highlights[Number(el.dataset.reportHi)], report, el));
  });
}

function buildReportHighlights(source, summaries) {
  const used = [];
  return summaries
    .map((summary) => {
      const text = String(summary.constraint_text || "").replace(/\*\*/g, "").trim();
      if (!text) return null;
      let start = source.indexOf(text);
      if (start < 0 && text.length > 18) start = source.indexOf(text.slice(0, 18));
      if (start < 0) return null;
      const end = Math.min(source.length, start + text.length);
      if (used.some((range) => start < range.end && end > range.start)) return null;
      const range = { start, end };
      used.push(range);
      return { ...range, summary, color: reportColorClass(summary.pass_rate) };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function openReportConstraintDetail(item, report, element) {
  if (!item) return;
  reportInstructionText.querySelectorAll(".report-hl.active").forEach((el) => el.classList.remove("active"));
  element.classList.add("active");
  const summary = item.summary;
  const evals = (report.evaluations || []).filter((ev) => ev.constraint_text === summary.constraint_text);
  reportDetail.innerHTML = `<div class="report-detail-title">${escapeHtml(summary.constraint_text)}</div>
    <div class="report-detail-grid">
      <div class="report-detail-box"><strong>${Number(summary.total_segments) || evals.length}</strong><span>测试次数</span></div>
      <div class="report-detail-box"><strong>${formatPercent(summary.pass_rate)}</strong><span>通过率</span></div>
      <div class="report-detail-box"><strong>${Number(summary.pass_count) || 0}</strong><span>通过</span></div>
      <div class="report-detail-box"><strong>${Number(summary.fail_count) || 0}</strong><span>失败</span></div>
    </div>
    ${evals.map(reportEvidenceHTML).join("") || '<div class="report-empty">暂无测试证据</div>'}`;
}

function reportEvidenceHTML(ev) {
  const turns = ev.segment_turns || [];
  return `<div class="report-evidence">
    <strong>${escapeHtml(`Segment #${ev.segment_id} · ${resultText(ev.result)}`)}</strong>
    <p>${escapeHtml(ev.evidence || "暂无评判依据")}</p>
    ${turns.map((turn) => `<div class="report-turn"><b>用户：</b>${escapeHtml(turn.user_reply || "")}</div><div class="report-turn"><b>Agent：</b>${escapeHtml(turn.agent_reply || "")}</div>`).join("")}
  </div>`;
}

function renderReportTable(summaries, report, filter = "all") {
  const filtered = summaries.filter((item) => {
    if (filter === "risk") return item.pass_rate < 0.8;
    if (filter === "ok") return item.pass_rate >= 0.8;
    return true;
  });
  reportTableBody.innerHTML = filtered.map((item, index) => reportTableRows(item, report, index)).join("");
  reportTableFoot.textContent = `共 ${filtered.length} 条约束，${summaries.filter((item) => item.pass_rate < 0.8).length} 条需关注`;
  reportTableBody.querySelectorAll("[data-report-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = document.querySelector(`#report-row-${button.dataset.reportRow}`);
      if (!row) return;
      row.classList.toggle("open");
      button.textContent = row.classList.contains("open") ? "收起" : "展开";
    });
  });
  document.querySelectorAll("[data-report-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.reportFilter === filter);
    button.onclick = () => renderReportTable(summaries, report, button.dataset.reportFilter);
  });
}

function reportTableRows(item, report, index) {
  const evals = (report.evaluations || []).filter((ev) => ev.constraint_text === item.constraint_text);
  const status = item.pass_rate >= 0.8 ? "ok" : "bad";
  const evidence = evals.map(reportEvidenceHTML).join("") || '<div class="report-empty">暂无测试证据</div>';
  return `<tr>
    <td class="constraint-cell">${escapeHtml(item.constraint_text)}</td>
    <td>${Number(item.total_segments) || evals.length}</td>
    <td>${Number(item.pass_count) || 0}</td>
    <td>${Number(item.fail_count) || 0}</td>
    <td>${Number(item.invalid_count) || 0}</td>
    <td>${formatPercent(item.pass_rate)}</td>
    <td><span class="report-status ${status}">${status === "ok" ? "达标" : "需关注"}</span></td>
    <td><button class="report-expand" type="button" data-report-row="${index}">展开</button></td>
  </tr>
  <tr class="report-row-detail" id="report-row-${index}"><td colspan="8">${evidence}</td></tr>`;
}

function reportColorClass(rate) {
  if (Number(rate) >= 0.8) return "ok";
  if (Number(rate) >= 0.5) return "warn";
  return "bad";
}

function resultText(result) {
  return { pass: "通过", fail: "失败", invalid: "无效" }[result] || "待评测";
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `${Math.round(num * 1000) / 10}%`;
}

function formatDuration(seconds) {
  const total = Number(seconds) || 0;
  if (!total) return "--";
  const minutes = Math.round(total / 60);
  return minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10}h` : `${minutes}min`;
}

function renderBatchControls(report) {
  const groups = report.conversation_groups || [];
  const size = getReportBatchSize(report);
  const batchCount = Math.max(1, Math.ceil(groups.length / size));
  batchIndicator.hidden = batchCount <= 1;
  batchLabel.textContent = `第 1 / ${batchCount} 批`;
  batchPrev.disabled = true;
  batchNext.disabled = batchCount <= 1;
}

function selectReportBatch(index) {
  if (!state.report) return;
  const groups = state.report.conversation_groups || [];
  const size = getReportBatchSize(state.report);
  const batchCount = Math.max(1, Math.ceil(groups.length / size));
  const safeIndex = Math.max(0, Math.min(batchCount - 1, index || 0));
  state.currentBatchIndex = safeIndex;
  const offset = safeIndex * size;
  const batchGroups = groups.slice(offset, offset + size);

  setStationCount(size);
  renderStations(batchGroups, state.report, offset);

  // 更新批次指示器
  batchIndicator.hidden = batchCount <= 1;
  batchLabel.textContent = `第 ${safeIndex + 1} / ${batchCount} 批`;
  batchPrev.disabled = safeIndex <= 0;
  batchNext.disabled = safeIndex >= batchCount - 1;

  // Segments show all report segments, not per-batch
  clearSegDetail();

  setRunState(`第 ${safeIndex + 1} 批`, [
    `${batchGroups.length} 组对话 · C${offset}–C${offset + batchGroups.length - 1}`,
    "点击工位查看对话详情",
  ]);
  state.batchRunState = {
    status: `第 ${safeIndex + 1} 批`,
    lines: [
      `${batchGroups.length} 组对话 · C${offset}–C${offset + batchGroups.length - 1}`,
      "点击工位查看对话详情",
    ],
  };

  // 渲染 mini 批次摘要
  renderBatchSummary(offset, batchGroups.length);
}

function restoreBatchRunState() {
  const { status, lines } = state.batchRunState;
  if (status) setRunState(status, lines);
  const history = document.querySelector("#runHistory");
  history.hidden = true;
  history.innerHTML = "";
  document.querySelectorAll("[data-popover]").forEach((el) => el.classList.remove("is-selected"));
  // 恢复批次摘要
  document.querySelector("#batchSummary").hidden = false;
}

function renderBatchSummary(offset, count) {
  const groupsRow = document.querySelector("#batchGroupsRow");
  const statsEl = document.querySelector("#batchStats");
  const summary = document.querySelector("#batchSummary");

  let tags = "";
  let doneCount = 0;
  let activeCount = 0;
  let waitCount = 0;

  for (let i = 0; i < count; i++) {
    const key = `c${offset + i}`;
    const item = state.evidence[key];
    const id = `C${offset + i}`;
    let typeClass = "wait";
    let label = "等待";

    if (item) {
      if (item.statusType === "done" || item.statusType === "pass") {
        typeClass = "done";
        label = "完成";
        doneCount++;
      } else if (item.statusType === "blocked" || item.statusType === "error" || item.statusType === "fail") {
        typeClass = "fail";
        label = item.statusLabel || "异常";
        doneCount++;
      } else if (item.statusType === "active") {
        typeClass = "active";
        label = item.statusLabel || "聊天中";
        activeCount++;
      } else {
        waitCount++;
      }
    } else {
      waitCount++;
    }

    tags += `<span class="mini-tag ${typeClass}"><span class="mini-id">${id}</span>${label}</span>`;
  }

  groupsRow.innerHTML = tags;

  // 统计行
  let statsHtml = "";
  if (doneCount > 0) statsHtml += `<span><span class="stat-dot green"></span>${doneCount} 完成</span>`;
  if (activeCount > 0) statsHtml += `<span><span class="stat-dot yellow"></span>${activeCount} 进行</span>`;
  if (waitCount > 0) statsHtml += `<span><span class="stat-dot gray"></span>${waitCount} 等待</span>`;

  // 从报告中提取覆盖率（如果有）
  if (state.report?.overall_score) {
    const cov = Math.round((state.report.overall_score.coverage || 0) * 100);
    statsHtml += `<span><span class="stat-dot ${cov >= 60 ? "green" : "yellow"}"></span>${cov}% 覆盖</span>`;
  }

  statsEl.innerHTML = statsHtml;
  summary.hidden = false;
}

function getReportBatchSize(report) {
  return clampParallel(report?.parallel_conversations || state.currentParallel || 1);
}

function renderInstructionText(rawText, report = null) {
  const blocks = splitInstruction(rawText);
  if (!blocks.length) {
    instructionPlane.innerHTML = '<p class="empty-copy">暂无指令内容。</p>';
    return;
  }

  let html = blocks.map(renderInstructionBlock).join("");
  if (report) {
    html = applyHighlights(html, report);
  }
  instructionPlane.innerHTML = html;
}

function renderInstructionBlock(block) {
  const text = String(block || "").trim();
  const clean = text.replace(/^#{1,4}\s*/, "").replace(/^-\s*/, "");
  if (/^# Role/i.test(text)) {
    return `<h3 class="map-section">${escapeHtml(clean)}</h3>`;
  }
  if (/^#{1,4}\s/.test(text)) {
    return `<h4 class="map-heading">${escapeHtml(clean)}</h4>`;
  }
  if (/^-\s/.test(text)) {
    return `<p class="map-bullet">${escapeHtml(clean)}</p>`;
  }
  return `<p>${escapeHtml(text)}</p>`;
}

function splitInstruction(rawText) {
  return String(rawText || "")
    .replace(/\r/g, "")
    .replace(/(#{1,4}\s+)/g, "\n\n$1")
    .replace(/\s+-\s+/g, "\n\n- ")
    .split(/\n{2,}/)
    .map((part) => part.replace(/\n+/g, " ").trim())
    .filter(Boolean);
}

function applyHighlights(html, report) {
  const evals = report.evaluations || [];
  const stats = [...(report.constraint_stats || [])].sort(
    (a, b) => String(b.constraint_text || "").length - String(a.constraint_text || "").length
  );
  const failed = new Set(
    evals.filter((item) => item.result === "fail").map((item) => item.constraint_text)
  );

  for (const stat of stats) {
    const text = String(stat.constraint_text || "").trim();
    if (!text) continue;
    const escaped = escapeHtml(text);
    if (!html.includes(escaped)) continue;
    const testCount = constraintTestCount(stat);
    const depth = failed.has(text)
      ? "risk"
      : testCount > 0
        ? "tested"
        : "pending";
    // count → --depth 映射：以 minTests 为满分，线性渐变到 0.7
    const minTests = Number(setupInputs.minTests?.value) || 3;
    const depthVal = failed.has(text)
      ? Math.max(0.52, Math.min(0.78, (testCount / minTests) * 0.64 + 0.14))
      : Math.min(0.78, Math.max(0.16, (testCount / minTests) * 0.7));
    html = html.replace(escaped, `<span class="fragment ${depth}" style="--depth:${depthVal.toFixed(2)}" title="已测试 ${testCount} 次">${escaped}</span>`);
  }
  return html;
}

function constraintTestCount(stat) {
  return Number(
    stat.count ??
    stat.total_segments ??
    stat.segment_count ??
    stat.test_count ??
    stat.tests ??
    ((Number(stat.pass_count) || 0) + (Number(stat.fail_count) || 0) + (Number(stat.invalid_count) || 0))
  ) || 0;
}

function renderSummary(report = null) {
  if (!report) {
    const liveCount = Object.keys(state.liveConstraintCounts || {}).length;
    const liveCoverage = Number(state.liveCoverage) || 0;
    summaryPill.innerHTML = liveCount || liveCoverage
      ? `<span>覆盖 ${Math.round(liveCoverage * 100)}%</span><span>已测约束 ${liveCount}</span><span>风险 --</span>`
      : "<span>覆盖 --</span><span>约束 --</span><span>风险 --</span>";
    return;
  }
  const stats = report.constraint_stats || [];
  const failures = new Set(
    (report.evaluations || [])
      .filter((item) => item.result === "fail")
      .map((item) => item.constraint_text)
  );
  const coverage = Math.round((Number(report.coverage) || 0) * 100);
  summaryPill.innerHTML = [
    `<span>覆盖 ${coverage}%</span>`,
    `<span>已测约束 ${stats.length}</span>`,
    `<span>风险 ${failures.size}</span>`,
  ].join("");
}

function resetLiveConstraintCoverage() {
  state.liveConstraintCounts = {};
  state.liveConstraintKeys = new Set();
  state.liveCoverage = 0;
  state.liveSegmentSeq = 0;
}

function addLiveConstraint(text, uniqueKey = "") {
  const constraint = String(text || "").trim();
  if (!constraint || constraint === "--") return false;
  const key = uniqueKey || constraint;
  if (state.liveConstraintKeys.has(key)) return false;
  state.liveConstraintKeys.add(key);
  state.liveConstraintCounts[constraint] = (state.liveConstraintCounts[constraint] || 0) + 1;
  renderLiveInstructionCoverage();
  return true;
}

function renderLiveInstructionCoverage() {
  if (!state.instructionContent || state.report) return;
  const stats = Object.entries(state.liveConstraintCounts)
    .map(([constraint_text, count]) => ({ constraint_text, count }));
  renderInstructionText(state.instructionContent, {
    constraint_stats: stats,
    evaluations: [],
    coverage: state.liveCoverage,
  });
  renderSummary();
}

function upsertLiveSegment({ cid = 0, turn = "", constraint = "", userReply = "", agentReply = "", status = "evaluating" }) {
  const text = String(constraint || "").trim();
  if (!text || text === "--") return null;
  const liveKey = `live:${cid}:${turn || text}`;
  let seg = state.segments.find((item) => item.liveKey === liveKey);
  if (!seg) {
    state.liveSegmentSeq += 1;
    seg = {
      id: -state.liveSegmentSeq,
      label: turn ? `C${cid} T${turn}` : `C${cid}`,
      liveKey,
      source: "live",
      cid,
      constraint: text,
      turns: turn ? 1 : 0,
      reason: "实时测试中",
      status,
      evidence: null,
      segTurns: [],
    };
    state.segments.push(seg);
  }
  seg.constraint = text;
  seg.status = status;
  seg.reason = status === "evaluating" ? "实时测试中" : seg.reason;
  if (userReply || agentReply) {
    seg.segTurns = [{
      user_reply: userReply,
      agent_reply: agentReply,
    }];
  }
  renderSegmentStrip();
  return seg;
}

function removeLiveSegmentsForConversation(cid) {
  state.segments = state.segments.filter((seg) => !(seg.source === "live" && Number(seg.cid) === Number(cid)));
}

function buildEvidence(report) {
  const evals = report.evaluations || [];
  state.evidence = {};

  (report.conversation_groups || []).forEach((group, index) => {
    const key = `c${index}`;
    const segments = group.segments || [];
    const groupEvals = evals.filter((item) =>
      segments.some((segment) => segment.segment_id === item.segment_id)
    );
    const selectedEval =
      groupEvals.find((item) => item.result === "fail") ||
      [...groupEvals].reverse().find((item) => item.result === "pass") ||
      groupEvals[groupEvals.length - 1];
    const lastTurn = [...(group.turns || [])].reverse().find((turn) => turn.is_test_turn) ||
      (group.turns || [])[group.turns.length - 1];
    const lastSegment = segments[segments.length - 1];
    const runtime = getGroupRuntime(group);

    state.evidence[key] = {
      title: `对话组 C${group.conversation_id ?? index}`,
      result: selectedEval?.result || "",
      type: selectedEval?.result === "fail" ? "fail" : selectedEval?.result === "pass" ? "pass" : "gate",
      statusLabel: runtime.label,
      statusType: runtime.type,
      statusDetail: runtime.detail,
      constraint: selectedEval?.constraint_text || lastSegment?.constraint_text || lastTurn?.constraint_text || "--",
      latestUser: lastTurn?.user_reply || selectedEval?.user_reply || "--",
      latestAgent: lastTurn?.agent_reply || selectedEval?.agent_reply || "--",
      evaluationSummary: selectedEval?.evidence || "",
      conversationId: group.conversation_id ?? index,
      turns: group.turns || [],
      segments,
      evaluations: groupEvals,
      completionReason: group.completion_reason || "",
    };
  });
}

function buildEvidenceItemFromGroup(group, evals = [], fallbackIndex = 0) {
  const segments = group.segments || [];
  const groupEvals = evals.filter((item) =>
    segments.some((segment) => segment.segment_id === item.segment_id)
  );
  const selectedEval =
    groupEvals.find((item) => item.result === "fail") ||
    [...groupEvals].reverse().find((item) => item.result === "pass") ||
    groupEvals[groupEvals.length - 1];
  const lastTurn = [...(group.turns || [])].reverse().find((turn) => turn.is_test_turn) ||
    (group.turns || [])[group.turns.length - 1];
  const lastSegment = segments[segments.length - 1];
  const runtime = getGroupRuntime(group);
  const id = group.conversation_id ?? fallbackIndex;

  return {
    title: `对话组 C${id}`,
    result: selectedEval?.result || "",
    type: selectedEval?.result === "fail" ? "fail" : selectedEval?.result === "pass" ? "pass" : "gate",
    statusLabel: runtime.label,
    statusType: runtime.type,
    statusDetail: runtime.detail,
    constraint: selectedEval?.constraint_text || lastSegment?.constraint_text || lastTurn?.constraint_text || "--",
    latestUser: lastTurn?.user_reply || selectedEval?.user_reply || "--",
    latestAgent: lastTurn?.agent_reply || selectedEval?.agent_reply || "--",
    evaluationSummary: selectedEval?.evidence || "",
    conversationId: id,
    turns: group.turns || [],
    segments,
    evaluations: groupEvals,
    completionReason: group.completion_reason || "",
  };
}

function renderOfficePlaceholders() {
  state.evidence = {};
  stationKeys.forEach((key, index) => {
    updateStation(key, {
      title: `C${index}`,
      chip: "等待",
      type: "wait",
      bubble: "",
    });
  });
}

function renderStations(groups, report, offset = 0) {
  stationKeys.forEach((key, index) => {
    const group = groups[index];
    const evidenceKey = `c${offset + index}`;
    if (!group) {
      updateStation(key, {
        title: `C${offset + index}`,
        chip: "等待",
        type: "wait",
        bubble: "",
        evidenceKey,
      });
      return;
    }

    const runtime = getGroupRuntime(group);
    updateStation(key, {
      title: `C${group.conversation_id ?? index}`,
      chip: runtime.label,
      type: runtime.type,
      bubble: "",
      evidenceKey,
    });
  });
}

function updateStation(key, meta) {
  const station = document.querySelector(`.station-${key}`);
  if (!station) return;
  const title = station.querySelector(".station-title");
  const chip = station.querySelector(".status-chip");
  const worker = station.querySelector(".worker");
  const bubble = station.querySelector(".problem-bubble");

  station.classList.toggle("risk", meta.type === "fail");
  station.classList.toggle("blocked", meta.type === "blocked");
  station.classList.toggle("idle", meta.type === "wait");
  station.dataset.popover = meta.evidenceKey || key;
  station.disabled = meta.type === "wait" && !state.evidence[station.dataset.popover];
  title.textContent = meta.title;
  chip.textContent = meta.chip;
  chip.className = `status-chip ${statusClass(meta.type)}`.trim();
  worker.className = `worker ${workerClass(meta.type)}`;
  if (bubble) {
    bubble.innerHTML = meta.bubble ? `<strong>${escapeHtml(meta.chip)}</strong>` : "";
  }
}

// ── Segment card functions ──

function buildSegmentsFromReport(report) {
  if (!report) return [];
  const evalMap = {};
  (report.evaluations || []).forEach((ev) => {
    if (ev.segment_id != null) evalMap[ev.segment_id] = ev;
  });
  return (report.segments || []).map((seg) => {
    const ev = evalMap[seg.segment_id];
    return {
      id: seg.segment_id,
      label: `S${seg.segment_id}`,
      cid: seg.conversation_id ?? 0,
      constraint: seg.constraint_text,
      turns: (seg.turns || []).length,
      reason: seg.complete_reason || "",
      status: ev ? ev.result : "pending",
      evidence: ev ? ev.evidence : null,
      segTurns: seg.turns || [],
    };
  });
}

function renderSegmentStrip() {
  if (!state.segments.length) {
    evalStrip.innerHTML = '<p class="eval-empty">对话产生后，证据 segment 会在这里陆续出现</p>';
    evalStartBtn.hidden = true;
    updateEvalStats();
    return;
  }
  evalStartBtn.hidden = false;
  evalStrip.innerHTML = state.segments.map(segCardHTML).join("");
  evalStrip.querySelectorAll(".seg-card").forEach((el) => {
    el.addEventListener("click", () => selectSegment(Number(el.dataset.id)));
  });
  if (state.selectedSegId !== null) highlightSegCard();
  updateEvalStats();
}

function segCardHTML(s) {
  return `<div class="seg-card" data-id="${s.id}" data-status="${s.status}">
    <div class="seg-bar"></div>
    <div class="seg-body">
      <div class="seg-id">${escapeHtml(s.label || `S${s.id}`)}</div>
      <div class="seg-constraint">${escapeHtml(s.constraint || "")}</div>
    </div>
  </div>`;
}

function updateSegCard(seg) {
  const el = evalStrip.querySelector(`.seg-card[data-id="${seg.id}"]`);
  if (!el) return;
  el.dataset.status = seg.status;
  const constraintEl = el.querySelector(".seg-constraint");
  if (constraintEl) constraintEl.textContent = seg.constraint || "";
}

function selectSegment(id) {
  state.selectedSegId = id;
  highlightSegCard();
  renderSegDetail(id);
}

function highlightSegCard() {
  evalStrip.querySelectorAll(".seg-card").forEach((el) => {
    el.classList.toggle("selected", Number(el.dataset.id) === state.selectedSegId);
  });
  const el = evalStrip.querySelector(`.seg-card[data-id="${state.selectedSegId}"]`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

function renderSegDetail(id) {
  const seg = state.segments.find((s) => s.id === id);
  if (!seg) return;
  evalDetailPanel.classList.remove("empty");
  const statusLabel = { pending: "待评测", evaluating: "评测中", pass: "通过", fail: "失败", invalid: "无效" };
  let evalHTML = "";
  if (seg.evidence) {
    evalHTML = `<div class="detail-field"><div class="detail-label">评判依据</div><div class="detail-value evidence">${seg.evidence}</div></div>`;
  }
  let turnsHTML = "";
  (seg.segTurns || []).forEach((t) => {
    turnsHTML += `<div class="turn-item">
      <div class="turn-label user">User</div><div class="turn-text">${t.user_reply || ""}</div>
      <div class="turn-label agent" style="margin-top:4px">Agent</div><div class="turn-text">${t.agent_reply || ""}</div>
    </div>`;
  });
  evalDetailPanel.innerHTML = `<div class="detail-head">
    <span class="seg-tag">${escapeHtml(seg.label || `S${seg.id}`)}</span><span class="group-tag">对话组 C${seg.cid}</span>
    <span class="result-pill ${seg.status}">${statusLabel[seg.status]}</span>
  </div><div class="detail-body">
    <div class="detail-field"><div class="detail-label">约束</div><div class="detail-value">${seg.constraint}</div></div>
    <div class="detail-field" style="display:flex;gap:16px">
      <div><div class="detail-label">轮次</div><div class="detail-value">${seg.turns}</div></div>
      <div><div class="detail-label">结束原因</div><div class="detail-value">${seg.reason}</div></div>
    </div>${evalHTML}
    <div class="detail-field"><div class="detail-label">对话内容</div><div class="turn-list">${turnsHTML}</div></div>
  </div>`;
}

function clearSegDetail() {
  state.selectedSegId = null;
  evalDetailPanel.innerHTML = '<div class="eval-detail-empty">点击便签查看详情</div>';
  evalDetailPanel.classList.add("empty");
  evalStrip.querySelectorAll(".seg-card").forEach((el) => el.classList.remove("selected"));
}

function updateEvalStats() {
  const counts = { pass: 0, fail: 0, invalid: 0, evaluating: 0, pending: 0 };
  state.segments.forEach((s) => counts[s.status]++);
  let runningCount = counts.evaluating;
  let pendingCount = counts.pending;
  if (state.evalRunning && runningCount === 0 && pendingCount > 0) {
    runningCount = 1;
    pendingCount -= 1;
  }
  document.getElementById("evalTotal").textContent = state.segments.length;
  document.getElementById("evalPass").textContent = counts.pass;
  document.getElementById("evalFail").textContent = counts.fail;
  document.getElementById("evalInvalid").textContent = counts.invalid;
  document.getElementById("evalRunning").textContent = runningCount;
  document.getElementById("evalPending").textContent = pendingCount;
}

function clearEvalDetail() {
  state.segments = [];
  state.selectedSegId = null;
  state.evalRunning = false;
  renderSegmentStrip();
  clearSegDetail();
}

// ── Eval start button ──
evalStartBtn.addEventListener("click", async () => {
  if (state.evalRunning || !state.report) return;
  state.evalRunning = true;
  evalStartBtn.classList.add("running");
  evalStartBtn.textContent = "评测中";
  markNextSegmentEvaluating();

  try {
    const result = await API.startEvaluation(state.report);
    if (result.error) throw new Error(result.error);
    state.currentEvalId = result.eval_id;

    state.currentEvalES = API.streamEvaluation(
      result.eval_id,
      (msg) => handleEvalProgress(msg),
      async () => {
        const payload = await API.getEvaluation(state.currentEvalId);
        state.evalRunning = false;
        state.currentEvalId = null;
        evalStartBtn.classList.remove("running");
        evalStartBtn.textContent = "开始评测";
        if (payload.evaluations) {
          applyEvalResults(payload.evaluations);
        }
      }
    );
  } catch (error) {
    state.evalRunning = false;
    evalStartBtn.classList.remove("running");
    evalStartBtn.textContent = "开始评测";
    state.segments.forEach((seg) => {
      if (seg.status === "evaluating") seg.status = "pending";
      updateSegCard(seg);
    });
    updateEvalStats();
  }
});

function handleEvalProgress(msg) {
  // Parse: "评估 S{id}/{total} 【{constraint}】→ {result}"
  const matchDone = msg.match(/评估 S(\d+)\/\d+ 【(.*?)】→ (pass|fail|invalid)/);
  if (matchDone) {
    const id = Number(matchDone[1]);
    const constraint = matchDone[2];
    const result = matchDone[3];
    const seg = ensureSegmentForEval(id, constraint);
    if (seg) {
      seg.status = result;
      addLiveConstraint(seg.constraint, `eval:${id}`);
      updateSegCard(seg);
      if (state.evalRunning) markNextSegmentEvaluating();
      else updateEvalStats();
      if (state.selectedSegId === id) renderSegDetail(id);
    }
    return;
  }
  // Parse: "评估 S{id}/{total} 【{constraint}】..." (evaluating)
  const matchStart = msg.match(/评估 S(\d+)\/\d+ 【(.*?)】\.\.\./);
  if (matchStart) {
    const id = Number(matchStart[1]);
    const constraint = matchStart[2];
    const seg = ensureSegmentForEval(id, constraint);
    if (seg) {
      seg.status = "evaluating";
      addLiveConstraint(seg.constraint, `eval:${id}`);
      updateSegCard(seg);
      updateEvalStats();
      if (state.selectedSegId === id) renderSegDetail(id);
    }
  }
}

function markNextSegmentEvaluating() {
  if (state.segments.some((seg) => seg.status === "evaluating")) {
    updateEvalStats();
    return;
  }
  const next = state.segments.find((seg) => seg.status === "pending");
  if (!next) {
    updateEvalStats();
    return;
  }
  next.status = "evaluating";
  updateSegCard(next);
  if (state.selectedSegId === next.id) renderSegDetail(next.id);
  updateEvalStats();
}

function ensureSegmentForEval(id, constraint = "") {
  let seg = state.segments.find((s) => Number(s.id) === Number(id));
  if (seg) return seg;
  const text = String(constraint || "").trim();
  if (!text) return null;
  seg = {
    id,
    label: `S${id}`,
    source: "eval",
    cid: 0,
    constraint: text,
    turns: 0,
    reason: "评测中",
    status: "evaluating",
    evidence: null,
    segTurns: [],
  };
  state.segments.push(seg);
  renderSegmentStrip();
  return seg;
}

function applyEvalResults(evaluations) {
  evaluations.forEach((ev) => {
    const seg = state.segments.find((s) => s.id === ev.segment_id);
    if (seg) {
      seg.status = ev.result;
      seg.evidence = ev.evidence;
      updateSegCard(seg);
    }
  });
  updateEvalStats();
  if (state.selectedSegId !== null) renderSegDetail(state.selectedSegId);
}

// ── Also handle eval progress during live collection runs ──
function handleCollectEvalProgress(msg) {
  // Same patterns as handleEvalProgress but for progress during collection
  handleEvalProgress(msg);
}

function setState(nextState) {
  shell.dataset.state = nextState;
  if (nextState === "running") {
    runToggle.textContent = "暂停";
    runToggle.disabled = false;
  } else if (nextState === "loading") {
    runToggle.textContent = "读取中";
    runToggle.disabled = true;
  } else if (nextState === "done" || nextState === "risk") {
    runToggle.textContent = "重新评测";
    runToggle.disabled = false;
  } else {
    runToggle.textContent = "开始评测";
    runToggle.disabled = false;
  }
}

function setRunState(status, lines = []) {
  const panel = document.querySelector(".run-panel");
  panel.querySelector(".run-state strong").textContent = status;
  const evidenceEl = panel.querySelector("#runEvidence");
  if (lines.length <= 1) {
    evidenceEl.innerHTML = `<strong>${status}</strong><span>${lines[0] || "等待评测事件"}</span>`;
  } else {
    evidenceEl.innerHTML = `<strong>${lines[0]}</strong><span>${lines.slice(1).filter(Boolean).join("</span><span>")}</span>`;
  }
}

function previewConversationGroup(key) {
  state.currentEvidenceKey = key;
  const item = state.evidence[key];
  const station = document.querySelector(`[data-popover="${key}"]`);
  const stationTitle = station?.querySelector(".station-title")?.textContent || key;
  const stationChip = station?.querySelector(".status-chip")?.textContent || "";
  const panel = document.querySelector(".run-panel");
  const history = document.querySelector("#runHistory");
  const evidenceEl = panel.querySelector("#runEvidence");
  // 选中工位时隐藏批次摘要，显示对话历史
  document.querySelector("#batchSummary").hidden = true;

  if (!item) {
    panel.querySelector(".run-state strong").textContent = `${stationTitle} · ${stationChip || "等待"}`;
    evidenceEl.innerHTML = `<span>该工位尚未生成对话记录</span>`;
    history.hidden = true;
    history.innerHTML = "";
    return;
  }

  // 更新标题行和约束信息
  panel.querySelector(".run-state strong").textContent = `${item.title} · ${item.statusLabel}`;
  const constraintText = item.constraint && item.constraint !== "--"
    ? `当前约束：${item.constraint}` : item.statusDetail;
  evidenceEl.innerHTML = `<strong>${constraintText}</strong>`;

  // 渲染对话历史
  const turns = item.turns || [];
  if (turns.length === 0 && item.latestUser === "--" && item.latestAgent === "--") {
    history.hidden = true;
    history.innerHTML = "";
    return;
  }

  let html = "";
  // 显示已有的轮次历史
  turns.forEach((turn) => {
    const constraintTag = turn.constraint_text && turn.constraint_text !== "--"
      ? `<span class="chat-constraint-tag">${escapeHtml(turn.constraint_text)}</span>` : "";
    html += `${constraintTag}`;
    html += `<div class="chat-bubble user"><span class="bubble-label">用户 T${turn.turn_index || turn.local_turn_index}</span>${escapeHtml(turn.user_reply)}</div>`;
    html += `<div class="chat-bubble agent"><span class="bubble-label">Agent</span>${escapeHtml(turn.agent_reply)}</div>`;
  });

  // 如果有 latestUser/latestAgent 但不在 turns 里（运行期间实时更新），也显示
  if (turns.length === 0 || (item.latestUser && item.latestUser !== "--" && turns[turns.length - 1]?.user_reply !== item.latestUser)) {
    if (item.latestUser && item.latestUser !== "--") {
      html += `<div class="chat-bubble user"><span class="bubble-label">用户</span>${escapeHtml(item.latestUser)}</div>`;
    }
    if (item.latestAgent && item.latestAgent !== "--") {
      html += `<div class="chat-bubble agent"><span class="bubble-label">Agent</span>${escapeHtml(item.latestAgent)}</div>`;
    }
  }

  history.innerHTML = html;
  history.hidden = false;
  // 自动滚到底部
  history.scrollTop = history.scrollHeight;
}

function appendProgressLine(message) {
  if (shell.dataset.state !== "running") {
    setState("running");
  }
  state.progressLines.push(message);
  updateFromProgress(message);
  if (!state.currentEvidenceKey) {
    setRunState("运行中", state.progressLines.slice(-4));
  }
}

function liveParallelCount() {
  return clampParallel(state.liveParallel || state.currentParallel || readSettings().parallel_conversations || 1);
}

function batchForConversation(cid) {
  return Math.floor(Number(cid) / liveParallelCount()) + 1;
}

function localKeyForConversation(cid) {
  return `c${Number(cid) % liveParallelCount()}`;
}

function ensureLiveGroup(cid) {
  const parallel = liveParallelCount();
  state.liveParallel = parallel;
  const batch = batchForConversation(cid);
  if (!state.liveBatches[batch]) state.liveBatches[batch] = {};
  if (!state.liveBatches[batch][cid]) {
    state.liveBatches[batch][cid] = {
      conversation_id: cid,
      turns: [],
      segments: [],
      diagnostics: [],
      completion_reason: "",
    };
  }
  return state.liveBatches[batch][cid];
}

function activateLiveBatchForConversation(cid) {
  const batch = batchForConversation(cid);
  if (state.activeBatch !== batch || stationKeys.length !== liveParallelCount()) {
    state.activeBatch = batch;
    setStationCount(liveParallelCount());
  } else {
    state.activeBatch = batch;
  }
  renderLiveBatch(batch);
  renderLiveBatchControls();
  renderBatchSummary((batch - 1) * liveParallelCount(), liveParallelCount());
}

function updateFromProgress(message) {
  const msg = String(message);

  // Evaluation progress: "评估 S{id}/{total} 【...】→ result" or "评估 S{id}/{total} 【...】..."
  if (msg.includes("评估 S")) {
    handleCollectEvalProgress(msg);
  }

  const groupPayload = parseGroupPayload(msg);
  if (groupPayload) {
    applyGroupPayload(groupPayload);
    return;
  }

  // ① 解析轮次消息 "C{cid} T{turn} U={user} A={agent} 【{constraint}】"
  const turnMatch = msg.match(/C(\d+)\s+T(\d+)\s+U=(.*?)\s+A=(.*?)(?:\s+【(.+?)】)?$/);
  if (turnMatch) {
    const cid = Number(turnMatch[1]);
    const turn = Number(turnMatch[2]);
    const userReply = turnMatch[3];
    const agentReply = turnMatch[4];
    const constraint = turnMatch[5] || "";
    const key = `c${cid}`;
    const localKey = localKeyForConversation(cid);
    addLiveConstraint(constraint, `turn:${cid}:${turn}`);
    upsertLiveSegment({
      cid,
      turn,
      constraint,
      userReply,
      agentReply,
      status: "evaluating",
    });
    const liveGroup = ensureLiveGroup(cid);
    if (!liveGroup.turns.some((item) => Number(item.turn_index || item.local_turn_index) === turn)) {
      liveGroup.turns.push({
        turn_index: turn,
        local_turn_index: turn,
        conversation_id: cid,
        constraint_text: constraint || "",
        user_reply: userReply,
        agent_reply: agentReply,
      });
    }

    // 确保或更新 evidence 条目
    if (!state.evidence[key]) {
      state.evidence[key] = {
        title: `对话组 C${cid}`,
        result: "",
        type: "active",
        statusLabel: "聊天中",
        statusType: "active",
        statusDetail: `第 ${turn} 轮`,
        constraint: "--",
        latestUser: "--",
        latestAgent: "--",
        evaluationSummary: "",
        conversationId: cid,
        turns: [],
        segments: [],
        evaluations: [],
        completionReason: "",
      };
    }
    const item = state.evidence[key];
    item.statusLabel = `第 ${turn} 轮`;
    item.statusDetail = constraint ? `约束：${constraint}` : `第 ${turn} 轮`;
    item.constraint = constraint || "--";
    item.latestUser = userReply;
    item.latestAgent = agentReply;

    // 累积轮次到 turns 数组
    if (!item.turns) item.turns = [];
    item.turns.push({
      turn_index: turn,
      local_turn_index: turn,
      conversation_id: cid,
      constraint_text: constraint || "",
      user_reply: userReply,
      agent_reply: agentReply,
    });

    // 更新工位视觉
    activateLiveBatchForConversation(cid);
    updateStation(localKey, {
      title: `C${cid}`,
      chip: `T${turn}`,
      type: "active",
      bubble: "",
      evidenceKey: key,
    });

    // 如果当前选中的正是这个工位，实时刷新 run-panel
    if (state.currentEvidenceKey === key) {
      previewConversationGroup(key);
    }
    return;
  }

  // ② 解析开场 "C{cid} 开场"
  const openMatch = msg.match(/C(\d+)\s+开场/);
  if (openMatch) {
    const cid = Number(openMatch[1]);
    const key = `c${cid}`;
    const localKey = localKeyForConversation(cid);
    ensureLiveGroup(cid);
    state.evidence[key] = {
      title: `对话组 C${cid}`,
      result: "",
      type: "active",
      statusLabel: "开场",
      statusType: "active",
      statusDetail: "Agent 已发送开场白",
      constraint: "--",
      latestUser: "等待用户模拟器",
      latestAgent: "已发送开场白",
      evaluationSummary: "",
      conversationId: cid,
      turns: [],
      segments: [],
      evaluations: [],
      completionReason: "",
    };
    activateLiveBatchForConversation(cid);
    updateStation(localKey, {
      title: `C${cid}`,
      chip: "开场",
      type: "active",
      bubble: "",
      evidenceKey: key,
    });
    return;
  }

  // ③ 解析完成 "C{cid} 完成：turns=N, segments=M, reason=xxx"
  const doneMatch = msg.match(/C(\d+)\s+完成：turns=(\d+),\s*segments=(\d+),\s*reason=(\S+)/);
  if (doneMatch) {
    const cid = Number(doneMatch[1]);
    const turns = Number(doneMatch[2]);
    const segments = Number(doneMatch[3]);
    const reason = doneMatch[4];
    const localKey = localKeyForConversation(cid);
    const type = reason.includes("gate") ? "blocked" : reason.includes("exception") ? "error" : "done";
    const liveGroup = ensureLiveGroup(cid);
    liveGroup.completion_reason = reason;
    liveGroup.diagnostics = liveGroup.diagnostics || [];
    liveGroup._segment_count = segments;

    activateLiveBatchForConversation(cid);
    updateStation(localKey, {
      title: `C${cid}`,
      chip: completionChip(reason),
      type,
      bubble: "",
      evidenceKey: `c${cid}`,
    });

    state.evidence[`c${cid}`] = {
      ...(state.evidence[`c${cid}`] || {}),
      title: `对话组 C${cid}`,
      result: type === "done" ? "done" : type,
      type,
      statusLabel: completionChip(reason),
      statusType: type,
      statusDetail: `完成：${turns} 轮，${segments} 段，${reason}`,
      conversationId: cid,
      completionReason: reason,
    };

    // 如果当前悬浮的正是这个工位，实时刷新
    if (state.currentEvidenceKey === `c${cid}`) {
      previewConversationGroup(`c${cid}`);
    }
    return;
  }

  // ④ 解析批次开始 "=== 第 X 批（共 N 组）==="
  const batchMatch = msg.match(/===\s*第\s*(\d+)\s*批/);
  if (batchMatch) {
    const batchNum = Number(batchMatch[1]);
    state.activeBatch = batchNum;
    state.liveParallel = readSettings().parallel_conversations;
    if (!state.liveBatches[batchNum]) state.liveBatches[batchNum] = {};
    setStationCount(state.liveParallel);
    renderLiveBatch(batchNum);
    renderLiveBatchControls();
    state.batchRunState = {
      status: `运行中 · 第 ${batchNum} 批`,
      lines: state.progressLines.slice(-3),
    };
    if (!state.currentEvidenceKey) {
      setRunState(state.batchRunState.status, state.batchRunState.lines);
    }
  }

  const coverageMatch = msg.match(/覆盖率:\s*([\d.]+)%\s*\|\s*约束:\s*(\d+)/);
  if (coverageMatch) {
    state.liveCoverage = Number(coverageMatch[1]) / 100;
    renderLiveInstructionCoverage();
  }
}

function parseGroupPayload(message) {
  const marker = "@@GROUP@@";
  const index = String(message).indexOf(marker);
  if (index < 0) return null;
  try {
    return JSON.parse(String(message).slice(index + marker.length));
  } catch {
    return null;
  }
}

function applyGroupPayload(payload) {
  const group = payload.group;
  if (!group) return;
  const batch = Number(payload.batch) || 1;
  const parallel = clampParallel(payload.parallel || state.liveParallel || state.currentParallel);
  const cid = Number(payload.conversation_id ?? group.conversation_id ?? 0);
  const key = `c${cid}`;

  state.liveParallel = parallel;
  state.activeBatch = batch;
  if (!state.liveBatches[batch]) state.liveBatches[batch] = {};
  state.liveBatches[batch][cid] = group;
  state.evidence[key] = buildEvidenceItemFromGroup(group, [], cid);

  // Incrementally add segments from this group
  if (group.segments) {
    if (group.segments.length) removeLiveSegmentsForConversation(cid);
    group.segments.forEach((seg) => {
      addLiveConstraint(seg.constraint_text, `segment:${seg.segment_id}`);
      if (!state.segments.find((s) => s.id === seg.segment_id)) {
        state.segments.push({
          id: seg.segment_id,
          cid: cid,
          constraint: seg.constraint_text,
          turns: (seg.turns || []).length,
          reason: seg.complete_reason || "",
          status: "pending",
          evidence: null,
          segTurns: seg.turns || [],
        });
      }
    });
    renderSegmentStrip();
  }

  setStationCount(parallel);
  renderLiveBatch(batch);
  renderLiveBatchControls();
  renderBatchSummary((batch - 1) * parallel, parallel);

  if (state.currentEvidenceKey === key) {
    previewConversationGroup(key);
  } else if (!state.currentEvidenceKey) {
    const item = state.evidence[key];
    setRunState(`运行中 · 第 ${batch} 批`, [
      `${item.title} · ${item.statusLabel}`,
      item.constraint && item.constraint !== "--" ? `当前约束：${item.constraint}` : item.statusDetail,
      item.latestUser && item.latestUser !== "--" ? `用户：${shortText(item.latestUser, 72)}` : "",
    ]);
  }
}

function renderLiveBatch(batch) {
  const parallel = state.liveParallel || state.currentParallel;
  const offset = (batch - 1) * parallel;
  stationKeys.forEach((localKey, index) => {
    const cid = offset + index;
    const group = state.liveBatches[batch]?.[cid];
    const evidenceKey = `c${cid}`;
    if (group) {
      const runtime = getGroupRuntime(group);
      updateStation(localKey, {
        title: `C${cid}`,
        chip: runtime.label,
        type: runtime.type,
        bubble: "",
        evidenceKey,
      });
    } else {
      state.evidence[evidenceKey] = state.evidence[evidenceKey] || {
        title: `对话组 C${cid}`,
        statusLabel: "聊天中",
        statusType: "active",
        statusDetail: "已派遣，等待该组完成并回传对话。",
        constraint: "等待首轮约束",
        latestUser: "等待用户模拟器生成消息",
        latestAgent: "等待 Agent 回复",
        conversationId: cid,
        turns: [],
        segments: [],
        evaluations: [],
      };
      updateStation(localKey, {
        title: `C${cid}`,
        chip: "聊天中",
        type: "active",
        bubble: "",
        evidenceKey,
      });
    }
  });
}

function renderLiveBatchControls() {
  const batches = Object.keys(state.liveBatches).map(Number).sort((a, b) => a - b);
  const maxBatch = Math.max(state.activeBatch || 1, ...batches, 1);
  batchIndicator.hidden = maxBatch <= 1;
  batchLabel.textContent = `第 ${state.activeBatch} / ${maxBatch} 批`;
  batchPrev.disabled = state.activeBatch <= 1;
  batchNext.disabled = state.activeBatch >= maxBatch;
}

function selectLiveBatch(batch) {
  const batches = Object.keys(state.liveBatches).map(Number).sort((a, b) => a - b);
  const maxBatch = Math.max(...batches, state.activeBatch || 1, 1);
  const safeBatch = Math.max(1, Math.min(maxBatch, Number(batch) || 1));
  state.activeBatch = safeBatch;
  setStationCount(state.liveParallel || state.currentParallel);
  renderLiveBatch(safeBatch);
  renderLiveBatchControls();
  renderBatchSummary((safeBatch - 1) * (state.liveParallel || state.currentParallel), state.liveParallel || state.currentParallel);
  clearEvalDetail();
  state.batchRunState = {
    status: `运行中 · 第 ${safeBatch} 批`,
    lines: [`查看第 ${safeBatch} 批外呼工位`, "点击工位查看该组消息历史"],
  };
  setRunState(state.batchRunState.status, state.batchRunState.lines);
}

async function startRun() {
  if (!instructionSelect.value) {
    setRunState("缺少指令", ["请先选择一个指令文件"]);
    return;
  }
  // Always cancel any running evaluation before starting a new one
  if (state.currentRunId) {
    API.cancelRun(state.currentRunId);
  }
  if (state.currentEventSource) {
    state.currentEventSource.close();
    state.currentEventSource = null;
  }
  state.currentRunId = null;
  state.report = null;
  viewReportButton.disabled = true;
  state.evidence = {};
  resetLiveConstraintCoverage();
  state.liveBatches = { 1: {} };
  state.activeBatch = 1;
  state.liveParallel = readSettings().parallel_conversations;
  state.currentEvidenceKey = "";
  clearEvalDetail();
  setStationCount(state.liveParallel);
  stationKeys.slice(0, Math.min(stationKeys.length, readSettings().parallel_conversations)).forEach((key, index) => {
    state.evidence[key] = {
      title: `对话组 C${index}`,
      statusLabel: "聊天中",
      statusType: "active",
      statusDetail: "正在生成用户消息与 Agent 回复。",
      constraint: "等待首轮约束",
      latestUser: "等待用户模拟器生成消息",
      latestAgent: "等待 Agent 回复",
      turns: [],
      segments: [],
      evaluations: [],
    };
    updateStation(key, {
      title: `C${index}`,
      chip: "聊天中",
      type: "active",
      bubble: "",
      evidenceKey: key,
    });
  });
  renderLiveBatchControls();
  renderBatchSummary(0, state.liveParallel);
  setState("running");
  setRunState("运行中", ["正在启动评测"]);

  try {
    const result = await API.startRun(instructionSelect.value, readSettings());
    if (result.error) {
      // 409 means same instruction already running — reconnect
      if (result.run_id) {
        state.currentRunId = result.run_id;
        state.currentEventSource = API.streamProgress(
          state.currentRunId,
          appendProgressLine,
          async () => {
            const payload = await API.getRun(state.currentRunId);
            state.currentRunId = null;
            if (payload.error) throw new Error(payload.error);
            renderReport(payload.report);
            setRunState(
              Object.values(state.evidence).some((item) => item.statusType === "fail") ? "发现风险" : "评测完成",
              payload.progress?.slice(-4) || []
            );
          }
        );
        setRunState("运行中", ["已接续正在运行的评测"]);
        return;
      }
      throw new Error(result.error);
    }
    state.currentRunId = result.run_id;
    state.currentEventSource = API.streamProgress(
      state.currentRunId,
      appendProgressLine,
      async () => {
        const payload = await API.getRun(state.currentRunId);
        state.currentRunId = null;
        if (payload.error) throw new Error(payload.error);
        renderReport(payload.report);
        setRunState(
          Object.values(state.evidence).some((item) => item.type === "fail") ? "发现风险" : "评测完成",
          payload.progress?.slice(-4) || []
        );
      }
    );
  } catch (error) {
    setState("ready");
    setRunState("启动失败", [error.message]);
  }
}

function stopRun(options = {}) {
  if (state.currentEventSource) {
    state.currentEventSource.close();
    state.currentEventSource = null;
  }
  if (state.currentRunId && !options.silent) {
    API.cancelRun(state.currentRunId);
  }
  state.currentRunId = null;
  if (!options.silent) {
    setState("ready");
    setRunState("已取消", ["可重新开始评测"]);
  }
}

function readableName(name) {
  return String(name || "未命名指令")
    .split(/[\\/]/)
    .pop()
    .replace(/^sample_instruction_/, "")
    .replace(/\.md$|\.json$/g, "")
    .replaceAll("_", " ");
}

function reportBaseName(report) {
  const source = String(report?.source_file || state.instructionName || "v4_report");
  return readableName(source).replace(/\s+/g, "_");
}

function getGroupRuntime(group) {
  const turns = group.turns || [];
  const reason = String(group.completion_reason || "");
  const hasGateErrors = turns.some((turn) => turn.code_gate_errors?.length);
  const diagnostics = group.diagnostics || [];
  const lastTurn = turns[turns.length - 1];

  if (!turns.length && !reason) {
    return {
      label: "等待",
      type: "wait",
      detail: "尚未派遣对话组。",
    };
  }

  if (reason.includes("exception")) {
    return {
      label: "异常",
      type: "error",
      detail: diagnostics[0] || "对话组运行时出现异常。",
    };
  }

  if (reason.includes("gate") || hasGateErrors) {
    const gateError = turns.find((turn) => turn.code_gate_errors?.length)?.code_gate_errors?.[0];
    return {
      label: "门控失败",
      type: "blocked",
      detail: gateError || diagnostics[0] || "用户消息未通过门控，当前组停止推进。",
    };
  }

  if (reason) {
    return {
      label: "已结束",
      type: "done",
      detail: completionText(reason) || `最后一轮：${shortText(lastTurn?.user_reply || "", 42)}`,
    };
  }

  return {
    label: "聊天中",
    type: "active",
    detail: lastTurn ? `最新一轮：${shortText(lastTurn.user_reply || "", 42)}` : "对话组正在生成用户消息与 Agent 回复。",
  };
}

function workerClass(type) {
  if (type === "blocked" || type === "error") return "free alert";
  if (type === "fail") return "targeted alert";
  if (type === "done" || type === "pass") return "free verify";
  if (type === "active" || type === "gate") return "free calling";
  return "waiting";
}

function statusClass(type) {
  return {
    blocked: "blocked",
    error: "danger",
    done: "done",
    active: "active",
    wait: "",
    fail: "danger",
    pass: "pass",
  }[type] || "";
}

function completionChip(reason) {
  if (!reason) return "门控";
  if (reason.includes("end")) return "完成";
  if (reason.includes("gate")) return "门控";
  if (reason.includes("exception")) return "异常";
  return "完成";
}

function completionText(reason) {
  return {
    coverage_and_min_tests_reached: "覆盖率与测试次数达标",
    stale_and_sufficient_stopped: "覆盖停滞，但约束已充分测试",
    stale_but_insufficient_stopped: "覆盖停滞，仍有约束不足",
    stale_coverage_stopped: "覆盖率停滞",
    max_batches_reached: "达到最大批次数",
    max_turns: "达到最大轮次",
    user_llm_end: "用户模拟结束",
    user_gate_failed: "用户门控失败",
    exception: "运行异常",
  }[reason] || reason || "";
}

function reportStatusLabel(reasonText) {
  const text = String(reasonText || "");
  if (text.includes("达标")) return "已达标";
  if (text.includes("停滞")) return "已停止";
  if (text.includes("最大") || text.includes("达到")) return "已结束";
  if (text.includes("异常") || text.includes("无法")) return "异常";
  return "历史";
}

function formatReportTime(timestamp) {
  if (!timestamp) return "本地报告";
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "本地报告";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortText(text, maxLength) {
  const value = String(text || "");
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

bootstrap();
