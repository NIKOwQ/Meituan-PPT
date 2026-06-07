(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const notes = {
    input: ["01", "长指令原文", "这里直接复用真实前端的输入平面。用户可以粘贴或修改任意长指令；离线演示只把运行结果映射到预跑中间产物，不伪装为现场模型调用。"],
    config: ["02", "主参数先行", "真实前端默认只展示最大轮次、目标覆盖率、并行数和是否评估。重试、停滞与定向阈值放入“更多”，用渐进披露降低首次理解成本。"],
    dispatch: ["03", "并行工位预览", "配置并行数时，像素工位数量立即变化。抽象参数被转化为可见的工作资源，让用户在运行前形成正确预期。"],
    evidence: ["01", "证据库与检查抽屉", "完整证据不挤在主工作区里。用户通过真实前端的证据库进入对话组，再在 Inspector 中查看逐轮消息和门控信息。"],
  };

  const labCases = {
    code: {
      title: "代码门控失败",
      subtitle: "重复、非原文子串或格式错误被确定性规则拦截。",
      claim: "机械错误不进入 Agent，也不形成 Segment。",
      pipeline: ["候选消息", "子串/去重/格式", "拒绝样本", "重新生成"],
      rows: [
        ["触发信号", "候选用户话术不是原文子串、与历史候选重复，或缺少必要字段。"],
        ["系统决策", "记录 reject_reason，保留生成上下文，立即回到候选生成。"],
        ["指标口径", "不计入覆盖率、Segment 数、有效评估数和失败率。"],
        ["恢复动作", "收紧候选 prompt，优先换约束、换对话阶段、换用户意图。"],
      ],
      log: "C3 gate=code reject=not_substring retry=2 target=C12",
      chips: ["deterministic", "no segment", "retry"],
      figure: ["RAW", "CHECK", "BLOCK", "RETRY"],
    },
    semantic: {
      title: "语义门控失败",
      subtitle: "候选消息形式正确，但没有真正触发目标约束。",
      claim: "关键词命中不等于有效测试。",
      pipeline: ["候选消息", "语义验证", "触发不足", "退回重试"],
      rows: [
        ["触发信号", "话术包含相关词，但用户意图不足以逼出被测行为。"],
        ["系统决策", "把失败归因给测试样本，而不是 Agent 回复。"],
        ["指标口径", "不产出 Segment；只进入门控诊断和生成质量统计。"],
        ["恢复动作", "补充触发条件、上下文压力和不可跳过的用户追问。"],
      ],
      log: "C5 gate=semantic confidence=.41 need=.72 action=regenerate",
      chips: ["intent check", "sample quality", "coverage safe"],
      figure: ["TEXT", "INTENT", "LOW", "RETRY"],
    },
    stale: {
      title: "覆盖率停滞",
      subtitle: "连续多个批次没有新增覆盖，系统停止继续消耗。",
      claim: "未达目标也要诚实退出。",
      pipeline: ["批次完成", "覆盖对比", "停滞命中", "冻结结果"],
      rows: [
        ["触发信号", "连续 N 轮新增约束为 0，或新增 Segment 重复落在已覆盖约束。"],
        ["系统决策", "停止扩展批次，保留已完成对话和未覆盖清单。"],
        ["指标口径", "覆盖率按真实结果展示，不用合成样本补齐目标。"],
        ["恢复动作", "输出未覆盖约束，下一轮定向补充而不是盲目加并发。"],
      ],
      log: "batch=4 new_constraints=0 stale=3/3 stop=coverage_plateau",
      chips: ["honest stop", "target gap", "directed refill"],
      figure: ["B1", "B2", "B3", "STOP"],
    },
    worker: {
      title: "部分工位异常",
      subtitle: "一个对话组失败，其他已完成证据仍被保留。",
      claim: "故障边界位于独立对话组。",
      pipeline: ["工位运行", "异常隔离", "汇总降级", "保留证据"],
      rows: [
        ["触发信号", "单组超时、模型调用异常、流式事件中断或状态机非法跳转。"],
        ["系统决策", "只标记该 conversation_group，不回滚其他已完成组。"],
        ["指标口径", "异常组不参与有效通过率；报告展示完成率和异常原因。"],
        ["恢复动作", "允许单组重跑，或保留批次并进入报告诊断。"],
      ],
      log: "C7 status=error source=sse_timeout keep_completed=9/10",
      chips: ["isolated", "partial report", "rerunnable"],
      figure: ["C1", "C7", "C9", "KEEP"],
    },
    invalid: {
      title: "无效评估",
      subtitle: "证据不足以支持判定，样本不进入有效通过率。",
      claim: "评测器的问题不转嫁给 Agent。",
      pipeline: ["Segment", "Judge", "Invalid", "证据留档"],
      rows: [
        ["触发信号", "对话没有形成可判定动作，或 judge 理由无法支撑 pass/fail。"],
        ["系统决策", "保留原始对话和评估理由，结论标为 invalid。"],
        ["指标口径", "从有效通过率分母剔除，但进入样本质量和风险审计。"],
        ["恢复动作", "回到 Segment 定义，重写触发句或补充必须观察的动作。"],
      ],
      log: "S18 result=invalid reason=insufficient_observable_action",
      chips: ["auditable", "denominator safe", "judge guard"],
      figure: ["SEG", "JUDGE", "?", "AUDIT"],
    },
  };
  const dashboardTabs = {
    overview: ["OVERVIEW", "先看覆盖率、总通过率和风险约束数量，再决定从哪里追证据。", "外部切换会同步驱动真实产品 iframe：不是讲解胶囊，而是报告定位器。"],
    heatmap: ["COVERAGE HEATMAP", "把原始指令中的约束映射到测试覆盖与通过率，先找没有被充分验证的区域。", "适合回答：哪些需求被测到了，哪些只是看起来完整。"],
    detail: ["CONSTRAINT DETAIL", "逐约束查看测试次数、通过、失败、无效和达标状态，风险项可以被过滤出来。", "适合回答：每条约束到底失败在哪一类样本上。"],
    evidence: ["EVIDENCE EXPAND", "展开风险约束的原始 Segment、评判依据和对话片段，回到可审计证据。", "适合回答：报告数字背后是哪一句对话导致的判定。"],
  };
  const labCycleKeys = Object.keys(labCases);
  let labCycleTimer = null;
  let labResumeTimer = null;
  let labCurrentIndex = 0;

  function activeLabSlide() {
    return $(".deck > .lab-slide.is-active");
  }

  function clearLabCycle() {
    clearInterval(labCycleTimer);
    labCycleTimer = null;
  }

  function startLabCycle() {
    clearLabCycle();
    if (!activeLabSlide()) return;
    labCycleTimer = setInterval(() => {
      if (!activeLabSlide()) {
        clearLabCycle();
        return;
      }
      labCurrentIndex = (labCurrentIndex + 1) % labCycleKeys.length;
      renderLab(labCycleKeys[labCurrentIndex]);
    }, 1500);
  }

  function pauseLabCycle() {
    clearLabCycle();
    clearTimeout(labResumeTimer);
    labResumeTimer = setTimeout(startLabCycle, 30000);
  }

  function selectLab(key, options = {}) {
    const index = labCycleKeys.indexOf(key);
    labCurrentIndex = index >= 0 ? index : 0;
    renderLab(labCycleKeys[labCurrentIndex]);
    if (options.manual) pauseLabCycle();
  }

  function renderLab(key) {
    const item = labCases[key] || labCases.code;
    const activeSlide = $(".deck > .slide.is-active") || document;
    const stage = $("#labStage", activeSlide) || $("#labStage");
    if (!stage) return;
    stage.innerHTML = `<div class="lab-content">
      <div class="lab-visual">
        <div class="lab-banner"><span>CASE</span><b>${item.title}</b><p>${item.subtitle}</p></div>
        <div class="lab-figure">
          ${item.figure.map((label, index) => `<div class="figure-cell ${index === 1 ? "warn" : index >= 2 ? "ok" : ""}"><strong>${label}</strong><i></i></div>`).join("<em>+</em>")}
        </div>
        <div class="lab-process">
          ${item.pipeline.map((label, index) => `${index ? "<i>→</i>" : ""}<div class="lab-node ${index === 1 ? "blocked" : index >= 2 ? "good" : ""}"><b>${label}</b><p>${index === 0 ? "进入检查" : index === 1 ? "记录原因" : index === 2 ? "隔离口径" : "恢复路径"}</p></div>`).join("")}
        </div>
        <div class="lab-ledger">
          ${item.rows.map(([label, value]) => `<div><b>${label}</b><p>${value}</p></div>`).join("")}
        </div>
        <code class="lab-log">${item.log}</code>
        <div class="lab-chip-row">${item.chips.map((chip) => `<span>${chip}</span>`).join("")}</div>
      </div>
      <aside class="lab-copy">
        <p class="eyebrow">FAILURE CONTRACT</p>
        <h3>${item.claim}</h3>
        <div class="lab-rule"><b>可见性</b><span>状态、原因、归属对象都在界面中出现。</span></div>
        <div class="lab-rule"><b>可恢复</b><span>每类异常都有下一步动作，而不是只报错。</span></div>
        <div class="lab-rule"><b>不污染</b><span>无效、异常、降级样本不会混入核心指标。</span></div>
        <div class="lab-mini-metrics"><div><strong>0</strong><span>伪造补齐</span></div><div><strong>4</strong><span>记录字段</span></div><div><strong>1</strong><span>恢复出口</span></div></div>
      </aside>
    </div>`;
    $$("#labNav button", activeSlide).forEach((button) => button.classList.toggle("active", button.dataset.lab === key));
  }

  function selectDashboardTab(key) {
    const activeSlide = $(".deck > .dashboard-slide.is-active") || $(".dashboard-slide");
    if (!activeSlide) return;
    const item = dashboardTabs[key] || dashboardTabs.overview;
    $$(".dashboard-tabs button", activeSlide).forEach((button) => {
      button.classList.toggle("active", button.dataset.dashboardTab === key);
    });
    const insight = $("#dashboardInsight", activeSlide);
    if (insight) {
      insight.innerHTML = `<span>${item[0]}</span><b>${item[1]}</b><p>${item[2]}</p>`;
    }
    const iframe = $(".dashboard-frame iframe", activeSlide);
    try {
      if (typeof iframe?.contentWindow?.focusReportTab === "function") {
        iframe.contentWindow.focusReportTab(key);
      }
    } catch (error) {
      // postMessage below is the cross-frame fallback.
    }
    iframe?.contentWindow?.postMessage({ type: "product-report-tab", tab: key }, "*");
  }

  function openNote(key) {
    const item = notes[key];
    if (!item) return;
    $("#noteIndex").textContent = item[0];
    $("#noteTitle").textContent = item[1];
    $("#noteBody").textContent = item[2];
    $("#notePopover").classList.add("open");
    $("#noteBackdrop").classList.add("open");
  }

  function closeNote() {
    $("#notePopover").classList.remove("open");
    $("#noteBackdrop").classList.remove("open");
  }

  function fitProductFrame(frame) {
    const iframe = frame.querySelector("iframe");
    if (!iframe) return;
    const designWidth = Number(frame.dataset.designWidth) || 1440;
    const designHeight = Number(frame.dataset.designHeight) || 720;
    const scale = Math.min(frame.clientWidth / designWidth, frame.clientHeight / designHeight);
    iframe.style.width = `${designWidth}px`;
    iframe.style.height = `${designHeight}px`;
    iframe.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  function fitAllProductFrames() {
    $$("[data-product-viewport]").forEach(fitProductFrame);
  }

  async function loadStats() {
    try {
      await DemoAPI.initialize();
      const report = await DemoAPI.getReport();
      $('[data-stat="groups"]').textContent = report.conversation_groups.length;
      $('[data-stat="segments"]').textContent = report.overall_score.total_segments;
      $('[data-stat="evaluations"]').textContent = report.overall_score.total_evaluations;
      const weak = [...report.overall_score.constraint_eval_summaries].sort((a, b) => a.pass_rate - b.pass_rate)[0];
      if (weak && $('[data-closing="suggestion"]')) {
        $('[data-closing="suggestion"]').textContent = weak.constraint_text.includes("挂断")
          ? "明确：再次坚持无法配送时，停止挽留，安慰并主动结束通话"
          : "明确触发条件、必做动作与完成标准";
      }
    } catch (error) {
      console.error(error);
    }
  }

  document.addEventListener("click", (event) => {
    const goto = event.target.closest("[data-goto]");
    if (goto) location.hash = `#/${goto.dataset.goto}`;
    const note = event.target.closest("[data-note]");
    if (note) openNote(note.dataset.note);
    if (event.target.closest("[data-close-note]")) closeNote();
    const lab = event.target.closest("[data-lab]");
    if (lab) selectLab(lab.dataset.lab, { manual: true });
    const dashboardTab = event.target.closest("[data-dashboard-tab]");
    if (dashboardTab) selectDashboardTab(dashboardTab.dataset.dashboardTab);
  });

  document.addEventListener("DOMContentLoaded", () => {
    loadStats();
    selectLab("code");
    selectDashboardTab("overview");
    fitAllProductFrames();
    const observer = new ResizeObserver((entries) => entries.forEach((entry) => fitProductFrame(entry.target)));
    $$("[data-product-viewport]").forEach((frame) => observer.observe(frame));
    const labSlide = $(".lab-slide");
    if (labSlide) {
      const labObserver = new MutationObserver(() => {
        if (activeLabSlide()) startLabCycle();
        else clearLabCycle();
      });
      labObserver.observe(labSlide, { attributes: true, attributeFilter: ["class"] });
      setTimeout(() => {
        if (activeLabSlide()) startLabCycle();
      }, 250);
    }
  });

  window.addEventListener("resize", fitAllProductFrames);
})();
