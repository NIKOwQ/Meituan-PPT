(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  let applied = false;

  function reportTarget(tab) {
    if (tab === "heatmap") return document.querySelector(".report-heatmap");
    if (tab === "detail") return document.querySelector(".report-table-card");
    if (tab === "evidence") return document.querySelector(".report-table-card");
    return document.querySelector(".report-page");
  }

  async function focusReportTab(tab = "overview") {
    if (shell?.dataset.mode !== "report") {
      await applyView("report");
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    document.documentElement.dataset.presentationReportTab = tab;
    const target = reportTarget(tab);
    if (tab === "detail" || tab === "evidence") {
      const filter = document.querySelector(`[data-report-filter="${tab === "evidence" ? "risk" : "all"}"]`);
      filter?.click();
    }
    if (tab === "evidence") {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const firstExpand = document.querySelector(".report-expand");
      const rowId = firstExpand?.dataset.reportRow;
      const row = rowId ? document.querySelector(`#report-row-${rowId}`) : null;
      if (firstExpand && row && !row.classList.contains("open")) firstExpand.click();
    } else {
      document.querySelectorAll(".report-row-detail.open").forEach((row) => row.classList.remove("open"));
    }
    target?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
  }
  window.focusReportTab = focusReportTab;

  async function applyView(view, options = {}) {
    if (!window.DemoAPI || typeof enterSetup !== "function") return false;
    if (!instructionSelect?.options?.length) return false;

    if (view === "setup") {
      if (typeof stopWorkspaceReplay === "function") stopWorkspaceReplay({ restore: true });
      enterSetup();
    } else if (view === "workspace") {
      await loadReport("rider-report.json", { silent: true });
      enterWorkspace({ immediate: true });
      if (typeof startWorkspaceReportReplay === "function") startWorkspaceReportReplay();
    } else if (view === "report") {
      if (typeof stopWorkspaceReplay === "function") stopWorkspaceReplay({ restore: true });
      await loadReport("rider-report.json", { silent: true });
      // loadReport preserves the real frontend's workspace transition. Wait for
      // that transition to settle before switching the presentation to report.
      await new Promise((resolve) => setTimeout(resolve, 320));
      renderReportDashboard(state.report);
      enterReport();
    } else if (view === "run") {
      enterWorkspace({ immediate: true });
      if (!state.instructionName && instructionSelect.options[1]) {
        await loadInstruction(instructionSelect.options[1].value, { silent: true });
      }
      if (options.restart !== false) await startRun();
    } else if (view === "evidence") {
      await loadReport("rider-report.json", { silent: true });
      enterWorkspace({ immediate: true });
      openInspector("evidence");
    } else if (view === "trace") {
      await loadReport("rider-report.json", { silent: true });
      enterWorkspace({ immediate: true });
      const key = Object.keys(state.evidence)[0] || "c0";
      openInspector("trace", key);
    }
    document.documentElement.dataset.presentationView = view;
    return true;
  }

  async function initializeFromQuery() {
    if (applied) return;
    const view = params.get("view") || "setup";
    if (await applyView(view)) {
      applied = true;
      parent.postMessage({ type: "product-ready", view }, "*");
    }
  }

  const timer = setInterval(async () => {
    await initializeFromQuery();
    if (applied) clearInterval(timer);
  }, 120);

  window.addEventListener("message", async (event) => {
    const message = event.data || {};
    if (message.type === "product-view") {
      await applyView(message.view, message.options || {});
    } else if (message.type === "product-report-tab") {
      await focusReportTab(message.tab);
    }
  });
})();
