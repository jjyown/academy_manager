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
    const LS_OVERRIDE_CACHE_PREFIX = 'academic_override_cache_';
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
    // override 캐시 TTL 은 짧게 — 원장이 조사 직후 화면 갱신이 빠르게 보여야 함.
    const OVERRIDE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

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
            if (k.startsWith(LS_CACHE_PREFIX) || k.startsWith(LS_OVERRIDE_CACHE_PREFIX)) {
                try { localStorage.removeItem(k); } catch (e) {}
            }
        });
    }
    function invalidateAcademicOverrideCacheForSchool(atpt, code) {
        const prefix = `${LS_OVERRIDE_CACHE_PREFIX}${atpt}_${code}_`;
        Object.keys(localStorage).forEach((k) => {
            if (k.startsWith(prefix)) {
                try { localStorage.removeItem(k); } catch (e) {}
            }
        });
    }

    // ── 핀 학사일정 (사용자가 직접 고른 일정만 사이드바에 노출) ──
    const LS_PINNED = 'academic_pinned_events';
    function _pinKey(p) {
        return `${p.schoolAtpt}|${p.schoolCode}|${p.dateStr}|${p.eventName}`;
    }
    function getPinnedEvents() {
        try {
            const raw = JSON.parse(localStorage.getItem(LS_PINNED) || '[]');
            return Array.isArray(raw) ? raw : [];
        } catch (e) { return []; }
    }
    function _setPinnedEvents(list) {
        try { localStorage.setItem(LS_PINNED, JSON.stringify(list || [])); }
        catch (e) { console.warn('[Academic] pin save failed:', e); }
    }
    function isEventPinned(school, dateStr, eventName) {
        if (!school || !dateStr || !eventName) return false;
        const target = `${school.atpt}|${school.code}|${dateStr}|${eventName}`;
        return getPinnedEvents().some((p) => _pinKey(p) === target);
    }
    function pinEvent(school, dateStr, evt) {
        if (!school || !dateStr || !evt || !evt.name) return false;
        const item = {
            schoolAtpt: school.atpt,
            schoolCode: school.code,
            schoolName: school.name,
            dateStr,
            eventName: evt.name,
            eventContent: evt.content || '',
            addedAt: Date.now(),
        };
        const list = getPinnedEvents();
        if (list.some((p) => _pinKey(p) === _pinKey(item))) return false;
        list.push(item);
        _setPinnedEvents(list);
        return true;
    }
    function unpinEvent(school, dateStr, eventName) {
        if (!school || !dateStr || !eventName) return false;
        const target = `${school.atpt}|${school.code}|${dateStr}|${eventName}`;
        const list = getPinnedEvents();
        const filtered = list.filter((p) => _pinKey(p) !== target);
        if (filtered.length === list.length) return false;
        _setPinnedEvents(filtered);
        return true;
    }
    function togglePinEventInternal(school, dateStr, evt) {
        if (isEventPinned(school, dateStr, evt.name)) {
            unpinEvent(school, dateStr, evt.name);
            return false;
        }
        return pinEvent(school, dateStr, evt);
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

    // ── school_calendar_overrides (홈페이지 조사 보강분) ───────────
    // Supabase 의 공개 테이블에서 (atpt, code, yyyymm) 학사일정을 가져옴.
    // window.fetchSchoolCalendarOverrides 가 database.js 에서 노출되어 있어야 함.
    // 못 가져오면 [] 반환 — 본 모듈은 보강 데이터 없이도 정상 동작.
    const _overrideInflight = new Map();
    async function _fetchOverridesForMonth(school, yyyymm) {
        if (!school || !school.atpt || !school.code) return [];
        if (typeof window.fetchSchoolCalendarOverrides !== 'function') return [];
        const cacheKey = `${LS_OVERRIDE_CACHE_PREFIX}${school.atpt}_${school.code}_${yyyymm}`;
        try {
            const raw = localStorage.getItem(cacheKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.expires > Date.now() && Array.isArray(parsed.data)) {
                    return parsed.data;
                }
            }
        } catch (e) {}
        if (_overrideInflight.has(cacheKey)) return _overrideInflight.get(cacheKey);
        const p = (async () => {
            try {
                const list = await window.fetchSchoolCalendarOverrides(
                    school.atpt, school.code, yyyymm
                );
                const arr = Array.isArray(list) ? list : [];
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({
                        data: arr, expires: Date.now() + OVERRIDE_CACHE_TTL_MS,
                    }));
                } catch (e) {}
                return arr;
            } catch (e) {
                console.warn(`[Academic] override fetch ${school.name} ${yyyymm} 실패:`, e);
                return [];
            } finally {
                _overrideInflight.delete(cacheKey);
            }
        })();
        _overrideInflight.set(cacheKey, p);
        return p;
    }

    /** NEIS 이벤트 + override 를 (date, normalized name) 기준으로 dedupe.
     *  중복 시 NEIS 우선(공식 데이터). override 만 있는 경우 _source:'override' 표기. */
    function _normalizeEventName(s) {
        return String(s || '').replace(/\s+/g, '').toLowerCase();
    }
    function _mergeNeisWithOverrides(neisEvents, overrideEvents) {
        const seen = new Set();
        const out = [];
        (neisEvents || []).forEach((ev) => {
            const k = `${ev.date}|${_normalizeEventName(ev.name)}`;
            if (seen.has(k)) return;
            seen.add(k);
            out.push(Object.assign({}, ev, { _source: 'neis' }));
        });
        (overrideEvents || []).forEach((ev) => {
            const k = `${ev.date}|${_normalizeEventName(ev.name)}`;
            if (seen.has(k)) return;
            seen.add(k);
            out.push({
                date: ev.date,
                name: ev.name,
                content: ev.content || '',
                _source: 'override',
                _kind: ev.kind || 'event',
                _sourceUrl: ev.sourceUrl || '',
            });
        });
        return out;
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
    // NEIS 결과 + school_calendar_overrides 결과를 학교별로 dedupe-merge 후
    // 날짜별로 펼침. 각 event 는 _source 필드를 가짐('neis' | 'override').
    async function getMonthlyAcademicEvents(yyyymm) {
        const schools = getSubscribedSchools();
        const dateMap = new Map();
        if (schools.length === 0) return dateMap;
        const [neisResults, overrideResults] = await Promise.all([
            Promise.all(schools.map((sc) => _fetchMonthCached(sc, yyyymm))),
            Promise.all(schools.map((sc) => _fetchOverridesForMonth(sc, yyyymm))),
        ]);
        neisResults.forEach((neisEvents, i) => {
            const sc = schools[i];
            const merged = _mergeNeisWithOverrides(neisEvents, overrideResults[i]);
            merged.forEach((ev) => {
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

        cells.forEach((cell) => {
            const ds = cell.dataset.date || '';
            if (!ds) return;
            const yyyymm = ds.slice(0, 7).replace('-', '');
            const monthMap = monthlyMaps.get(yyyymm);
            if (!monthMap) return;
            const events = monthMap.get(ds) || [];
            // 이전 indicator/handler 정리
            const oldIndicator = cell.querySelector('.academic-cell-indicator');
            if (oldIndicator) oldIndicator.remove();
            if (events.length === 0) {
                if (cell._academicHoverCleanup) {
                    cell._academicHoverCleanup();
                    cell._academicHoverCleanup = null;
                }
                return;
            }

            // 학교별 그룹화
            const bySchool = new Map();
            events.forEach((e) => {
                const k = `${e.school.atpt}-${e.school.code}`;
                if (!bySchool.has(k)) {
                    bySchool.set(k, { school: e.school, events: [] });
                }
                bySchool.get(k).events.push(e.event);
            });
            const groups = Array.from(bySchool.values());

            // ── 우상단 컴팩트 칩 — 🎓 + 학교 색상 dot 들 + (학교>3 이면 +N)
            // 셀 공간 절약: 텍스트 없이 시각적 마커만. 상세는 hover 팝오버로.
            const indicator = document.createElement('div');
            indicator.className = 'academic-cell-indicator';
            indicator.setAttribute('aria-label',
                `학사일정 ${groups.length}개 학교 / ${events.length}건`);
            const cap = document.createElement('i');
            cap.className = 'fas fa-graduation-cap';
            cap.setAttribute('aria-hidden', 'true');
            indicator.appendChild(cap);
            const dotsWrap = document.createElement('span');
            dotsWrap.className = 'academic-cell-indicator-dots';
            const SHOW_DOTS = 3;
            groups.slice(0, SHOW_DOTS).forEach((g) => {
                const c = _schoolColor(g.school);
                const dot = document.createElement('span');
                dot.className = 'academic-cell-indicator-dot';
                dot.style.background = c.dot;
                dotsWrap.appendChild(dot);
            });
            indicator.appendChild(dotsWrap);
            if (groups.length > SHOW_DOTS) {
                const more = document.createElement('span');
                more.className = 'academic-cell-indicator-more';
                more.textContent = `+${groups.length - SHOW_DOTS}`;
                indicator.appendChild(more);
            }
            cell.appendChild(indicator);

            // ── 학교 일정 풀 팝오버 (셀 전역 hover) ──────────────
            const tooltipHtml = _buildAcademicTooltipHtml(ds, groups);
            const onCellEnter = (e) => {
                // 학생 인원 배지 위에 진입 시엔 인원 배지의 핸들러가 우선
                if (e.target && e.target.closest && e.target.closest('.summary-badge')) return;
                const tt = document.getElementById('calendar-tooltip');
                if (!tt) return;
                tt.innerHTML = tooltipHtml;
                tt.style.display = 'block';
            };
            const onCellLeave = () => {
                const tt = document.getElementById('calendar-tooltip');
                if (tt) tt.style.display = 'none';
            };
            // 학생 배지에서 마우스가 나갔지만 아직 셀 안에 있으면 학사일정 툴팁 복귀
            const studentBadge = cell.querySelector('.summary-badge.has-events');
            const onStudentBadgeLeave = () => {
                // 기존 핸들러가 hide 한 직후 우리가 다시 학사일정으로 채움
                const tt = document.getElementById('calendar-tooltip');
                if (!tt) return;
                tt.innerHTML = tooltipHtml;
                tt.style.display = 'block';
            };

            // 이전 hover 핸들러 정리 (재렌더 안전)
            if (cell._academicHoverCleanup) cell._academicHoverCleanup();

            cell.addEventListener('mouseenter', onCellEnter);
            cell.addEventListener('mouseleave', onCellLeave);
            if (studentBadge) studentBadge.addEventListener('mouseleave', onStudentBadgeLeave);

            cell._academicHoverCleanup = () => {
                cell.removeEventListener('mouseenter', onCellEnter);
                cell.removeEventListener('mouseleave', onCellLeave);
                if (studentBadge) studentBadge.removeEventListener('mouseleave', onStudentBadgeLeave);
            };
        });
    }

    /** 학사일정 풀 팝오버 HTML — 학생 인원 툴팁 시각 톤과 맞춤 */
    function _buildAcademicTooltipHtml(dateStr, groups) {
        const head = `<div style="font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
            <i class="fas fa-graduation-cap" style="font-size:11px;opacity:0.7;"></i>
            ${_escape(dateStr)} 학사일정
        </div>`;
        const body = groups.map((g) => {
            const c = _schoolColor(g.school);
            const eventsHtml = g.events.map((ev) => {
                const sub = ev.content && ev.content !== ev.name
                    ? ` <span style="opacity:0.65;font-weight:500;">· ${_escape(ev.content)}</span>`
                    : '';
                const srcBadge = ev._source === 'override'
                    ? ` <span title="학교 홈페이지 조사 결과" style="background:rgba(99,102,241,0.16);color:#4338ca;padding:0 5px;border-radius:4px;font-size:10px;font-weight:700;margin-left:2px;vertical-align:1px;">조사</span>`
                    : '';
                return `<div style="margin-top:2px;">${_escape(ev.name)}${srcBadge}${sub}</div>`;
            }).join('');
            return `<div style="margin-bottom:6px;">
                <span style="background:${c.bg};color:${c.fg};padding:2px 8px;border-radius:5px;font-weight:700;font-size:11px;display:inline-block;margin-bottom:2px;">
                    ${_escape(g.school.name)}
                </span>
                <div style="margin-left:2px;font-size:12px;line-height:1.45;">${eventsHtml}</div>
            </div>`;
        }).join('');
        return head + body;
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
            // 새 레이아웃: 학교별 박스 안에 이벤트 목록을 줄바꿈으로,
            // 각 줄에 큰 [+ 추가] / [✓ 추가됨] 버튼 우측 정렬
            const html = Array.from(bySchool.values()).map((g) => {
                const c = _schoolColor(g.school);
                const evList = g.events.map((ev) => {
                    const pinned = isEventPinned(g.school, dateStr, ev.name);
                    const sub = ev.content && ev.content !== ev.name
                        ? `<span class="tt-academic-event-content">${_escape(ev.content)}</span>`
                        : '';
                    const srcBadge = ev._source === 'override'
                        ? `<span class="tt-academic-event-source" title="학교 홈페이지 조사 결과${ev._sourceUrl ? ' · ' + _escape(ev._sourceUrl) : ''}">조사</span>`
                        : '';
                    return `<div class="tt-academic-event-row">
                        <div class="tt-academic-event-text">
                            <span class="tt-academic-event-name">${_escape(ev.name)}</span>
                            ${srcBadge}
                            ${sub}
                        </div>
                        <button class="tt-academic-pin-btn ${pinned ? 'is-pinned' : ''}"
                            type="button"
                            aria-label="${pinned ? '사이드바 핀 제거' : '사이드바에 추가'}"
                            title="${pinned ? '클릭 시 핀 제거' : '클릭 시 사이드바에 추가'}"
                            data-school-atpt="${_escape(g.school.atpt)}"
                            data-school-code="${_escape(g.school.code)}"
                            data-school-name="${_escape(g.school.name)}"
                            data-date="${_escape(dateStr)}"
                            data-event-name="${_escape(ev.name)}"
                            data-event-content="${_escape(ev.content || '')}">
                            ${pinned
                                ? '<i class="fas fa-check" aria-hidden="true"></i> 추가됨'
                                : '<i class="fas fa-plus" aria-hidden="true"></i> 추가'}
                        </button>
                    </div>`;
                }).join('');
                return `<div class="tt-academic-school" style="background:${c.bg};color:${c.fg};border-color:${c.dot};">
                    <div class="tt-academic-school-name">${_escape(g.school.name)}</div>
                    <div class="tt-academic-event-list">${evList}</div>
                </div>`;
            }).join('');
            const collapsed = _isAcademicSectionCollapsed();
            if (collapsed) sec.classList.add('is-collapsed');
            sec.innerHTML = `<div class="tt-academic-title">
                <button class="tt-academic-collapse-btn" type="button"
                    aria-label="학사일정 접기/펴기" title="접기/펴기"
                    onclick="toggleAcademicSectionCollapsed()">
                    <i class="fas fa-graduation-cap" aria-hidden="true"></i>
                    학사일정 ${dateStr}
                    <span class="tt-academic-toggle-count">(${events.length}건)</span>
                    <i class="fas fa-chevron-down tt-academic-collapse-icon" aria-hidden="true"></i>
                </button>
                <span class="tt-academic-hint">우측 [+ 추가] 버튼으로 사이드바에 핀</span>
            </div><div class="tt-academic-list">${html}</div>`;
            // 핀 버튼 이벤트 위임
            sec.querySelectorAll('.tt-academic-pin-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const school = {
                        atpt: btn.dataset.schoolAtpt,
                        code: btn.dataset.schoolCode,
                        name: btn.dataset.schoolName,
                    };
                    const dateStr = btn.dataset.date;
                    const evt = {
                        name: btn.dataset.eventName,
                        content: btn.dataset.eventContent || '',
                    };
                    const nowPinned = togglePinEventInternal(school, dateStr, evt);
                    btn.classList.toggle('is-pinned', nowPinned);
                    btn.setAttribute('aria-label', nowPinned ? '사이드바 핀 제거' : '사이드바에 추가');
                    btn.setAttribute('title', nowPinned ? '클릭 시 핀 제거' : '클릭 시 사이드바에 추가');
                    // 라벨/아이콘 즉시 갱신
                    btn.innerHTML = nowPinned
                        ? '<i class="fas fa-check" aria-hidden="true"></i> 추가됨'
                        : '<i class="fas fa-plus" aria-hidden="true"></i> 추가';
                    // 사이드바 즉시 갱신
                    if (typeof renderPinnedAcademicEventsSidebar === 'function') {
                        renderPinnedAcademicEventsSidebar();
                    }
                });
            });
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
                    <div class="academic-howto-banner">
                        <i class="fas fa-circle-info" aria-hidden="true"></i>
                        <div>
                            <strong>핀 추가 방법</strong> — 학교 추가 후
                            메인 캘린더 날짜 클릭 → <strong>시간표 모달 상단 학사일정</strong> 의
                            <span class="academic-howto-pill">+ 추가</span> 버튼으로 우측 사이드바에 핀.
                        </div>
                    </div>
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
                            <button type="button" class="academic-refresh-btn" id="academic-refresh-btn"
                                onclick="window.refreshAcademicCacheNow()"
                                title="NEIS API에서 모든 구독 학교 일정 즉시 새로고침"
                                aria-label="학사일정 즉시 새로고침">
                                <i class="fas fa-rotate" aria-hidden="true"></i>
                                <span>새로고침</span>
                            </button>
                        </div>
                        <div id="academic-subscribed-list" class="academic-subscribed-list"></div>
                        <div class="academic-cache-info">
                            <i class="fas fa-circle-info" aria-hidden="true"></i>
                            학사일정은 24시간마다 자동 갱신됩니다.
                            새 시험일정이 등록되었는데 안 보이면
                            <strong>새로고침</strong> 버튼을 눌러주세요.
                        </div>
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
            const log = _getInvestigationLogFor(sc);
            const logHtml = log
                ? `<div class="academic-subscribed-investigation" title="${_escape(log.lastSourceUrl || '')}">
                        <i class="fas fa-circle-check" aria-hidden="true"></i>
                        조사함 · ${_escape(_relativeTime(log.lastAt))} · ${log.lastTotal || 0}건
                    </div>`
                : '';
            return `<div class="academic-subscribed-item" style="border-left-color:${c.dot};">
                <span class="academic-color-dot" style="background:${c.dot};"></span>
                <div class="academic-subscribed-info">
                    <div class="academic-subscribed-name">${_escape(sc.name)}</div>
                    <div class="academic-subscribed-meta">${_escape(sc.region)}${sc.type ? ' · ' + _escape(sc.type) : ''}</div>
                    ${logHtml}
                </div>
                <div class="academic-subscribed-actions">
                    <button type="button" class="academic-investigate-btn"
                        data-atpt="${_escape(sc.atpt)}" data-code="${_escape(sc.code)}"
                        data-name="${_escape(sc.name)}" data-region="${_escape(sc.region)}"
                        title="NEIS 에 누락된 시험·방학 일정을 학교 공식 홈페이지에서 직접 조사합니다.">
                        <i class="fas fa-magnifying-glass-chart" aria-hidden="true"></i>
                        <span class="academic-investigate-btn-label">홈페이지 조사</span>
                    </button>
                    <button type="button" class="academic-upload-btn"
                        data-atpt="${_escape(sc.atpt)}" data-code="${_escape(sc.code)}"
                        data-name="${_escape(sc.name)}" data-region="${_escape(sc.region)}"
                        title="학교 홈페이지에서 다운받은 학사일정 PDF·이미지를 업로드해 직접 추출합니다.">
                        <i class="fas fa-file-arrow-up" aria-hidden="true"></i>
                        <span class="academic-upload-btn-label">파일 업로드</span>
                    </button>
                    <button type="button" class="academic-remove-btn"
                        data-atpt="${_escape(sc.atpt)}" data-code="${_escape(sc.code)}"
                        aria-label="구독 해제" title="구독 해제">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
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
        listEl.querySelectorAll('.academic-investigate-btn').forEach((b) => {
            b.addEventListener('click', () => _runInvestigateFromButton(b, modal));
        });
        listEl.querySelectorAll('.academic-upload-btn').forEach((b) => {
            b.addEventListener('click', () => _runUploadFromButton(b, modal));
        });
    }

    // ── 학교 홈페이지 조사 로그 (LS) ─────────────────────────────
    const LS_INVESTIGATION_LOG = 'academic_investigation_log';
    function _readInvestigationLog() {
        try {
            const o = JSON.parse(localStorage.getItem(LS_INVESTIGATION_LOG) || '{}');
            return (o && typeof o === 'object') ? o : {};
        } catch (e) { return {}; }
    }
    function _writeInvestigationLog(o) {
        try { localStorage.setItem(LS_INVESTIGATION_LOG, JSON.stringify(o || {})); }
        catch (e) {}
    }
    function _getInvestigationLogFor(sc) {
        const all = _readInvestigationLog();
        const k = `${sc.atpt}|${sc.code}`;
        return all[k] || null;
    }
    function _setInvestigationLogFor(sc, data) {
        const all = _readInvestigationLog();
        const k = `${sc.atpt}|${sc.code}`;
        all[k] = Object.assign({}, all[k] || {}, data || {});
        _writeInvestigationLog(all);
    }
    function _relativeTime(iso) {
        if (!iso) return '';
        const t = Date.parse(iso);
        if (!t) return '';
        const diff = Math.floor((Date.now() - t) / 1000);
        if (diff < 60) return '방금';
        if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
        if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}일 전`;
        return new Date(t).toISOString().slice(0, 10);
    }

    // ── 조사 실행 (버튼 핸들러) ──────────────────────────────────
    async function _runInvestigateFromButton(btn, modal) {
        if (typeof window.invokeInvestigateSchoolCalendar !== 'function') {
            if (typeof window.showToast === 'function') {
                window.showToast('조사 기능을 사용할 수 없습니다. database.js 가 로드되었는지 확인해주세요.', 'error');
            }
            return;
        }
        if (btn.disabled) return;
        const school = {
            atpt: btn.dataset.atpt,
            code: btn.dataset.code,
            name: btn.dataset.name,
            region: btn.dataset.region || '',
        };
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.classList.add('is-loading');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> <span class="academic-investigate-btn-label">조사 중...</span>';
        if (typeof window.showToast === 'function') {
            window.showToast(`${school.name} 홈페이지 조사 시작 (15~40초 소요)`, 'info');
        }
        try {
            const result = await window.invokeInvestigateSchoolCalendar(school);
            if (!result) {
                // showToast 는 database.js 헬퍼에서 이미 띄움
                btn.innerHTML = originalHtml;
                return;
            }
            if (!result.ok) {
                btn.innerHTML = originalHtml;
                return;
            }
            // 성공 — 로그 갱신
            _setInvestigationLogFor(school, {
                lastAt: new Date().toISOString(),
                lastTotal: result.total || 0,
                lastSourceUrl: (result.sourceUrls && result.sourceUrls[0]) || '',
                lastStrategy: result.strategy || '',
            });
            // override 캐시 무효화 → 즉시 새 데이터 로드
            invalidateAcademicOverrideCacheForSchool(school.atpt, school.code);
            if (typeof window.showToast === 'function') {
                if (result.total > 0) {
                    window.showToast(
                        `${school.name}: ${result.total}건의 학사일정 발견 (저장 완료)`, 'success'
                    );
                } else {
                    window.showToast(
                        `${school.name}: 추출 가능한 학사일정이 없었습니다. ${result.note || ''}`.trim(),
                        'warning'
                    );
                }
            }
            // 학사일정 모달 갱신
            _renderSubscribedList(modal);
            // 캘린더 / 사이드바 즉시 재렌더
            const tasks = [];
            if (typeof renderAcademicBadgesOnCalendar === 'function') {
                tasks.push(renderAcademicBadgesOnCalendar());
            }
            if (typeof _renderPinnedAcademicEventsSidebar === 'function') {
                tasks.push(_renderPinnedAcademicEventsSidebar());
            }
            await Promise.allSettled(tasks);
        } catch (e) {
            console.warn('[Academic] 홈페이지 조사 실패:', e);
            if (typeof window.showToast === 'function') {
                window.showToast(`${school.name} 조사 실패: ${e.message || ''}`, 'error');
            }
            btn.innerHTML = originalHtml;
        } finally {
            btn.disabled = false;
            btn.classList.remove('is-loading');
        }
    }

    // ── 파일 업로드 핸들러 ───────────────────────────────────────
    // 학교 홈페이지에서 다운받은 학사일정 PDF/이미지를 사용자가 직접 업로드.
    // Gemini multimodal 로 OCR·추출 → school_calendar_overrides 에 upsert.
    const UPLOAD_ACCEPT = 'application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/heic,image/heif';
    const UPLOAD_MAX_BYTES = 14 * 1024 * 1024; // 14MB (Gemini inline 20MB base64 한도 안쪽)
    async function _runUploadFromButton(btn, modal) {
        if (typeof window.invokeInvestigateSchoolCalendar !== 'function'
            || typeof window.fileToBase64ForEdge !== 'function') {
            if (typeof window.showToast === 'function') {
                window.showToast('업로드 기능을 사용할 수 없습니다. 페이지를 새로고침해주세요.', 'error');
            }
            return;
        }
        if (btn.disabled) return;
        const school = {
            atpt: btn.dataset.atpt,
            code: btn.dataset.code,
            name: btn.dataset.name,
            region: btn.dataset.region || '',
        };
        // 숨겨진 file input 생성 → 클릭 → 사용자가 선택하면 처리
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = UPLOAD_ACCEPT;
        input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = async () => {
            const file = input.files && input.files[0];
            document.body.removeChild(input);
            if (!file) return;
            if (file.size > UPLOAD_MAX_BYTES) {
                if (typeof window.showToast === 'function') {
                    window.showToast(
                        `파일 크기가 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB). 14MB 이하로 줄여주세요.`,
                        'error'
                    );
                }
                return;
            }
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.classList.add('is-loading');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> <span class="academic-upload-btn-label">분석 중...</span>';
            if (typeof window.showToast === 'function') {
                window.showToast(`${school.name}: ${file.name} 분석 시작 (10~30초)`, 'info');
            }
            try {
                const base64 = await window.fileToBase64ForEdge(file);
                const result = await window.invokeInvestigateSchoolCalendar(school, {
                    base64,
                    mimeType: file.type || 'application/octet-stream',
                    name: file.name || '',
                });
                if (!result || !result.ok) {
                    btn.innerHTML = originalHtml;
                    return;
                }
                _setInvestigationLogFor(school, {
                    lastAt: new Date().toISOString(),
                    lastTotal: result.total || 0,
                    lastSourceUrl: (result.sourceUrls && result.sourceUrls[0]) || '',
                    lastStrategy: 'uploaded_file',
                });
                invalidateAcademicOverrideCacheForSchool(school.atpt, school.code);
                if (typeof window.showToast === 'function') {
                    if (result.total > 0) {
                        window.showToast(
                            `${school.name}: ${result.total}건의 학사일정 발견 (파일에서 추출 · 저장 완료)`,
                            'success'
                        );
                    } else {
                        window.showToast(
                            `${school.name}: 파일에서 학사일정을 추출하지 못했습니다. ${result.note || ''}`.trim(),
                            'warning'
                        );
                    }
                }
                _renderSubscribedList(modal);
                const tasks = [];
                if (typeof renderAcademicBadgesOnCalendar === 'function') {
                    tasks.push(renderAcademicBadgesOnCalendar());
                }
                if (typeof _renderPinnedAcademicEventsSidebar === 'function') {
                    tasks.push(_renderPinnedAcademicEventsSidebar());
                }
                await Promise.allSettled(tasks);
            } catch (e) {
                console.warn('[Academic] 파일 업로드 분석 실패:', e);
                if (typeof window.showToast === 'function') {
                    window.showToast(`${school.name} 분석 실패: ${e.message || ''}`, 'error');
                }
                btn.innerHTML = originalHtml;
            } finally {
                btn.disabled = false;
                btn.classList.remove('is-loading');
            }
        };
        input.click();
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

    // ── 우측 사이드바: 사용자가 핀한 학사일정만 표시 ────────────
    function _formatDdayShort(daysDiff) {
        if (daysDiff === 0) return '오늘';
        if (daysDiff < 0) return `${-daysDiff}일전`;
        return `D-${daysDiff}`;
    }
    function _ddayClass(daysDiff) {
        if (daysDiff === 0) return 'is-today';
        if (daysDiff < 0) return 'is-past';
        if (daysDiff > 30) return 'is-far';
        return '';
    }
    function _shortDateLabel(dateStr) {
        const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return dateStr;
        const dayObj = new Date(+m[1], +m[2] - 1, +m[3]);
        const dows = ['일', '월', '화', '수', '목', '금', '토'];
        return { mon: parseInt(m[2], 10), day: parseInt(m[3], 10), dow: dows[dayObj.getDay()] };
    }
    function _renderPinnedAcademicEventsSidebar() {
        const sidebar = document.getElementById('upcoming-events-sidebar');
        const contentEl = document.getElementById('upcoming-events-content');
        if (!sidebar || !contentEl) return;

        const pinned = getPinnedEvents();

        // 현재 캘린더가 보고 있는 연·월 — script.js 의 currentDate 전역 활용
        const calRef = (typeof currentDate !== 'undefined' && currentDate)
            ? new Date(currentDate)
            : new Date();
        const calYear = calRef.getFullYear();
        const calMonth = calRef.getMonth() + 1; // 1-12
        const monthPrefix = `${calYear}-${String(calMonth).padStart(2, '0')}`;

        // 현재 월 + (참고용) 이외 월 카운트
        const monthPinned = pinned.filter((p) => p.dateStr && p.dateStr.startsWith(monthPrefix));
        const otherMonthCount = pinned.length - monthPinned.length;

        // 헤더 타이틀 갱신 — 현재 월 + 카운트
        const titleEl = sidebar.querySelector('.upcoming-title');
        if (titleEl) {
            titleEl.innerHTML = `<i class="fas fa-bookmark" aria-hidden="true"></i>`
                + ` ${calMonth}월 핀한 학사일정`
                + (monthPinned.length > 0 ? ` <span class="upcoming-count-badge">${monthPinned.length}</span>` : '');
        }

        if (pinned.length === 0) {
            contentEl.innerHTML = `
                <div class="upcoming-empty">
                    <i class="fas fa-bookmark" aria-hidden="true"></i>
                    <div class="upcoming-empty-title">아직 핀한 일정이 없어요</div>
                    <div class="upcoming-empty-desc">
                        캘린더 셀 클릭 → 시간표 모달 상단의<br>
                        <strong>학사일정</strong> 섹션에서 <strong>[+ 추가]</strong>
                        버튼을 누르면 여기 추가됩니다.
                    </div>
                    <div class="upcoming-empty-hint">
                        💡 학교 추가는 <strong>메뉴 → 학사일정</strong> 에서
                    </div>
                </div>`;
            return;
        }

        if (monthPinned.length === 0) {
            contentEl.innerHTML = `
                <div class="upcoming-empty">
                    <i class="fas fa-calendar-day" aria-hidden="true"></i>
                    <div class="upcoming-empty-title">${calYear}년 ${calMonth}월에 핀한 일정 없음</div>
                    <div class="upcoming-empty-desc">
                        다른 달로 이동하거나 이 달의 일정을<br>새로 핀 추가해보세요.
                    </div>
                    ${otherMonthCount > 0 ? `<div class="upcoming-empty-hint">
                        다른 달 핀 일정: <strong>${otherMonthCount}개</strong>
                    </div>` : ''}
                </div>`;
            return;
        }

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        // daysDiff 계산 (오늘 기준)
        const enriched = monthPinned.map((p) => {
            const m = String(p.dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
            const dayObj = m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
            const daysDiff = dayObj ? Math.round((dayObj - now) / (1000 * 60 * 60 * 24)) : null;
            return { ...p, daysDiff };
        });

        // 정렬: 같은 월 안에서 날짜 순 (오름차순)
        enriched.sort((a, b) => {
            const ad = a.dateStr || '';
            const bd = b.dateStr || '';
            if (ad !== bd) return ad < bd ? -1 : 1;
            return String(a.schoolName || '').localeCompare(String(b.schoolName || ''));
        });

        // 같은 월 안에서 다가오는 / 지난 그룹
        const upcoming = enriched.filter((p) => (p.daysDiff || 0) >= 0);
        const past = enriched.filter((p) => (p.daysDiff || 0) < 0);

        const renderItem = (p) => {
            const school = {
                atpt: p.schoolAtpt, code: p.schoolCode, name: p.schoolName,
                _colorIdx: (() => {
                    // 구독 학교 목록에서 colorIdx 찾기
                    const subs = getSubscribedSchools();
                    const idx = subs.findIndex((s) => s.atpt === p.schoolAtpt && s.code === p.schoolCode);
                    return idx >= 0 ? subs[idx]._colorIdx : 0;
                })(),
            };
            const c = _schoolColor(school);
            const sd = _shortDateLabel(p.dateStr);
            const dday = _formatDdayShort(p.daysDiff != null ? p.daysDiff : 0);
            const ddayCls = _ddayClass(p.daysDiff != null ? p.daysDiff : 0);
            const subtitle = p.eventContent && p.eventContent !== p.eventName
                ? `<div style="font-size:10px;color:#94a3b8;margin-top:1px;">${_escape(p.eventContent)}</div>`
                : '';
            return `<div class="upcoming-event-item" style="border-left-color:${c.dot};">
                <div class="upcoming-event-item-info"
                    onclick="(typeof window.jumpToCalendarDate === 'function') && window.jumpToCalendarDate('${_escape(p.dateStr)}')"
                    style="cursor:pointer;">
                    <div class="upcoming-event-item-school" style="color:${c.fg};">
                        ${_escape(p.schoolName)}
                    </div>
                    <div class="upcoming-event-item-name">${_escape(p.eventName)}</div>
                    ${subtitle}
                </div>
                <div class="upcoming-event-item-date">
                    <strong>${typeof sd === 'object' ? `${sd.mon}/${sd.day}` : sd}</strong>
                    ${typeof sd === 'object' ? `<div>(${sd.dow})</div>` : ''}
                    <span class="upcoming-dday ${ddayCls}">${dday}</span>
                </div>
                <button class="upcoming-event-remove" type="button"
                    aria-label="핀 제거"
                    title="핀 제거"
                    data-school-atpt="${_escape(p.schoolAtpt)}"
                    data-school-code="${_escape(p.schoolCode)}"
                    data-date="${_escape(p.dateStr)}"
                    data-event-name="${_escape(p.eventName)}">
                    <i class="fas fa-xmark" aria-hidden="true"></i>
                </button>
            </div>`;
        };

        let html = '';
        if (upcoming.length > 0) {
            html += `<div class="upcoming-section">
                <div class="upcoming-section-label">다가오는 (${upcoming.length})</div>
                ${upcoming.map(renderItem).join('')}
            </div>`;
        }
        if (past.length > 0) {
            html += `<div class="upcoming-section">
                <div class="upcoming-section-label upcoming-section-past">지난 일정 (${past.length})</div>
                ${past.map(renderItem).join('')}
            </div>`;
        }
        contentEl.innerHTML = html;

        // 핀 제거 버튼 이벤트 위임
        contentEl.querySelectorAll('.upcoming-event-remove').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const school = {
                    atpt: btn.dataset.schoolAtpt,
                    code: btn.dataset.schoolCode,
                };
                unpinEvent(school, btn.dataset.date, btn.dataset.eventName);
                _renderPinnedAcademicEventsSidebar();
                // 만약 시간표 모달이 같은 날짜로 열려있으면 핀 버튼 상태도 갱신
                const ttSec = document.getElementById('tt-academic-section');
                if (ttSec) {
                    const matchPin = ttSec.querySelector(
                        `.tt-academic-pin-btn[data-school-atpt="${btn.dataset.schoolAtpt}"]`
                        + `[data-school-code="${btn.dataset.schoolCode}"]`
                        + `[data-event-name="${btn.dataset.eventName}"]`
                    );
                    if (matchPin) matchPin.classList.remove('is-pinned');
                }
            });
        });
    }
    // 외부 alias (script.js 의 renderCalendar 끝부분에서 호출)
    function renderUpcomingAcademicEvents() { return _renderPinnedAcademicEventsSidebar(); }
    function renderPinnedAcademicEventsSidebar() { return _renderPinnedAcademicEventsSidebar(); }

    /** 사이드바 접기/펴기 + localStorage 보존 */
    window.toggleUpcomingSidebar = function () {
        const el = document.getElementById('upcoming-events-sidebar');
        if (!el) return;
        const next = !el.classList.contains('is-collapsed');
        el.classList.toggle('is-collapsed', next);
        try { localStorage.setItem('upcoming_sidebar_collapsed', next ? '1' : '0'); } catch (e) {}
    };
    // 페이지 진입 시 이전 상태 복원
    document.addEventListener('DOMContentLoaded', () => {
        const saved = (() => { try { return localStorage.getItem('upcoming_sidebar_collapsed'); } catch (e) { return null; } })();
        if (saved === '1') {
            const el = document.getElementById('upcoming-events-sidebar');
            if (el) el.classList.add('is-collapsed');
        }
    });

    // ── 학사일정 섹션 접기/펴기 (day-detail / day-settings 공통) ──
    const LS_ACADEMIC_COLLAPSED = 'academic_section_collapsed';
    function _isAcademicSectionCollapsed() {
        try { return localStorage.getItem(LS_ACADEMIC_COLLAPSED) === '1'; }
        catch (e) { return false; }
    }
    function _setAcademicSectionCollapsed(v) {
        try { localStorage.setItem(LS_ACADEMIC_COLLAPSED, v ? '1' : '0'); } catch (e) {}
    }
    window.toggleAcademicSectionCollapsed = function () {
        const next = !_isAcademicSectionCollapsed();
        _setAcademicSectionCollapsed(next);
        // 두 섹션 모두 갱신 (열려 있는 쪽만 효과)
        ['tt-academic-section', 'dset-academic-section'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('is-collapsed', next);
        });
    };

    // ── 날짜 설정 모달 (day-settings-modal) — 학사일정 + 핀 섹션 ──
    async function renderDaySettingsAcademicSection(dateStr) {
        const sec = document.getElementById('dset-academic-section');
        const listEl = document.getElementById('dset-academic-list');
        if (!sec || !listEl) return;

        if (getSubscribedSchools().length === 0) {
            sec.style.display = 'none';
            listEl.innerHTML = '';
            return;
        }
        sec.style.display = 'block';
        // 접힘 상태 적용
        if (_isAcademicSectionCollapsed()) sec.classList.add('is-collapsed');
        else sec.classList.remove('is-collapsed');
        listEl.innerHTML = '<div class="dset-academic-loading">학사일정 불러오는 중...</div>';

        try {
            const events = await getAcademicEventsForDate(dateStr);
            if (events.length === 0) {
                listEl.innerHTML = '<div class="dset-academic-empty">이 날짜에 등록된 학사일정이 없습니다.</div>';
                return;
            }
            // 학교별 그룹
            const bySchool = new Map();
            events.forEach((e) => {
                const k = `${e.school.atpt}-${e.school.code}`;
                if (!bySchool.has(k)) bySchool.set(k, { school: e.school, events: [] });
                bySchool.get(k).events.push(e.event);
            });
            const html = Array.from(bySchool.values()).map((g) => {
                const c = _schoolColor(g.school);
                const evList = g.events.map((ev) => {
                    const pinned = isEventPinned(g.school, dateStr, ev.name);
                    const sub = ev.content && ev.content !== ev.name
                        ? `<span class="tt-academic-event-content">${_escape(ev.content)}</span>`
                        : '';
                    const srcBadge = ev._source === 'override'
                        ? `<span class="tt-academic-event-source" title="학교 홈페이지 조사 결과${ev._sourceUrl ? ' · ' + _escape(ev._sourceUrl) : ''}">조사</span>`
                        : '';
                    return `<div class="tt-academic-event-row">
                        <div class="tt-academic-event-text">
                            <span class="tt-academic-event-name">${_escape(ev.name)}</span>
                            ${srcBadge}
                            ${sub}
                        </div>
                        <button class="tt-academic-pin-btn ${pinned ? 'is-pinned' : ''}"
                            type="button"
                            aria-label="${pinned ? '사이드바 핀 제거' : '사이드바에 추가'}"
                            title="${pinned ? '클릭 시 핀 제거' : '클릭 시 사이드바에 추가'}"
                            data-school-atpt="${_escape(g.school.atpt)}"
                            data-school-code="${_escape(g.school.code)}"
                            data-school-name="${_escape(g.school.name)}"
                            data-date="${_escape(dateStr)}"
                            data-event-name="${_escape(ev.name)}"
                            data-event-content="${_escape(ev.content || '')}">
                            ${pinned
                                ? '<i class="fas fa-check" aria-hidden="true"></i> 추가됨'
                                : '<i class="fas fa-plus" aria-hidden="true"></i> 추가'}
                        </button>
                    </div>`;
                }).join('');
                return `<div class="tt-academic-school" style="background:${c.bg};color:${c.fg};border-color:${c.dot};">
                    <div class="tt-academic-school-name">${_escape(g.school.name)}</div>
                    <div class="tt-academic-event-list">${evList}</div>
                </div>`;
            }).join('');
            listEl.innerHTML = html;
            // 핀 토글 위임
            listEl.querySelectorAll('.tt-academic-pin-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const school = {
                        atpt: btn.dataset.schoolAtpt,
                        code: btn.dataset.schoolCode,
                        name: btn.dataset.schoolName,
                    };
                    const evt = {
                        name: btn.dataset.eventName,
                        content: btn.dataset.eventContent || '',
                    };
                    const nowPinned = togglePinEventInternal(school, btn.dataset.date, evt);
                    btn.classList.toggle('is-pinned', nowPinned);
                    btn.setAttribute('aria-label', nowPinned ? '사이드바 핀 제거' : '사이드바에 추가');
                    btn.setAttribute('title', nowPinned ? '클릭 시 핀 제거' : '클릭 시 사이드바에 추가');
                    btn.innerHTML = nowPinned
                        ? '<i class="fas fa-check" aria-hidden="true"></i> 추가됨'
                        : '<i class="fas fa-plus" aria-hidden="true"></i> 추가';
                    if (typeof renderPinnedAcademicEventsSidebar === 'function') {
                        renderPinnedAcademicEventsSidebar();
                    }
                });
            });
        } catch (e) {
            console.warn('[Academic] day-settings 렌더 실패:', e);
            listEl.innerHTML = '<div class="dset-academic-empty">학사일정 불러오기 실패</div>';
        }
    }

    // ── 자동 학교 구독 동기화 ──────────────────────────────────
    // 활성 학생의 school 컬럼을 기준으로 구독 목록을 자동 갱신:
    //  - 학생 추가: 그 학교가 구독에 없으면 NEIS 검색 → 자동 구독
    //  - 학생 퇴원/삭제/학교변경: 해당 학교에 활성 학생 0명이면 구독 해제 + 캐시 정리
    /**
     * @param {Array<{name?:string, school?:string, status?:string}>} students
     *   현재 students 전역(또는 동등 배열). status === 'active' 만 카운트.
     *   options.silent === true 면 토스트 표시 안 함(루프 호출용).
     */
    async function syncSubscriptionsFromStudents(students, options) {
        const opts = options || {};
        const silent = !!opts.silent;
        if (!Array.isArray(students)) return { added: [], removed: [], failed: [] };

        // 활성 학생들의 학교명 집합
        const activeSchoolSet = new Set();
        students.forEach((s) => {
            const status = String(s.status || 'active').toLowerCase();
            if (status !== 'active') return;
            const sc = String(s.school || '').trim();
            if (sc) activeSchoolSet.add(sc);
        });

        const subscribed = getSubscribedSchools();
        const subscribedNameSet = new Set(subscribed.map((x) => x.name));

        const result = { added: [], removed: [], failed: [] };

        // 1) 활성 학생이 있는데 구독에 없는 학교 → NEIS 검색 후 자동 구독
        for (const schoolName of activeSchoolSet) {
            if (subscribedNameSet.has(schoolName)) continue;
            try {
                const matches = await searchSchoolsNeis(schoolName);
                // 정확 매칭 우선, 없으면 첫 번째
                const match = matches.find((m) => m.name === schoolName) || matches[0];
                if (!match) {
                    result.failed.push({ name: schoolName, reason: 'NEIS 검색 결과 없음' });
                    continue;
                }
                const ok = subscribeSchool(match);
                if (ok) result.added.push(match.name);
                else result.failed.push({ name: schoolName, reason: '이미 구독 중' });
            } catch (e) {
                console.warn('[academic sync] NEIS 검색 실패:', schoolName, e);
                result.failed.push({ name: schoolName, reason: e.message || '검색 오류' });
            }
        }

        // 2) 구독에 있지만 활성 학생이 없는 학교 → 자동 구독 해제
        for (const sub of subscribed) {
            if (activeSchoolSet.has(sub.name)) continue;
            const ok = unsubscribeSchool(sub.atpt, sub.code);
            if (ok) result.removed.push(sub.name);
        }

        if (!silent && (result.added.length || result.removed.length)) {
            const parts = [];
            if (result.added.length) parts.push(`${result.added.length}개 추가`);
            if (result.removed.length) parts.push(`${result.removed.length}개 제거`);
            if (typeof window.showToast === 'function') {
                window.showToast(`학사일정 학교 구독 자동 동기화: ${parts.join(', ')}`, 'info');
            }
            // 캘린더 배지 즉시 재렌더 (옵션)
            if (typeof window.renderCalendar === 'function') {
                try { window.renderCalendar(true); } catch (e) {}
            }
        }
        return result;
    }

    // ── 외부 노출 ───────────────────────────────────────────────
    /** 캐시 비우고 메인 캘린더·시간표·사이드바 즉시 재페치 */
    window.refreshAcademicCacheNow = async function () {
        const btn = document.getElementById('academic-refresh-btn');
        if (btn) {
            btn.disabled = true;
            btn.classList.add('is-loading');
        }
        try {
            invalidateAcademicCache();
            // 시각적 토스트
            if (typeof window.showToast === 'function') {
                window.showToast('학사일정 캐시 무효화 — 새 데이터 가져오는 중...', 'info');
            }
            // 메인 캘린더 배지 + 사이드바 즉시 재렌더 (캐시 비었으니 NEIS 재호출)
            const tasks = [];
            if (typeof renderAcademicBadgesOnCalendar === 'function') tasks.push(renderAcademicBadgesOnCalendar());
            if (typeof _renderPinnedAcademicEventsSidebar === 'function') tasks.push(_renderPinnedAcademicEventsSidebar());
            await Promise.allSettled(tasks);
            if (typeof window.showToast === 'function') {
                window.showToast('학사일정이 최신 데이터로 갱신되었습니다.', 'success');
            }
        } catch (e) {
            console.warn('[Academic] 새로고침 실패:', e);
            if (typeof window.showToast === 'function') {
                window.showToast('학사일정 새로고침 실패: ' + (e.message || ''), 'error');
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('is-loading');
            }
        }
    };

    window.openAcademicCalendarModal = openAcademicCalendarModal;
    window.renderAcademicBadgesOnCalendar = renderAcademicBadgesOnCalendar;
    window.renderDayDetailAcademicSection = renderDayDetailAcademicSection;
    window.renderDaySettingsAcademicSection = renderDaySettingsAcademicSection;
    window.renderUpcomingAcademicEvents = renderUpcomingAcademicEvents;
    window.renderPinnedAcademicEventsSidebar = renderPinnedAcademicEventsSidebar;
    window.getMonthlyAcademicEvents = getMonthlyAcademicEvents;
    window.getAcademicEventsForDate = getAcademicEventsForDate;
    window.getSubscribedAcademicSchools = getSubscribedSchools;
    window.invalidateAcademicCache = invalidateAcademicCache;
    window.getPinnedAcademicEvents = getPinnedEvents;
    window.isAcademicEventPinned = isEventPinned;
    window.togglePinAcademicEvent = togglePinEventInternal;
    window.unpinAcademicEvent = unpinEvent;
    window.syncAcademicSchoolSubscriptionsFromStudents = syncSubscriptionsFromStudents;
})();
