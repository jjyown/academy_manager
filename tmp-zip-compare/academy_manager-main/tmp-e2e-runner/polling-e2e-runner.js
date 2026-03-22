const { chromium } = require('playwright');

const TARGET_URL = 'http://127.0.0.1:8000/grading/';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

  const initial = await page.evaluate(() => {
    const container = document.getElementById('grading-progress-container');
    if (!container) return { ok: false, reason: 'missing_progress_container' };
    if (typeof pollGradingProgress !== 'function') return { ok: false, reason: 'missing_pollGradingProgress' };
    if (typeof _pollDetailResult !== 'function') return { ok: false, reason: 'missing_pollDetailResult' };
    if (typeof showToast !== 'function') return { ok: false, reason: 'missing_showToast' };
    return { ok: true };
  });
  if (!initial.ok) {
    await browser.close();
    throw new Error(initial.reason);
  }

  const metrics = await page.evaluate(async () => {
    window.__e2eMetrics = {
      progress: { calls: 0, failures: 0, warnings: 0 },
      detail: {
        calls: 0,
        failures: 0,
        warnings: 0,
        completeToasts: 0,
        warningWhenOnlyResultsFail: null,
        warningWhenBothFail: null,
        duplicateCompletionToastsForSameResult: null,
      },
      longRun: { calls: 0, warningsAfterRecovery: 0 },
      fullRegrade: {
        startProgressPollingCalls: 0,
        loadResultsCalls: 0,
        openDetailCalls: 0,
        kickoffToastCount: 0,
        progressCompletionReloads: 0,
      },
      toasts: [],
    };

    const originalToast = window.showToast;
    window.showToast = function wrappedToast(message, type = 'info', duration = 2600) {
      window.__e2eMetrics.toasts.push({ message, type, at: Date.now() });
      if (message === '진행률 서버 응답이 지연되고 있습니다. 자동 재시도 중입니다.' && type === 'warning') {
        window.__e2eMetrics.progress.warnings += 1;
      }
      if (message === '상세 상태 갱신이 지연되고 있습니다. 잠시 후 자동 복구됩니다.' && type === 'warning') {
        window.__e2eMetrics.detail.warnings += 1;
      }
      if (message === '채점이 완료되었습니다' && type === 'success') {
        window.__e2eMetrics.detail.completeToasts += 1;
      }
      if (message === '전체 재채점이 시작되었습니다. 잠시 후 자동으로 갱신됩니다.' && type === 'success') {
        window.__e2eMetrics.fullRegrade.kickoffToastCount += 1;
      }
      return originalToast(message, type, duration);
    };

    currentTeacher = { owner_user_id: 'e2e-teacher' };
    _progressPollFailCount = 0;

    let progressCall = 0;
    const originalFetch = _pollingFetchJson;
    _pollingFetchJson = async (url) => {
      if (String(url).includes('/api/grading-progress')) {
        progressCall += 1;
        window.__e2eMetrics.progress.calls += 1;
        if (progressCall <= 3) {
          window.__e2eMetrics.progress.failures += 1;
          throw new Error('simulated progress failure');
        }
        return { data: [] };
      }
      return originalFetch(url);
    };
    for (let i = 0; i < 12; i += 1) {
      await pollGradingProgress();
    }

    currentTeacher = { owner_user_id: 'e2e-teacher' };
    currentResultId = 999001;
    currentResults = [{ id: 999001, status: 'grading' }];
    _detailPollFailCount = 0;
    window.__detailStopped = false;
    _stopDetailPoll = () => {
      window.__detailStopped = true;
    };
    openDetail = async () => {};

    let resultCall = 0;
    _pollingFetchJson = async (url) => {
      const s = String(url);
      if (s.includes('/api/grading-progress')) {
        window.__e2eMetrics.detail.calls += 1;
        return { data: [{ result_id: 999001, percent: 87, stage: 'grading' }] };
      }
      if (s.includes('/api/results?')) {
        window.__e2eMetrics.detail.calls += 1;
        resultCall += 1;
        if (resultCall <= 4) {
          window.__e2eMetrics.detail.failures += 1;
          throw new Error('simulated detail failure');
        }
        return { data: [{ id: 999001, status: 'confirmed' }] };
      }
      return { data: [] };
    };
    for (let i = 0; i < 10; i += 1) {
      await _pollDetailResult();
      if (window.__detailStopped) break;
    }
    window.__e2eMetrics.detail.warningWhenOnlyResultsFail = window.__e2eMetrics.detail.warnings;

    // Detail polling 2-B: both progress/results fail together, then recover.
    currentTeacher = { owner_user_id: 'e2e-teacher' };
    currentResultId = 999002;
    currentResults = [{ id: 999002, status: 'grading' }];
    _detailPollFailCount = 0;
    window.__detailStopped = false;
    let bothCall = 0;
    _pollingFetchJson = async (url) => {
      const s = String(url);
      if (s.includes('/api/grading-progress') || s.includes('/api/results?')) {
        window.__e2eMetrics.detail.calls += 1;
        bothCall += 1;
        if (bothCall <= 4) {
          window.__e2eMetrics.detail.failures += 1;
          throw new Error('simulated dual failure');
        }
        if (s.includes('/api/results?')) {
          return { data: [{ id: 999002, status: 'confirmed' }] };
        }
        return { data: [{ result_id: 999002, percent: 92, stage: 'grading' }] };
      }
      return { data: [] };
    };
    const warningBeforeDual = window.__e2eMetrics.detail.warnings;
    for (let i = 0; i < 10; i += 1) {
      await _pollDetailResult();
      if (window.__detailStopped) break;
    }
    window.__e2eMetrics.detail.warningWhenBothFail =
      window.__e2eMetrics.detail.warnings - warningBeforeDual;

    // Detail polling 2-C: duplicate completion toast guard for same result.
    currentTeacher = { owner_user_id: 'e2e-teacher' };
    currentResultId = 999003;
    currentResults = [{ id: 999003, status: 'grading' }];
    _detailPollFailCount = 0;
    _detailCompletionHandledResultId = null;
    _detailCompletionProcessing = false;
    window.__detailStopped = false;
    _stopDetailPoll = () => {
      window.__detailStopped = true;
    };
    openDetail = async () => {};
    _pollingFetchJson = async (url) => {
      const s = String(url);
      if (s.includes('/api/grading-progress')) {
        return { data: [{ result_id: 999003, percent: 100, stage: 'done' }] };
      }
      if (s.includes('/api/results?')) {
        return { data: [{ id: 999003, status: 'confirmed' }] };
      }
      return { data: [] };
    };
    const completionBeforeDup = window.__e2eMetrics.detail.completeToasts;
    for (let i = 0; i < 5; i += 1) {
      await _pollDetailResult();
    }
    window.__e2eMetrics.detail.duplicateCompletionToastsForSameResult =
      window.__e2eMetrics.detail.completeToasts - completionBeforeDup;

    // Scenario 3-A: full regrade kickoff flow (regradeWithKey -> full_regrade branch)
    currentResultId = 555001;
    currentTeacher = { owner_user_id: 'e2e-teacher' };
    currentResults = [{ id: 555001, answer_key_id: 11, status: 'review_needed', students: { name: 'E2E' } }];
    const keySelect = document.getElementById('detail-key-select');
    const regradeBtn = document.getElementById('detail-regrade-btn');
    if (!keySelect || !regradeBtn) throw new Error('missing_regrade_controls');
    keySelect.innerHTML = '<option value="11">key11</option>';
    keySelect.value = '11';

    const originalConfirm = window.confirm;
    const originalStartProgressPolling = startProgressPolling;
    const originalLoadResults = loadResults;
    const originalOpenDetail = openDetail;
    const originalFetchNative = window.fetch;

    window.confirm = () => true;
    startProgressPolling = () => {
      window.__e2eMetrics.fullRegrade.startProgressPollingCalls += 1;
    };
    loadResults = async () => {
      window.__e2eMetrics.fullRegrade.loadResultsCalls += 1;
      return [];
    };
    openDetail = async () => {
      window.__e2eMetrics.fullRegrade.openDetailCalls += 1;
    };
    window.fetch = async (url, opts = {}) => {
      const s = String(url);
      if (s.includes(`/api/results/${currentResultId}/regrade`) && (opts.method || 'GET') === 'POST') {
        return new Response(JSON.stringify({ full_regrade: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetchNative(url, opts);
    };

    await regradeWithKey();

    window.confirm = originalConfirm;
    startProgressPolling = originalStartProgressPolling;
    openDetail = originalOpenDetail;
    window.fetch = originalFetchNative;

    // Scenario 3-B: progress polling completion reflection (active -> empty should reload once)
    const progressContainer = document.getElementById('grading-progress-container');
    progressContainer.style.display = 'block';
    progressContainer.innerHTML = '<div>busy</div>';
    progressContainer._hadActive = true;
    currentTeacher = { owner_user_id: 'e2e-teacher' };
    let progressTick = 0;
    _pollingFetchJson = async (url) => {
      if (String(url).includes('/api/grading-progress')) {
        progressTick += 1;
        if (progressTick === 1) {
          return { data: [{ stage: 'grading', percent: 55, detail: 'processing' }] };
        }
        return { data: [] };
      }
      return { data: [] };
    };
    loadResults = async () => {
      window.__e2eMetrics.fullRegrade.progressCompletionReloads += 1;
      return [];
    };
    await pollGradingProgress();
    await pollGradingProgress();
    loadResults = originalLoadResults;

    currentTeacher = { owner_user_id: 'e2e-teacher' };
    _progressPollFailCount = 0;
    let longCall = 0;
    _pollingFetchJson = async (url) => {
      if (String(url).includes('/api/grading-progress')) {
        longCall += 1;
        window.__e2eMetrics.longRun.calls += 1;
        if (longCall % 25 === 0) {
          throw new Error('intermittent network blip');
        }
        return { data: [] };
      }
      return { data: [] };
    };
    const warningsBefore = window.__e2eMetrics.progress.warnings;
    for (let i = 0; i < 180; i += 1) {
      await pollGradingProgress();
    }
    window.__e2eMetrics.longRun.warningsAfterRecovery = window.__e2eMetrics.progress.warnings - warningsBefore;

    return window.__e2eMetrics;
  });

  await browser.close();

  const checks = {
    progress_warning_once: metrics.progress.warnings === 1,
    detail_warning_on_results_only: metrics.detail.warningWhenOnlyResultsFail === 1,
    detail_completion_toast: metrics.detail.completeToasts >= 1,
    detail_completion_toast_no_duplicate_same_result:
      metrics.detail.duplicateCompletionToastsForSameResult === 1,
    full_regrade_kickoff_toast: metrics.fullRegrade.kickoffToastCount === 1,
    full_regrade_started_progress_polling: metrics.fullRegrade.startProgressPollingCalls === 1,
    full_regrade_refreshed_detail_once:
      metrics.fullRegrade.loadResultsCalls === 1 && metrics.fullRegrade.openDetailCalls === 1,
    full_regrade_progress_completion_reflects_results:
      metrics.fullRegrade.progressCompletionReloads >= 1,
    no_warning_spam_after_recovery: metrics.longRun.warningsAfterRecovery === 0,
    no_console_errors: consoleErrors.length === 0,
  };

  const passed = Object.values(checks).every(Boolean);
  const result = {
    status: passed ? 'PASS' : 'FAIL',
    checks,
    metrics,
    consoleErrors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!passed) process.exit(1);
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
