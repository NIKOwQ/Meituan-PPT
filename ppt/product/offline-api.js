(function () {
  "use strict";

  const runs = new Map();
  const evaluations = new Map();
  const customInstructions = new Map();
  const reportCache = new Map();
  const instructionCache = new Map();
  let sequence = 0;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function ensureData() {
    await window.DemoAPI.initialize();
    if (!reportCache.size) {
      const instructions = await window.DemoAPI.listInstructions();
      for (const instruction of instructions) {
        instructionCache.set(instruction.name, instruction);
        reportCache.set(instruction.scenario, await window.DemoAPI.getReport(instruction.scenario));
      }
    }
  }

  function scenarioFromValue(value) {
    return String(value || "").toLowerCase().includes("merchant") ? "merchant" : "rider";
  }

  function eventToMessage(event, report) {
    if (event.type === "open") return `C${event.cid} 开场`;
    if (event.type === "turn") {
      return `C${event.cid} T${event.turn || 1} U=${event.user || event.message || ""} A=${event.agent || ""}${event.constraint ? ` 【${event.constraint}】` : ""}`;
    }
    if (event.type === "done" || event.type === "error") {
      const group = report.conversation_groups.find((item, index) => Number(item.conversation_id ?? index) === Number(event.cid));
      return `C${event.cid} 完成：turns=${group?.turns?.length || 0}, segments=${group?.segments?.length || 0}, reason=${group?.completion_reason || (event.type === "error" ? "exception" : "done")}`;
    }
    if (event.type === "segment") {
      const covered = report.segments.filter((item) => Number(item.segment_id) <= Number(event.segmentId)).length;
      const progress = covered / Math.max(1, report.segments.length);
      return `覆盖率: ${(report.coverage * progress * 100).toFixed(2)}% | 约束: ${Math.min(report.constraint_stats.length, covered)}`;
    }
    return event.message || event.label || "";
  }

  function makeStream(messages, onProgress, onDone, delay = 180) {
    let index = 0;
    let timer = null;
    let closed = false;
    const tick = () => {
      if (closed) return;
      if (index >= messages.length) {
        onDone?.();
        return;
      }
      onProgress?.(messages[index]);
      index += 1;
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 80);
    return {
      close() {
        closed = true;
        clearTimeout(timer);
      },
    };
  }

  window.OfflineAPI = {
    async listInstructions() {
      await ensureData();
      const defaults = [...instructionCache.values()].map((item) => clone(item));
      const customs = [...customInstructions].map(([name, content]) => ({ name, content }));
      return [...customs, ...defaults];
    },

    async getInstruction(name) {
      await ensureData();
      if (customInstructions.has(name)) return { name, content: customInstructions.get(name) };
      return clone(instructionCache.get(name) || [...instructionCache.values()][0]);
    },

    async saveInstruction(name, content) {
      customInstructions.set(name, content);
      return { name, content };
    },

    async listReports() {
      await ensureData();
      return ["rider", "merchant"].map((scenario) => ({
        name: `${scenario}-report.json`,
        modified: Math.floor(Date.now() / 1000),
      }));
    },

    async getReport(name) {
      await ensureData();
      return clone(reportCache.get(scenarioFromValue(name)) || reportCache.get("rider"));
    },

    async startRun(instruction, opts = {}) {
      await ensureData();
      const scenario = scenarioFromValue(instruction);
      const report = reportCache.get(scenario) || reportCache.get("rider");
      const source = await window.DemoAPI.startRun(scenario, opts);
      const runId = `offline-run-${++sequence}`;
      const progress = source.timeline
        .map((event) => eventToMessage(event, report))
        .filter(Boolean);
      runs.set(runId, { progress, report: clone(report), status: "running", scenario });
      return { run_id: runId };
    },

    async getRun(runId) {
      await ensureData();
      const run = runs.get(runId);
      return run ? { report: clone(run.report), progress: [...run.progress] } : { report: clone(reportCache.get("rider")), progress: [] };
    },

    streamProgress(runId, onProgress, onDone) {
      const run = runs.get(runId);
      if (!run) return { close() {} };
      return makeStream(run.progress, onProgress, () => {
        run.status = "done";
        onDone?.();
      });
    },

    async listActiveRuns() {
      return [];
    },

    async cancelRun(runId) {
      if (runs.has(runId)) runs.get(runId).status = "cancelled";
    },

    async getProgress(runId) {
      const run = runs.get(runId);
      return { progress: run?.progress || [], status: run?.status || "done" };
    },

    async startEvaluation(report) {
      await ensureData();
      const evalId = `offline-eval-${++sequence}`;
      evaluations.set(evalId, clone(report?.evaluations?.length ? report.evaluations : reportCache.get("rider").evaluations));
      return { eval_id: evalId };
    },

    async getEvaluation(evalId) {
      return { evaluations: clone(evaluations.get(evalId) || []) };
    },

    streamEvaluation(evalId, onProgress, onDone) {
      const items = evaluations.get(evalId) || [];
      const messages = items.map((item, index) =>
        `评估 S${item.segment_id}/${items.length} 【${item.constraint_text || "约束"}】→ ${item.result || "invalid"}`
      );
      return makeStream(messages, onProgress, onDone, 100);
    },
  };
})();
