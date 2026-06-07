(function () {
  "use strict";

  const SCENARIOS = ["rider", "merchant"];
  const DEFAULT_SCENARIO = "rider";
  const scriptUrl = document.currentScript?.src || location.href;
  const rootDataUrl = new URL("../data/", scriptUrl);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const array = (value) => Array.isArray(value) ? value : [];

  function scenarioFromValue(value) {
    const text = String(value || "").toLowerCase();
    return text.includes("merchant") ? "merchant" : "rider";
  }

  async function readJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  }

  function normalize(report) {
    const next = clone(report || {});
    next.conversation_groups = array(next.conversation_groups);
    next.turns = array(next.turns);
    next.segments = array(next.segments);
    next.evaluations = array(next.evaluations);
    next.constraint_stats = array(next.constraint_stats);
    next.diagnostics = array(next.diagnostics);

    if (!next.turns.length) {
      next.turns = next.conversation_groups.flatMap((group) => array(group.turns));
    }
    if (!next.segments.length) {
      next.segments = next.conversation_groups.flatMap((group) => array(group.segments));
    }

    const evaluationsById = new Map(next.evaluations.map((item) => [Number(item.segment_id), item]));
    next.segments = next.segments.map((segment, index) => ({
      ...segment,
      segment_id: Number(segment.segment_id ?? index + 1),
      conversation_id: Number(segment.conversation_id ?? 0),
      evaluation: evaluationsById.get(Number(segment.segment_id)) || null,
    }));

    const computed = new Map();
    next.evaluations.forEach((evaluation) => {
      const text = String(evaluation.constraint_text || "未命名约束");
      if (!computed.has(text)) {
        computed.set(text, {
          constraint_text: text,
          total_segments: 0,
          pass_count: 0,
          fail_count: 0,
          invalid_count: 0,
          pass_rate: 0,
        });
      }
      const item = computed.get(text);
      item.total_segments += 1;
      if (evaluation.result === "pass") item.pass_count += 1;
      else if (evaluation.result === "fail") item.fail_count += 1;
      else item.invalid_count += 1;
    });
    computed.forEach((item) => {
      const valid = item.pass_count + item.fail_count;
      item.pass_rate = valid ? item.pass_count / valid : 0;
    });

    const supplied = array(next.overall_score?.constraint_eval_summaries);
    const summaries = supplied.length ? supplied : [...computed.values()];
    const passCount = next.evaluations.filter((item) => item.result === "pass").length;
    const failCount = next.evaluations.filter((item) => item.result === "fail").length;
    const invalidCount = next.evaluations.length - passCount - failCount;
    const validCount = passCount + failCount;

    next.overall_score = {
      ...(next.overall_score || {}),
      total_constraints_tested: next.overall_score?.total_constraints_tested ?? summaries.length,
      total_segments: next.overall_score?.total_segments ?? next.segments.length,
      total_evaluations: next.overall_score?.total_evaluations ?? next.evaluations.length,
      overall_pass_rate: Number.isFinite(Number(next.overall_score?.overall_pass_rate))
        ? Number(next.overall_score.overall_pass_rate)
        : (validCount ? passCount / validCount : 0),
      coverage: Number(next.overall_score?.coverage ?? next.coverage ?? 0),
      constraint_eval_summaries: summaries,
      pass_count: passCount,
      fail_count: failCount,
      invalid_count: invalidCount,
    };
    next.coverage = Number(next.coverage ?? next.overall_score.coverage ?? 0);
    return next;
  }

  function buildTimeline(report) {
    const events = [];
    const evaluationMap = new Map(report.evaluations.map((item) => [Number(item.segment_id), item]));
    report.conversation_groups.forEach((group, groupIndex) => {
      const cid = Number(group.conversation_id ?? groupIndex);
      events.push({ type: "open", cid, label: `C${cid} 开场`, message: group.opening_line || report.opening_line || "Agent 建立对话" });
      array(group.turns).forEach((turn, turnIndex) => {
        const segmentId = Number(turn.segment_id ?? 0);
        events.push({
          type: "turn",
          cid,
          turn: Number(turn.turn_index ?? turn.local_turn_index ?? turnIndex + 1),
          segmentId,
          constraint: turn.constraint_text || "",
          user: turn.user_reply || "",
          agent: turn.agent_reply || "",
          label: `C${cid} T${turnIndex + 1}`,
          message: turn.user_reply || "生成测试消息",
        });
        if (!segmentId) return;
        events.push({
          type: "segment",
          cid,
          segmentId,
          constraint: turn.constraint_text || "",
          label: `Segment S${segmentId}`,
          message: turn.constraint_text || "形成测试片段",
        });
        const evaluation = evaluationMap.get(segmentId);
        if (evaluation) {
          events.push({
            type: "eval",
            cid,
            segmentId,
            result: evaluation.result,
            label: `Evaluation S${segmentId}`,
            message: evaluation.evidence || evaluation.result,
          });
        }
      });
      events.push({
        type: group.completion_reason === "exception" ? "error" : "done",
        cid,
        label: `C${cid} 完成`,
        message: group.completion_reason || "conversation_finished",
      });
    });
    return events;
  }

  const state = {
    loaded: false,
    source: "未加载",
    degraded: false,
    reports: new Map(),
    comparison: null,
  };

  async function loadScenario(name) {
    if (location.protocol !== "file:") {
      try {
        return normalize(await readJson(new URL(`${name}/report.json`, rootDataUrl)));
      } catch (_error) {
        state.degraded = true;
      }
    }
    const bundled = window.PPT_SCENARIO_BUNDLES?.scenarios?.[name]?.report;
    if (!bundled) throw new Error(`缺少 ${name} 数据`);
    return normalize(bundled);
  }

  const DemoAPI = {
    async initialize() {
      if (state.loaded) return this.getMeta();
      const loaded = await Promise.all(SCENARIOS.map(async (name) => [name, await loadScenario(name)]));
      loaded.forEach(([name, report]) => state.reports.set(name, report));
      state.comparison = window.PPT_SCENARIO_BUNDLES?.comparison || null;
      state.source = location.protocol === "file:"
        ? "data 静态场景包"
        : (state.degraded ? "data 静态降级场景包" : "data/rider + data/merchant");
      state.loaded = true;
      return this.getMeta();
    },

    getMeta() {
      return {
        source: state.source,
        degraded: state.degraded,
        scenarios: [...state.reports.keys()],
        defaultScenario: DEFAULT_SCENARIO,
      };
    },

    async listInstructions() {
      await this.initialize();
      return SCENARIOS.map((name) => {
        const report = state.reports.get(name);
        return {
          name: String(report.source_file || `${name}.md`).split(/[\\/]/).pop(),
          content: report.cleaned_instruction || "",
          scenario: name,
        };
      });
    },

    async getInstruction(value = DEFAULT_SCENARIO) {
      const scenario = scenarioFromValue(value);
      const items = await this.listInstructions();
      return clone(items.find((item) => item.scenario === scenario) || items[0]);
    },

    async listReports() {
      await this.initialize();
      return SCENARIOS.map((name) => {
        const report = state.reports.get(name);
        return {
          name: `${name}-report.json`,
          source: name,
          modified: Math.floor(Date.now() / 1000),
          completion_reason: report.completion_reason,
        };
      });
    },

    async getReport(value = DEFAULT_SCENARIO) {
      await this.initialize();
      return clone(state.reports.get(scenarioFromValue(value)) || state.reports.get(DEFAULT_SCENARIO));
    },

    async startRun(value = DEFAULT_SCENARIO) {
      const report = await this.getReport(value);
      return {
        run_id: `offline-${scenarioFromValue(value)}`,
        scenario: scenarioFromValue(value),
        status: "ready",
        timeline: buildTimeline(report),
      };
    },

    streamProgress(runId, handlers = {}) {
      const scenario = scenarioFromValue(runId);
      const report = state.reports.get(scenario);
      const timeline = buildTimeline(report);
      let index = 0;
      let timer = null;
      let speed = 1;
      let running = false;

      const emit = () => {
        if (index >= timeline.length) {
          running = false;
          handlers.onDone?.({ runId, report: clone(report) });
          return false;
        }
        handlers.onProgress?.({ ...timeline[index], index, total: timeline.length });
        index += 1;
        return true;
      };
      const schedule = () => {
        if (!running) return;
        if (!emit()) return;
        timer = setTimeout(schedule, Math.max(70, 420 / speed));
      };

      return {
        play() { if (!running) { running = true; schedule(); } },
        pause() { running = false; clearTimeout(timer); },
        step() { this.pause(); emit(); },
        reset() { this.pause(); index = 0; handlers.onReset?.(); },
        setSpeed(value) { speed = Number(value) || 1; },
        getState() { return { index, total: timeline.length, running, speed }; },
        close() { this.pause(); },
      };
    },

    async getEvaluation(value = DEFAULT_SCENARIO) {
      const report = await this.getReport(value);
      return clone(report.evaluations);
    },

    getComparison() {
      return state.comparison ? clone(state.comparison) : null;
    },
  };

  window.DemoAPI = DemoAPI;
})();
