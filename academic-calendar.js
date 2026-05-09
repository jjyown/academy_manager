'use strict';
// ============================================================
// 학사일정 모듈 — NEIS Open API (open.neis.go.kr) 연동.
//   - 학교명 검색 → schoolInfo (시도교육청·표준학교코드 획득)
//   - 학사일정 조회 → SchoolSchedule (월 단위, AA_FROM_YMD/AA_TO_YMD)
//   - 구독 학교 localStorage 보관 (academic_calendar_schools)
//   - 월별 응답 24h TTL 캐시 (academic_calendar_cache_*)
//   - 메인 캘린더 셀에 학교별 색상 점 + 툴팁 / 시간표 모달 상단에
//     해당 날짜 학사일정 chip 표시
// ============================================================

(function () {
    const NEIS_API_KEY = '09f0403872974093b3061fb1d669fc7f';
    const NEIS_BASE = 'https://open.neis.go.kr/hub';

    const LS_SCHOOLS = 'academic_calendar_schools';
    const LS_CACHE_PREFIX = 'academic_calendar_cache_';
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

    const PALETTE = [
        { bg: '#dcfce7', fg: '#166534', dot: '#16a34a' }, // green
        { bg: '#dbeafe', fg: '#1e40af', dot: '#2563eb' }, // blue
        { bg: '#fef3c7', fg: '#92400e', dot: '#d97706' }, // amber
        { bg: '#fce7f3', fg: '#9f1239', dot: '#db2777' }, // pink
        { bg: '#e0e7ff', fg: '#3730a3', dot: '#4f46e5' }, // indigo
        { bg: '#cffafe', fg: '#155e75', dot: '#0891b2' }, // cyan
    ];

    // ── 구독 학교 저장/조회 ─────────────────────────────────────
    function getSubscribedSchools() {
        try {
            const list = JSON.parse(localStorage.getItem(LS_SCHOOLS) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }
    function _setSubscribedSchools(list) {
        try { localStorage.setItem(LS_SCHOOLS, JSON.stringify(list || [])); }
        catch (e) { console.warn('[Academic] save schools failed:', e); }
    }
    function _schoolColor(school) {
        const idx = (school && typeof school._colorIdx === 'number')
            ? school._colorIdx
            : 0;
        return PALETTE[idx % PALETTE.length];
    }
    function _findSchoolIdx(list, atpt, code) {
        for (let i = 0; i < list.length; i++) {
            if (list[i].atpt === atpt && list[i].code === code) return i;
        }
        return -1;
    }
    function subscribeSchool(school) {
        if (!school || !school.atpt || !school.code) return false;
        const list = getSubscribedSchools();
        if (_findSchoolIdx(list, school.atpt, school.code) >= 0) return false;
        const colorIdx = list.length % PALETTE.length;
        list.push({
            atpt: school.atpt,
            code: school.code,
            name: school.name,
            region: school.region || '',
            type: school.type || '',
            _colorIdx: colorIdx,
        });
        _setSubscribedSchools(list);
        return true;
    }
    function unsubscribeSchool(atpt, code) {
        const list = getSubscribedSchools();
        const idx = _findSchoolIdx(list, atpt, code);
        if (idx < 0) return false;
        list.splice(idx, 1);
        _setSubscribedSchools(list);
        // 해당 학교 캐시도 정리
        Object.keys(localStorage).forEach((k) => {
            if (k.startsWith(`${LS_CACHE_PREFIX}${atpt}_${code}_`)) {
                try { localStorage.removeItem(k); } catch (e) {}
            }
        });
        return true;
    }
    function invalidateAcademicCache() {
        Object.keys(localStorage).forEach((k) => {
            if (k.startsWith(LS_CACHE_PREFIX)) {
                try { localStorage.removeItem(k); } catch (e) {}
            }
        });
    }

    // ── NEIS API 호출 ────────────────────────────────────────────
    async function searchSchoolsNeis(query) {
        const q = String(query || '').trim();
        if (!q) return [];
        const url = `${NEIS_BASE}/schoolInfo?KEY=${NEIS_API_KEY}&Type=json&pSize=100&SCHUL_NM=${encodeURIComponent(q)}`;
        let res, data;
        try {
            res = await fetch(url);
            data = await res.json();
        } catch (e) {
            throw new Error('학교 검색 네트워크 오류: ' + (e.message || ''));
        }
        // INFO-200 = 데이터 없음
        if (data.RESULT && data.RESULT.CODE === 'INFO-200') return [];
        if (data.RESULT && data.RESULT.CODE && data.RESULT.CODE !== 'INFO-000') {
            throw new Error(`NEIS API 오류: ${data.RESULT.MESSAGE || data.RESULT.CODE}`);
        }
        const rows = (data.schoolInfo && data.schoolInfo[1] && data.schoolInfo[1].row) || [];
        return rows.map((r) => ({
            atpt: r.ATPT_OFCDC_SC_CODE,
            code: r.SD_SCHUL_CODE,
            name: r.SCHUL_NM,
            region: r.LCTN_SC_NM || '',
            type: r.SCHUL_KND_SC_NM || '',
            address: r.ORG_RDNMA || '',
            ATPT_OFCDC_SC_NM: r.ATPT_OFCDC_SC_NM || '',
        }));
    }

    async function fetchSchoolScheduleForMonth(atpt, code, yyyymm) {
        const fromYmd = `${yyyymm}01`;
        const year = parseInt(yyyymm.slice(0, 4), 10);
        const month = parseInt(yyyymm.slice(4, 6), 10);
        const lastDay = new Date(year, month, 0).getDate();
        const toYmd = `${yyyymm}${String(lastDay).padStart(2, '0')}`;
        const url = `${NEIS_BASE}/SchoolSchedule?KEY=${NEIS_API_KEY}&Type=json&pSize=300`
            + `&ATPT_OFCDC_SC_CODE=${atpt}&SD_SCHUL_CODE=${code}`
            + `&AA_FROM_YMD=${fromYmd}&AA_TO_YMD=${toYmd}`;
        let res, data;
        try {
            res = await fetch(url);
            data = await res.json();
        } catch (e) {
            throw new Error('학사일정 네트워크 오류: ' + (e.message || ''));
        }
        if (data.RESULT && data.RESULT.CODE === 'INFO-200') return [];
        if (data.RESULT && data.RESULT.CODE && data.RESULT.CODE !== 'INFO-000') {
            throw new Error(`NEIS API 오류: ${data.RESULT.MESSAGE || data.RESULT.CODE}`);
        }
        const rows = (data.SchoolSchedule && data.SchoolSchedule[1] && data.SchoolSchedule[1].row) || [];
        return rows.map((r) => ({
            date: String(r.AA_YMD || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
            name: String(r.EVENT_NM || '').trim(),
            content: String(r.EVENT_CNTNT || '').trim(),
        }));
    }

    // ── 캐시된 월별 학사일정 조회 ───────────────────────────────
    const _inflight = new Map(); // cacheKey -> Promise
    async function _fetchMonthCached(school, yyyymm) {
        const cacheKey = `${LS_CACHE_PREFIX}${school.atpt}_${school.code}_${yyyymm}`;
        try {
            const raw = localStorage.getItem(cacheKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.expires > Date.now() && Array.isArray(parsed.data)) {
                    return parsed.data;
                }
            }
        } catch (e) {}
        if (_inflight.has(cacheKey)) return _inflight.get(cacheKey);
        const p = (async () => {
            try {
                const events = await fetchSchoolScheduleForMonth(school.atpt, school.code, yyyymm);
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({
                        data: events, expires: Date.now() + CACHE_TTL_MS
                    }));
                } catch (e) {}
                return events;
            } catch (e) {
                console.warn(`[Academic] ${school.name} ${yyyymm} fetch 실패:`, e);
                return [];
            } finally {
                _inflight.delete(cacheKey);
            }
        })();
        _inflight.set(cacheKey, p);
        return p;
    }

    // 월별 합본 — Map<dateStr, Array<{school, event}>>
    async function getMonthlyAcademicEvents(yyyymm) {
        const schools = getSubscribedSchools();
        const dateMap = new Map();
        if (schools.length === 0) return dateMap;
        const results = await Promise.all(
            schools.map((sc) => _fetchMonthCached(sc, yyyymm))
        );
        results.forEach((events, i) => {
            const sc = schools[i];
            (events || []).forEach((ev) => {
                if (!ev.date) return;
                const arr = dateMap.get(ev.date) || [];
                arr.push({ school: sc, event: ev });
                dateMap.set(ev.date, arr);
            });
        });
        return dateMap;
    }

    async function getAcademicEventsForDate(dateStr) {
        if (!dateStr) return [];
        const yyyymm = String(dateStr).replace(/-/g, '').slice(0, 6);
        const m = await getMonthlyAcademicEvents(yyyymm);
        return m.get(dateStr) || [];
    }

    // ── 학교명 약어 (송도중학교 → 송도중) ──────────────────────
    function _abbreviateSchoolName(name, maxLen) {
        const max = maxLen || 5;
        let abbr = String(name || '')
            .replace(/등학교$/, '')   // 초등학교/고등학교 → 초/고
            .replace(/학교$/, '');     // 중학교/대학교 → 중/대
        if (abbr.length > max) abbr = abbr.slice(0, max) + '…';
        return abbr;
    }

    // ── 캘린더 셀 배지 렌더 ─────────────────────────────────────
    // 학교가 여러 개면 각 행에 [학교칩 + 이벤트명] 형식으로 분리 표시.
    // 셀 공간 제약상 최대 2학교까지 보이고 나머지는 "+N건 더" 표시.
    let _badgeRenderToken = 0;
    async function renderAcademicBadgesOnCalendar() {
        const grid = document.getElementById('calendar-grid');
        if (!grid) return;
        // 기존 배지 제거
        grid.querySelectorAll('.academic-badge-row').forEach((el) => el.remove());

        const schools = getSubscribedSchools();
        if (schools.length === 0) return;

        const cells = Array.from(grid.querySelectorAll('.grid-cell[data-date]'));
        if (cells.length === 0) return;
        const monthsToFetch = new Set();
        cells.forEach((c) => {
            const ds = c.dataset.date || '';
            if (ds.length >= 7) monthsToFetch.add(ds.slice(0, 7).replace('-', ''));
        });

        const myToken = ++_badgeRenderToken;
        const monthlyMaps = new Map();
        await Promise.all(Array.from(monthsToFetch).map(async (yyyymm) => {
            const m = await getMonthlyAcademicEvents(yyyymm);
            monthlyMaps.set(yyyymm, m);
        }));
        if (myToken !== _badgeRenderToken) return;

        const MAX_VISIBLE_SCHOOLS = 2;

        cells.forEach((cell) => {
            const ds = cell.dataset.date || '';
            if (!ds) return;
            const yyyymm = ds.slice(0, 7).replace('-', '');
            const monthMap = monthlyMaps.get(yyyymm);
            if (!monthMap) return;
            const events = monthMap.get(ds) || [];
            if (events.length === 0) return;

            // 학교별 그룹화
            const bySchool = new Map(); // key -> { school, events:[] }
            events.forEach((e) => {
                const k = `${e.school.atpt}-${e.school.code}`;
                if (!bySchool.has(k)) {
                    bySchool.set(k, { school: e.school, events: [] });
                }
                bySchool.get(k).events.push(e.event);
            });
            const groups = Array.from(bySchool.values());

            const row = document.createElement('div');
            row.className = 'academic-badge-row';

            // 툴팁 — 모든 학교/이벤트
            const tooltip = groups.map((g) =>
                `[${g.school.name}] ${g.events.map((ev) => ev.name).join(', ')}`
            ).join('\n');
            row.title = tooltip;

            // 화면에 보이는 학교 수 제한
            const visibleGroups = groups.slice(0, MAX_VISIBLE_SCHOOLS);
            const hiddenCount = groups.length - visibleGroups.length;

            visibleGroups.forEach((g) => {
                const c = _schoolColor(g.school);
                const item = document.createElement('div');
                item.className = 'academic-badge-item';

                const schoolChip = document.createElement('span');
                schoolChip.className = 'academic-badge-school';
                schoolChip.style.background = c.bg;
                schoolChip.style.color = c.fg;
                schoolChip.textContent = _abbreviateSchoolName(g.school.name, 5);
                item.appendChild(schoolChip);

                const eventText = document.createElement('span');
                eventText.className = 'academic-badge-event-text';
                eventText.style.color = c.fg;
                const firstName = g.events[0].name || '';
                eventText.textContent = g.events.length > 1
                    ? `${firstName} +${g.events.length - 1}`
                    : firstName;
                item.appendChild(eventText);

                row.appendChild(item);
            });

            if (hiddenCount > 0) {
                const more = document.createElement('div');
                more.className = 'academic-badge-more';
                more.textContent = `+ ${hiddenCount}개 학교 더`;
                row.appendChild(more);
            }

            cell.appendChild(row);
        });
    }

    // ── 시간표 모달 학사일정 섹션 ──────────────────────────────
    async function renderDayDetailAcademicSection(dateStr) {
        const summary = document.getElementById('tt-density-summary');
        const container = summary && summary.parentElement;
        if (!container) return;
        // 기존 섹션 제거
        const old = document.getElementById('tt-academic-section');
        if (old) old.remove();
        if (getSubscribedSchools().length === 0) return;

        const sec = document.createElement('div');
        sec.id = 'tt-academic-section';
        sec.className = 'tt-academic-section';
        sec.innerHTML = '<i class="fas fa-graduation-cap"></i> 학사일정 불러오는 중...';
        // tt-density-summary 다음에 삽입
        if (summary && summary.nextSibling) {
            container.insertBefore(sec, summary.nextSibling);
        } else {
            container.appendChild(sec);
        }

        try {
            const events = await getAcademicEventsForDate(dateStr);
            if (events.length === 0) {
                sec.remove();
                return;
            }
            // 학교별 그룹
            const bySchool = new Map();
            events.forEach((e) => {
                const key = `${e.school.atpt}-${e.school.code}`;
                if (!bySchool.has(key)) bySchool.set(key, { school: e.school, events: [] });
                bySchool.get(key).events.push(e.event);
            });
            const html = Array.from(bySchool.values()).map((g) => {
                const c = _schoolColor(g.school);
                const evList = g.events.map((ev) => {
                    const sub = ev.content && ev.content !== ev.name
                        ? ` <span class="tt-academic-event-content">${_escape(ev.content)}</span>`
                        : '';
                    return `<span class="tt-academic-event">${_escape(ev.name)}${sub}</span>`;
                }).join('');
                return `<div class="tt-academic-school" style="background:${c.bg};color:${c.fg};border-color:${c.dot};">
                    <span class="tt-academic-school-name">${_escape(g.school.name)}</span>
                    ${evList}
                </div>`;
            }).join('');
            sec.innerHTML = `<div class="tt-academic-title">
                <i class="fas fa-graduation-cap"></i> 학사일정
            </div><div class="tt-academic-list">${html}</div>`;
        } catch (e) {
            console.warn('[Academic] day-detail render 실패:', e);
            sec.remove();
        }
    }

    function _escape(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── 학사일정 관리 모달 ─────────────────────────────────────
    function _ensureModalElement() {
        let modal = document.getElementById('academic-calendar-modal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'academic-calendar-modal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'academic-modal-title');
        modal.innerHTML = `
            <div class="modal-card academic-modal-card">
                <div class="academic-modal-header">
                    <div class="academic-modal-title-wrap">
                        <span class="academic-modal-icon"><i class="fas fa-graduation-cap"></i></span>
                        <div>
                            <h2 id="academic-modal-title">학사일정 관리</h2>
                            <p class="academic-modal-subtitle">학원생이 다니는 학교의 시험·방학·행사를 캘린더에 함께 표시합니다.</p>
                        </div>
                    </div>
                    <button class="academic-modal-close" type="button"
                        onclick="document.getElementById('academic-calendar-modal').style.display='none'"
                        aria-label="닫기"><i class="fas fa-times" aria-hidden="true"></i></button>
                </div>
                <div class="academic-modal-body custom-scroll">
                    <section class="academic-section">
                        <div class="academic-section-title">
                            <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                            학교 검색
                        </div>
                        <div class="academic-search-row">
                            <div class="academic-search-input-wrap">
                                <i class="fas fa-search academic-search-input-icon" aria-hidden="true"></i>
                                <input type="text" id="academic-search-input" class="academic-search-input-field"
                                    placeholder="학교명을 입력해주세요 (예: 송도중학교)" autocomplete="off">
                            </div>
                            <button class="academic-search-submit-btn" type="button" id="academic-search-btn">
                                <i class="fas fa-search" aria-hidden="true"></i> 검색
                            </button>
                        </div>
                        <div id="academic-search-results" class="academic-search-results"></div>
                        <div class="academic-search-hint">전국 초·중·고등학교 검색 가능 · 학교마다 다른 색으로 캘린더에 표시됩니다</div>
                    </section>
                    <div class="academic-section-divider"></div>
                    <section class="academic-section">
                        <div class="academic-section-title">
                            <i class="fas fa-bookmark" aria-hidden="true"></i>
                            구독 중인 학교
                            <span class="academic-count" id="academic-sub-count">0</span>
                        </div>
                        <div id="academic-subscribed-list" class="academic-subscribed-list"></div>
                    </section>
                </div>
            </div>`;
        document.body.appendChild(modal);

        // 바인딩
        const inp = modal.querySelector('#academic-search-input');
        const btn = modal.querySelector('#academic-search-btn');
        const doSearch = async () => {
            const q = (inp.value || '').trim();
            const results = modal.querySelector('#academic-search-results');
            if (!q) { results.innerHTML = '<div class="academic-empty">학교명을 입력해주세요.</div>'; return; }
            results.innerHTML = '<div class="academic-empty">검색 중...</div>';
            try {
                const list = await searchSchoolsNeis(q);
                if (list.length === 0) {
                    results.innerHTML = '<div class="academic-empty">검색 결과가 없습니다.</div>';
                    return;
                }
                const subs = getSubscribedSchools();
                const subKeys = new Set(subs.map((s) => `${s.atpt}-${s.code}`));
                results.innerHTML = list.map((sc) => {
                    const key = `${sc.atpt}-${sc.code}`;
                    const subscribed = subKeys.has(key);
                    return `<div class="academic-result-item">
                        <div class="academic-result-info">
                            <div class="academic-result-name">${_escape(sc.name)}
                                ${sc.type ? `<span class="academic-result-type">${_escape(sc.type)}</span>` : ''}
                            </div>
                            <div class="academic-result-meta">${_escape(sc.region)}${sc.address ? ' · ' + _escape(sc.address) : ''}</div>
                        </div>
                        <button type="button" class="academic-action-btn ${subscribed ? 'subscribed' : ''}"
                            data-atpt="${_escape(sc.atpt)}" data-code="${_escape(sc.code)}"
                            data-name="${_escape(sc.name)}" data-region="${_escape(sc.region)}"
                            data-type="${_escape(sc.type)}">
                            ${subscribed
                                ? '<i class="fas fa-check"></i> 구독 중'
                                : '<i class="fas fa-plus"></i> 추가'}
                        </button>
                    </div>`;
                }).join('');
                results.querySelectorAll('.academic-action-btn').forEach((b) => {
                    b.addEventListener('click', async () => {
                        const atpt = b.dataset.atpt;
                        const code = b.dataset.code;
                        if (b.classList.contains('subscribed')) {
                            unsubscribeSchool(atpt, code);
                            b.classList.remove('subscribed');
                            b.innerHTML = '<i class="fas fa-plus"></i> 추가';
                        } else {
                            const ok = subscribeSchool({
                                atpt, code,
                                name: b.dataset.name, region: b.dataset.region, type: b.dataset.type,
                            });
                            if (ok) {
                                b.classList.add('subscribed');
                                b.innerHTML = '<i class="fas fa-check"></i> 구독 중';
                            }
                        }
                        _renderSubscribedList(modal);
                        if (typeof window.renderCalendar === 'function') {
                            window.renderCalendar(true);
                        }
                    });
                });
            } catch (e) {
                results.innerHTML = `<div class="academic-empty academic-empty-error">${_escape(e.message || '검색 실패')}</div>`;
            }
        };
        btn.addEventListener('click', doSearch);
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
        });
        return modal;
    }

    function _renderSubscribedList(modal) {
        modal = modal || document.getElementById('academic-calendar-modal');
        if (!modal) return;
        const listEl = modal.querySelector('#academic-subscribed-list');
        const countEl = modal.querySelector('#academic-sub-count');
        const list = getSubscribedSchools();
        if (countEl) countEl.textContent = list.length;
        if (list.length === 0) {
            listEl.innerHTML = `
                <div class="academic-empty academic-empty-friendly">
                    <i class="fas fa-school academic-empty-icon" aria-hidden="true"></i>
                    <div class="academic-empty-title">아직 구독한 학교가 없어요</div>
                    <div class="academic-empty-desc">위 검색창에 학교명을 입력해 추가하면<br>해당 학교의 학사일정이 캘린더에 자동으로 표시됩니다.</div>
                </div>`;
            return;
        }
        listEl.innerHTML = list.map((sc) => {
            const c = _schoolColor(sc);
            return `<div class="academic-subscribed-item" style="border-left-color:${c.dot};">
                <span class="academic-color-dot" style="background:${c.dot};"></span>
                <div class="academic-subscribed-info">
                    <div class="academic-subscribed-name">${_escape(sc.name)}</div>
                    <div class="academic-subscribed-meta">${_escape(sc.region)}${sc.type ? ' · ' + _escape(sc.type) : ''}</div>
                </div>
                <button type="button" class="academic-remove-btn"
                    data-atpt="${_escape(sc.atpt)}" data-code="${_escape(sc.code)}">
                    <i class="fas fa-times"></i>
                </button>
            </div>`;
        }).join('');
        listEl.querySelectorAll('.academic-remove-btn').forEach((b) => {
            b.addEventListener('click', () => {
                unsubscribeSchool(b.dataset.atpt, b.dataset.code);
                _renderSubscribedList(modal);
                if (typeof window.renderCalendar === 'function') {
                    window.renderCalendar(true);
                }
            });
        });
    }

    function openAcademicCalendarModal() {
        const modal = _ensureModalElement();
        modal.style.display = 'flex';
        _renderSubscribedList(modal);
        const inp = modal.querySelector('#academic-search-input');
        if (inp) {
            inp.value = '';
            setTimeout(() => inp.focus(), 50);
        }
        const results = modal.querySelector('#academic-search-results');
        if (results) results.innerHTML = '';
    }

    // ── 외부 노출 ───────────────────────────────────────────────
    window.openAcademicCalendarModal = openAcademicCalendarModal;
    window.renderAcademicBadgesOnCalendar = renderAcademicBadgesOnCalendar;
    window.renderDayDetailAcademicSection = renderDayDetailAcademicSection;
    window.getMonthlyAcademicEvents = getMonthlyAcademicEvents;
    window.getAcademicEventsForDate = getAcademicEventsForDate;
    window.getSubscribedAcademicSchools = getSubscribedSchools;
    window.invalidateAcademicCache = invalidateAcademicCache;
})();
