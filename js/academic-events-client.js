'use strict';
// ============================================================
// academic-events-client.js
//   NEIS Open API 를 호출해 한 학생의 학교 학사일정을
//   임의의 캘린더 grid 의 날짜 셀에 작은 배지로 표시.
//
//   메인 앱(원장)의 academic-calendar.js 와 별개:
//   - 메인 앱: 원장이 구독한 여러 학교를 localStorage 로 관리
//   - 본 클라이언트: 학생의 school 컬럼만 받아 단일 학교 일정 표시
//                   → homework/index.html, parent-portal/index.html 등
//                     학생 단위 페이지에서 사용
//
//   캐시: sessionStorage (24h TTL).
// ============================================================
(function () {
    const NEIS_KEY = '09f0403872974093b3061fb1d669fc7f';
    const NEIS_BASE = 'https://open.neis.go.kr/hub';
    const SCHOOL_CACHE_PREFIX = 'aev_school_';
    const MONTH_CACHE_PREFIX = 'aev_month_';
    const TTL_MS = 24 * 60 * 60 * 1000;

    function _cacheGet(key) {
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const o = JSON.parse(raw);
            if (o && o.expires > Date.now()) return o.data;
        } catch (e) { /* ignore */ }
        return null;
    }
    function _cacheSet(key, data, ttl) {
        try {
            sessionStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + (ttl || TTL_MS) }));
        } catch (e) { /* ignore */ }
    }

    /**
     * 학교명 → { atpt, code, name }. 정확 매칭 우선, 없으면 첫 결과.
     * 학교명이 비어있거나 검색 실패면 null.
     */
    async function resolveSchool(name) {
        const q = String(name || '').trim();
        if (!q) return null;
        const ck = SCHOOL_CACHE_PREFIX + q;
        const cached = _cacheGet(ck);
        if (cached !== null) return cached;
        try {
            const url = `${NEIS_BASE}/schoolInfo?KEY=${NEIS_KEY}&Type=json&pSize=10&SCHUL_NM=${encodeURIComponent(q)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.RESULT && data.RESULT.CODE === 'INFO-200') {
                _cacheSet(ck, null);
                return null;
            }
            const rows = (data.schoolInfo && data.schoolInfo[1] && data.schoolInfo[1].row) || [];
            const match = rows.find((r) => r.SCHUL_NM === q) || rows[0];
            if (!match) {
                _cacheSet(ck, null);
                return null;
            }
            const result = {
                atpt: match.ATPT_OFCDC_SC_CODE,
                code: match.SD_SCHUL_CODE,
                name: match.SCHUL_NM,
            };
            _cacheSet(ck, result);
            return result;
        } catch (e) {
            console.warn('[acev] resolveSchool err', e);
            return null;
        }
    }

    /** 한 학교의 yyyymm 학사일정 → [{ date, name, content }]. 실패/없음은 []. */
    async function fetchMonth(school, yyyymm) {
        if (!school || !school.atpt || !school.code) return [];
        const ck = `${MONTH_CACHE_PREFIX}${school.atpt}_${school.code}_${yyyymm}`;
        const cached = _cacheGet(ck);
        if (Array.isArray(cached)) return cached;
        try {
            const fromYmd = `${yyyymm}01`;
            const year = parseInt(yyyymm.slice(0, 4), 10);
            const month = parseInt(yyyymm.slice(4, 6), 10);
            const lastDay = new Date(year, month, 0).getDate();
            const toYmd = `${yyyymm}${String(lastDay).padStart(2, '0')}`;
            const url = `${NEIS_BASE}/SchoolSchedule?KEY=${NEIS_KEY}&Type=json&pSize=300`
                + `&ATPT_OFCDC_SC_CODE=${school.atpt}&SD_SCHUL_CODE=${school.code}`
                + `&AA_FROM_YMD=${fromYmd}&AA_TO_YMD=${toYmd}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.RESULT && data.RESULT.CODE === 'INFO-200') {
                _cacheSet(ck, []);
                return [];
            }
            const rows = (data.SchoolSchedule && data.SchoolSchedule[1] && data.SchoolSchedule[1].row) || [];
            const events = rows.map((r) => ({
                date: String(r.AA_YMD || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
                name: String(r.EVENT_NM || '').trim(),
                content: String(r.EVENT_CNTNT || '').trim(),
            }));
            _cacheSet(ck, events);
            return events;
        } catch (e) {
            console.warn('[acev] fetchMonth err', e);
            return [];
        }
    }

    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * grid 의 셀에 학사일정 배지를 부착. 기존 배지는 제거 후 다시 그림.
     *
     * @param {object} opts
     *   - schoolName    : 학생의 school (string)
     *   - gridEl        : 캘린더 grid DOM
     *   - cellSelector  : 날짜 셀 selector (각 셀이 dateExtractor 로 dateStr 반환 가능해야 함)
     *   - dateExtractor : (cell) => 'YYYY-MM-DD' 또는 falsy(빈 셀 등)
     */
    async function renderBadgesOnGrid(opts) {
        const { schoolName, gridEl, cellSelector, dateExtractor } = opts || {};
        if (!gridEl || !cellSelector || typeof dateExtractor !== 'function') return;
        // 기존 배지 모두 제거 (이전 월 잔존 방지)
        gridEl.querySelectorAll('.acev-badge').forEach((el) => el.remove());
        if (!schoolName) return;

        const school = await resolveSchool(schoolName);
        if (!school) return;

        const cells = Array.from(gridEl.querySelectorAll(cellSelector));
        const monthSet = new Set();
        const cellDateMap = new Map();
        cells.forEach((cell) => {
            const ds = dateExtractor(cell);
            if (!ds || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
            cellDateMap.set(cell, ds);
            monthSet.add(ds.slice(0, 7).replace('-', ''));
        });
        if (monthSet.size === 0) return;

        const monthData = new Map();
        await Promise.all(Array.from(monthSet).map(async (yyyymm) => {
            const events = await fetchMonth(school, yyyymm);
            const byDate = new Map();
            events.forEach((e) => {
                if (!e.date) return;
                const arr = byDate.get(e.date) || [];
                arr.push(e);
                byDate.set(e.date, arr);
            });
            monthData.set(yyyymm, byDate);
        }));

        cellDateMap.forEach((ds, cell) => {
            const yyyymm = ds.slice(0, 7).replace('-', '');
            const events = (monthData.get(yyyymm) || new Map()).get(ds) || [];
            if (events.length === 0) return;
            const tooltip = `${school.name} 학사일정\n` + events.map((e) => {
                const sub = e.content && e.content !== e.name ? ` · ${e.content}` : '';
                return `· ${e.name}${sub}`;
            }).join('\n');
            const badge = document.createElement('div');
            badge.className = 'acev-badge';
            badge.title = tooltip;
            badge.setAttribute('aria-label', tooltip);
            const ic = document.createElement('i');
            ic.className = 'fas fa-graduation-cap';
            ic.setAttribute('aria-hidden', 'true');
            badge.appendChild(ic);
            if (events.length > 1) {
                const cnt = document.createElement('span');
                cnt.className = 'acev-badge-count';
                cnt.textContent = String(events.length);
                badge.appendChild(cnt);
            }
            // 셀이 position: static 이면 absolute 가 부모를 못 찾으니 보정
            const cs = window.getComputedStyle(cell).position;
            if (cs === 'static' || cs === '') cell.style.position = 'relative';
            cell.appendChild(badge);
        });
    }

    /** 한 번만 페이지에 배지 스타일 주입 (page-agnostic) */
    function _injectStylesOnce() {
        if (document.getElementById('acev-style')) return;
        const style = document.createElement('style');
        style.id = 'acev-style';
        style.textContent = `
.acev-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: rgba(79, 70, 229, 0.92);
    color: #ffffff;
    border-radius: 999px;
    padding: 1px 5px 1px 4px;
    font-size: 9px;
    line-height: 1;
    font-weight: 700;
    pointer-events: auto;
    z-index: 2;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    cursor: help;
}
.acev-badge i { font-size: 8px; }
.acev-badge-count {
    background: #ffffff;
    color: #4f46e5;
    border-radius: 999px;
    padding: 0 4px;
    font-size: 9px;
    font-weight: 800;
    line-height: 1.2;
}
@media (max-width: 480px) {
    .acev-badge { padding: 1px 3px; font-size: 8px; top: 1px; right: 1px; }
    .acev-badge i { font-size: 7px; }
}`;
        document.head.appendChild(style);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _injectStylesOnce);
    } else {
        _injectStylesOnce();
    }

    window.AcademicEventsClient = {
        resolveSchool,
        fetchMonth,
        renderBadgesOnGrid,
    };
})();
