(function () {
  "use strict";

  const LOG = (typeof DEV === "undefined" || DEV) ? (...args) => console.log("[SMS BAC]", ...args) : () => {};

  // --- Storage keys ---
  const KEYS = {
    B_MARKS: "bacBMarks",
    WRITTEN: "bacWritten",
    ORAL: "bacOral",
    INCLUDED: "bacIncluded",
    TARGET: "bacTarget",
    WRITTEN_MARKS: "bacWrittenMarks",
    ORAL_MARKS: "bacOralMarks",
  };

  // --- Subject auto-detection ---
  // Course name format from SMS: "S7<CODE><LANG>" e.g. "S7L1-ITA", "S7MA5ITA"
  const COMPULSORY_CODES = ['L1', 'L2', 'MA3', 'MA5', 'HI2', 'HI4', 'GE2', 'GE4', 'EP', 'PH2', 'PH4'];
  const RELIGION_CODES = ['RCA', 'RCO', 'RCP', 'REL', 'ETH', 'MOR'];

  function getSubjectCode(courseName) {
    const m = courseName.match(/^S\d(.+)/);
    return m ? m[1] : null;
  }

  function isCompulsory(courseName) {
    const code = getSubjectCode(courseName);
    return code ? COMPULSORY_CODES.some(c => code.startsWith(c)) : false;
  }

  function isReligion(courseName) {
    const code = getSubjectCode(courseName);
    return code ? RELIGION_CODES.some(c => code.startsWith(c)) : false;
  }

  // --- State ---
  let courses = [];
  let aMarks = {};        // { courseId: number|undefined } (/10)
  let bMarks = {};        // { courseId: number|undefined } (/10)
  let written = [];       // [courseId, ...]
  let oral = [];          // [courseId, ...]
  let included = [];      // [courseId, ...] — subjects active in BAC calculation
  let target = null;      // /100
  let writtenMarks = {};  // { courseId: number|undefined } (/10)
  let oralMarks = {};     // { courseId: number|undefined } (/10)
  let bacPageEl = null;
  let isVisible = false;

  // --- DOM helpers ---

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "className") e.className = v;
        else if (k === "id") e.id = v;
        else if (k === "textContent") e.textContent = v;
        else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
        else e.setAttribute(k, v);
      }
    }
    if (children) {
      for (const child of Array.isArray(children) ? children : [children]) {
        if (typeof child === "string") e.appendChild(document.createTextNode(child));
        else if (child) e.appendChild(child);
      }
    }
    return e;
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // --- Math helpers ---

  function round(value, dp) {
    const factor = Math.pow(10, dp);
    return Math.round(value * factor) / factor;
  }

  function meanNonNull(values) {
    // values may contain nulls/undefined; skip them
    const valid = values.filter(v => v != null);
    if (valid.length === 0) return null;
    return valid.reduce((s, v) => s + v, 0) / valid.length;
  }

  // --- Color (pass mark = 60) ---

  function gradeColor(value) {
    // value on /100 scale
    if (value >= 90) return "#63be7b";
    if (value >= 80) return "#83c77d";
    if (value >= 70) return "#a2d07f";
    if (value >= 60) return "#c6da81";
    return "#f8696b";
  }

  // --- Calculation per spec §3 ---

  function calcJ(a, b) {
    // §3.2: J = round((2A + 3B) / 5, 2). Null if either A or B is null.
    if (a == null || b == null) return null;
    return round((2 * a + 3 * b) / 5, 2);
  }

  function calcM(j, w, o) {
    // §3.3: Subject final mark. w/o are null if not applicable or not entered.
    if (j == null) return null;
    const hasW = w != null;
    const hasO = o != null;
    if (!hasW && !hasO) return j;
    if (!hasW) return round((0.50 * j + 0.15 * o) / 0.65, 2);
    if (!hasO) return round((0.50 * j + 0.35 * w) / 0.85, 2);
    return round(0.50 * j + 0.35 * w + 0.15 * o, 2);
  }

  // --- Aggregate computation per spec §4 ---

  function computeAll() {
    const subjectData = [];
    const allJ = [];      // J values for active subjects (non-null, non-excluded)
    const allW = [];      // W marks for subjects that have written assigned + mark entered
    const allO = [];      // O marks for subjects that have oral assigned + mark entered

    for (const course of courses) {
      const id = course.id;
      const a = aMarks[id] != null ? aMarks[id] : null;
      const b = bMarks[id] != null ? bMarks[id] : null;
      const isActive = included.includes(id);

      const j = calcJ(a, b);

      // Only include in aggregate if active and J is defined
      if (j != null && isActive) {
        allJ.push(j);
      }

      const isWritten = written.includes(id);
      const isOral = oral.includes(id);
      const wMark = isWritten && writtenMarks[id] != null ? writtenMarks[id] : null;
      const oMark = isOral && oralMarks[id] != null ? oralMarks[id] : null;

      // Collect exam marks for aggregate (only if active and mark exists)
      if (wMark != null && isActive) allW.push(wMark);
      if (oMark != null && isActive) allO.push(oMark);

      // Per-subject final mark
      const m = calcM(j, wMark, oMark);

      subjectData.push({
        course, a, b, j, m, isWritten, isOral, isActive, wMark, oMark,
      });
    }

    // §4.1: Column averages scaled to %
    const jPct = allJ.length > 0 ? round(meanNonNull(allJ) * 10, 1) : null;
    const wPct = allW.length > 0 ? round(meanNonNull(allW) * 10, 1) : null;
    const oPct = allO.length > 0 ? round(meanNonNull(allO) * 10, 1) : null;

    // §4.2: Final BAC mark
    let finalBac = null;
    if (jPct != null && wPct != null && oPct != null) {
      finalBac = round(0.50 * jPct + 0.35 * wPct + 0.15 * oPct, 2);
    }

    // Target calculation
    let required = null;
    if (target != null && jPct != null && written.length > 0 && oral.length > 0) {
      required = calcRequired(target, jPct, allW, allO, written.length, oral.length);
    }

    // Validation
    const warnings = [];
    if (written.length !== 5) warnings.push(`Written: ${written.length}/5 subjects assigned`);
    if (oral.length !== 3) warnings.push(`Oral: ${oral.length}/3 subjects assigned`);
    const missingB = subjectData.filter(s => s.isActive && s.a != null && s.b == null).length;
    if (missingB > 0) warnings.push(`${missingB} subject(s) missing B-mark`);

    return {
      subjectData, jPct, wPct, oPct, finalBac, required,
      writtenCount: written.length, oralCount: oral.length,
      wFilled: allW.length, oFilled: allO.length, warnings,
    };
  }

  // --- Target / inverse calculation ---

  function calcRequired(targetMark, jPct, knownW, knownO, totalW, totalO) {
    // Solve for X (uniform mark /10 needed on remaining exams):
    // target = 0.50*jPct + 0.35*((wKnownSum + remainingW*X) / totalW * 10) + 0.15*((oKnownSum + remainingO*X) / totalO * 10)
    const wKnownSum = knownW.reduce((s, v) => s + v, 0);
    const oKnownSum = knownO.reduce((s, v) => s + v, 0);
    const remainingW = totalW - knownW.length;
    const remainingO = totalO - knownO.length;

    if (remainingW === 0 && remainingO === 0) return null;

    const wCoeff = totalW > 0 ? 0.35 * 10 / totalW : 0;
    const oCoeff = totalO > 0 ? 0.15 * 10 / totalO : 0;

    const knownContrib = 0.50 * jPct + wCoeff * wKnownSum + oCoeff * oKnownSum;
    const xCoeff = wCoeff * remainingW + oCoeff * remainingO;

    if (xCoeff === 0) return null;
    return (targetMark - knownContrib) / xCoeff;
  }

  // --- Storage ---

  async function loadData() {
    const data = await chrome.storage.local.get(Object.values(KEYS));
    bMarks = data[KEYS.B_MARKS] || {};
    written = data[KEYS.WRITTEN] || [];
    oral = data[KEYS.ORAL] || [];
    included = data[KEYS.INCLUDED] || null; // null = first load, needs auto-detection
    target = data[KEYS.TARGET] ?? null;
    writtenMarks = data[KEYS.WRITTEN_MARKS] || {};
    oralMarks = data[KEYS.ORAL_MARKS] || {};
  }

  function autoDetectIncluded() {
    // First load: include compulsory subjects, exclude Religion + optional
    included = [];
    for (const c of courses) {
      if (isReligion(c.name)) continue;
      if (isCompulsory(c.name)) included.push(c.id);
    }
    saveIncluded();
    LOG(`Auto-detected: ${included.length} compulsory subjects included`);
  }

  function saveBMarks() { chrome.storage.local.set({ [KEYS.B_MARKS]: bMarks }); }
  function saveWritten() { chrome.storage.local.set({ [KEYS.WRITTEN]: written }); }
  function saveOral() { chrome.storage.local.set({ [KEYS.ORAL]: oral }); }
  function saveIncluded() { chrome.storage.local.set({ [KEYS.INCLUDED]: included }); }
  function saveTarget() { chrome.storage.local.set({ [KEYS.TARGET]: target }); }
  function saveWrittenMarks() { chrome.storage.local.set({ [KEYS.WRITTEN_MARKS]: writtenMarks }); }
  function saveOralMarks() { chrome.storage.local.set({ [KEYS.ORAL_MARKS]: oralMarks }); }

  // --- Navigation ---

  function showBacPage() {
    if (isVisible) return;
    const wrapper = document.querySelector('.dashboard-wrapper');
    if (wrapper) wrapper.style.display = 'none';
    const container = document.querySelector('.main-content');
    if (container && bacPageEl) {
      container.appendChild(bacPageEl);
      bacPageEl.style.display = '';
    }
    document.querySelectorAll('.nav-sidebar ul.navigation li').forEach(li => li.classList.remove('active'));
    const bacLink = document.querySelector('.sms-bac-nav-link');
    if (bacLink) bacLink.classList.add('active');
    isVisible = true;
    reRender();
  }

  function hideBacPage() {
    if (!isVisible) return;
    const wrapper = document.querySelector('.dashboard-wrapper');
    if (wrapper) wrapper.style.display = '';
    if (bacPageEl) bacPageEl.style.display = 'none';
    const bacLink = document.querySelector('.sms-bac-nav-link');
    if (bacLink) bacLink.classList.remove('active');
    const dashLink = document.querySelector('.nav-sidebar ul.navigation li.-content-common-dashboard-php');
    if (dashLink) dashLink.classList.add('active');
    isVisible = false;
  }

  // --- Render ---

  function formatMark(val, dp) {
    if (val == null || isNaN(val)) return "\u2014";
    return val.toFixed(dp != null ? dp : 2);
  }

  function createBadge(value, scale, dp) {
    const pct = scale === 10 ? value * 10 : value;
    const badge = el('span', {
      className: 'sms-bac-badge',
      textContent: formatMark(value, dp != null ? dp : 2),
      style: { backgroundColor: gradeColor(pct), color: pct < 60 ? '#fff' : '#1a1a2e' }
    });
    return badge;
  }

  function reRender() {
    if (!isVisible || !bacPageEl) return;
    const data = computeAll();
    renderSummary(data);
    renderValidation(data);
    renderTarget(data);
    renderTable(data);
  }

  function renderSummary(data) {
    const container = bacPageEl.querySelector('#sms-bac-summary');
    if (!container) return;
    clearChildren(container);

    const markDisplay = el('div', { className: 'sms-bac-summary-mark' });
    if (data.finalBac != null) {
      markDisplay.appendChild(document.createTextNode('Projected BAC Mark: '));
      markDisplay.appendChild(createBadge(data.finalBac, 100));
      markDisplay.appendChild(document.createTextNode(' /100'));
    } else {
      markDisplay.appendChild(document.createTextNode('Projected BAC Mark: '));
      markDisplay.appendChild(el('span', { className: 'sms-bac-badge sms-bac-badge--muted', textContent: '\u2014' }));
    }
    container.appendChild(markDisplay);

    const details = el('div', { className: 'sms-bac-summary-details' });
    details.appendChild(el('span', { textContent: `J%: ${data.jPct != null ? data.jPct.toFixed(1) : '\u2014'}` }));
    details.appendChild(el('span', { textContent: `W%: ${data.wPct != null ? data.wPct.toFixed(1) : '\u2014'}` }));
    details.appendChild(el('span', { textContent: `O%: ${data.oPct != null ? data.oPct.toFixed(1) : '\u2014'}` }));
    container.appendChild(details);

    const slots = el('div', { className: 'sms-bac-summary-slots' });
    slots.appendChild(el('span', { textContent: `Written: ${data.writtenCount}/5 assigned, ${data.wFilled} marks` }));
    slots.appendChild(el('span', { textContent: `Oral: ${data.oralCount}/3 assigned, ${data.oFilled} marks` }));
    container.appendChild(slots);
  }

  function renderValidation(data) {
    const container = bacPageEl.querySelector('#sms-bac-validation');
    if (!container) return;
    clearChildren(container);

    if (data.warnings.length === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';
    for (const msg of data.warnings) {
      container.appendChild(el('div', { className: 'sms-bac-warning', textContent: msg }));
    }
  }

  function renderTarget(data) {
    const resultEl = bacPageEl.querySelector('#sms-bac-target-result');
    if (!resultEl) return;
    clearChildren(resultEl);

    if (target == null || data.jPct == null) {
      resultEl.textContent = '';
      resultEl.className = 'sms-bac-target-result';
      return;
    }

    if (data.required == null) {
      if (data.finalBac != null) {
        if (data.finalBac >= target) {
          resultEl.textContent = `Your projected mark (${data.finalBac.toFixed(2)}) meets your target!`;
          resultEl.className = 'sms-bac-target-result sms-bac-target-result--success';
        } else {
          resultEl.textContent = `Your projected mark (${data.finalBac.toFixed(2)}) is below your target.`;
          resultEl.className = 'sms-bac-target-result sms-bac-target-result--fail';
        }
      }
      return;
    }

    if (data.required > 10) {
      resultEl.textContent = `Impossible: you would need ${data.required.toFixed(2)}/10 on remaining exams (max is 10).`;
      resultEl.className = 'sms-bac-target-result sms-bac-target-result--fail';
    } else if (data.required <= 0) {
      resultEl.textContent = `Already secured with your preliminary alone!`;
      resultEl.className = 'sms-bac-target-result sms-bac-target-result--success';
    } else {
      resultEl.textContent = `You need an average of ${data.required.toFixed(2)}/10 on remaining exams.`;
      resultEl.className = 'sms-bac-target-result';
    }
  }

  function renderTable(data) {
    const tbody = bacPageEl.querySelector('#sms-bac-tbody');
    if (!tbody) return;
    clearChildren(tbody);

    for (const s of data.subjectData) {
      const tr = el('tr', { className: s.isActive ? '' : 'sms-bac-row--excluded' });

      // Subject name
      tr.appendChild(el('td', { textContent: s.course.name, className: 'sms-bac-td-name' }));

      // A-mark (read-only, always shown)
      const aCell = el('td', { className: 'sms-bac-td-mark' });
      if (s.a != null) aCell.appendChild(createBadge(s.a, 10));
      else aCell.textContent = '\u2014';
      tr.appendChild(aCell);

      // B-mark input
      const bCell = el('td', { className: 'sms-bac-td-input' });
      const bInput = el('input', {
        type: 'number', min: '0', max: '10', step: '0.1',
        className: 'sms-bac-input',
      });
      if (s.b != null) bInput.value = s.b;
      if (!s.isActive) bInput.disabled = true;
      bInput.addEventListener('change', () => {
        const raw = bInput.value.trim();
        if (raw === '') {
          delete bMarks[s.course.id];
        } else {
          const val = parseFloat(raw);
          if (!isNaN(val) && val >= 0 && val <= 10) {
            bMarks[s.course.id] = val;
          } else {
            delete bMarks[s.course.id];
            bInput.value = '';
          }
        }
        saveBMarks();
        reRender();
      });
      bCell.appendChild(bInput);
      tr.appendChild(bCell);

      // Preliminary (J)
      const jCell = el('td', { className: 'sms-bac-td-mark' });
      if (s.j != null && s.isActive) jCell.appendChild(createBadge(s.j, 10));
      else jCell.textContent = '\u2014';
      tr.appendChild(jCell);

      // W checkbox
      const wCbCell = el('td', { className: 'sms-bac-td-check' });
      const wCb = el('input', { type: 'checkbox', className: 'sms-bac-checkbox' });
      wCb.checked = s.isWritten;
      if (!s.isActive || (data.writtenCount >= 5 && !s.isWritten)) wCb.disabled = true;
      wCb.addEventListener('change', () => {
        if (wCb.checked) {
          written.push(s.course.id);
        } else {
          written = written.filter(id => id !== s.course.id);
          delete writtenMarks[s.course.id];
          saveWrittenMarks();
        }
        saveWritten();
        reRender();
      });
      wCbCell.appendChild(wCb);
      tr.appendChild(wCbCell);

      // O checkbox
      const oCbCell = el('td', { className: 'sms-bac-td-check' });
      const oCb = el('input', { type: 'checkbox', className: 'sms-bac-checkbox' });
      oCb.checked = s.isOral;
      if (!s.isActive || (data.oralCount >= 3 && !s.isOral)) oCb.disabled = true;
      oCb.addEventListener('change', () => {
        if (oCb.checked) {
          oral.push(s.course.id);
        } else {
          oral = oral.filter(id => id !== s.course.id);
          delete oralMarks[s.course.id];
          saveOralMarks();
        }
        saveOral();
        reRender();
      });
      oCbCell.appendChild(oCb);
      tr.appendChild(oCbCell);

      // Written exam mark input
      const wCell = el('td', { className: 'sms-bac-td-input' });
      const wInput = el('input', {
        type: 'number', min: '0', max: '10', step: '0.1',
        className: 'sms-bac-input',
      });
      if (s.wMark != null) wInput.value = s.wMark;
      if (!s.isWritten || !s.isActive) wInput.disabled = true;
      wInput.addEventListener('change', () => {
        const raw = wInput.value.trim();
        if (raw === '') {
          delete writtenMarks[s.course.id];
        } else {
          const val = parseFloat(raw);
          if (!isNaN(val) && val >= 0 && val <= 10) {
            writtenMarks[s.course.id] = val;
          } else {
            delete writtenMarks[s.course.id];
            wInput.value = '';
          }
        }
        saveWrittenMarks();
        reRender();
      });
      wCell.appendChild(wInput);
      tr.appendChild(wCell);

      // Oral exam mark input
      const oCell = el('td', { className: 'sms-bac-td-input' });
      const oInput = el('input', {
        type: 'number', min: '0', max: '10', step: '0.1',
        className: 'sms-bac-input',
      });
      if (s.oMark != null) oInput.value = s.oMark;
      if (!s.isOral || !s.isActive) oInput.disabled = true;
      oInput.addEventListener('change', () => {
        const raw = oInput.value.trim();
        if (raw === '') {
          delete oralMarks[s.course.id];
        } else {
          const val = parseFloat(raw);
          if (!isNaN(val) && val >= 0 && val <= 10) {
            oralMarks[s.course.id] = val;
          } else {
            delete oralMarks[s.course.id];
            oInput.value = '';
          }
        }
        saveOralMarks();
        reRender();
      });
      oCell.appendChild(oInput);
      tr.appendChild(oCell);

      // Final mark (M)
      const mCell = el('td', { className: 'sms-bac-td-mark' });
      if (s.m != null && s.isActive) mCell.appendChild(createBadge(s.m, 10));
      else mCell.textContent = '\u2014';
      tr.appendChild(mCell);

      // Include checkbox
      const inclCell = el('td', { className: 'sms-bac-td-check' });
      const inclCb = el('input', { type: 'checkbox', className: 'sms-bac-checkbox' });
      inclCb.checked = s.isActive;
      inclCb.addEventListener('change', () => {
        if (inclCb.checked) {
          included.push(s.course.id);
        } else {
          included = included.filter(id => id !== s.course.id);
          // Also remove from written/oral
          written = written.filter(id => id !== s.course.id);
          oral = oral.filter(id => id !== s.course.id);
          delete writtenMarks[s.course.id];
          delete oralMarks[s.course.id];
          saveWritten();
          saveOral();
          saveWrittenMarks();
          saveOralMarks();
        }
        saveIncluded();
        reRender();
      });
      inclCell.appendChild(inclCb);
      tr.appendChild(inclCell);

      tbody.appendChild(tr);
    }
  }

  // --- Build page skeleton ---

  function buildPage() {
    const page = el('div', { id: 'sms-bac-page', style: { display: 'none' } });

    // Header
    const header = el('div', { className: 'sms-bac-header' }, [
      el('h2', { textContent: 'BAC Calculator (BETA)' }),
      el('button', { className: 'sms-bac-back-btn', textContent: '\u2190 Back to Dashboard' })
    ]);
    header.querySelector('button').addEventListener('click', hideBacPage);
    page.appendChild(header);

    // Summary
    page.appendChild(el('div', { className: 'sms-bac-card', id: 'sms-bac-summary' }));

    // Validation warnings
    page.appendChild(el('div', { className: 'sms-bac-validation', id: 'sms-bac-validation', style: { display: 'none' } }));

    // Target
    const targetCard = el('div', { className: 'sms-bac-card', id: 'sms-bac-target' });
    const targetRow = el('div', { className: 'sms-bac-target-row' });
    targetRow.appendChild(el('label', { textContent: 'Desired mark: ', className: 'sms-bac-target-label' }));
    const targetInput = el('input', {
      type: 'number', min: '0', max: '100', step: '0.1',
      className: 'sms-bac-input sms-bac-input--target',
      id: 'sms-bac-target-input'
    });
    if (target != null) targetInput.value = target;
    targetInput.addEventListener('change', () => {
      const raw = targetInput.value.trim();
      if (raw === '') {
        target = null;
      } else {
        const val = parseFloat(raw);
        if (!isNaN(val) && val >= 0 && val <= 100) {
          target = val;
        } else {
          target = null;
          targetInput.value = '';
        }
      }
      saveTarget();
      reRender();
    });
    targetRow.appendChild(targetInput);
    targetRow.appendChild(el('span', { textContent: ' /100' }));
    targetCard.appendChild(targetRow);
    targetCard.appendChild(el('div', { id: 'sms-bac-target-result', className: 'sms-bac-target-result' }));
    page.appendChild(targetCard);

    // Subject table
    const tableCard = el('div', { className: 'sms-bac-card sms-bac-card--table' });
    const table = el('table', { className: 'sms-bac-table' });
    const thead = el('thead');
    const headerRow = el('tr', {}, [
      el('th', { textContent: 'Subject' }),
      el('th', { textContent: 'A' }),
      el('th', { textContent: 'B' }),
      el('th', { textContent: 'J' }),
      el('th', { textContent: 'W', className: 'sms-bac-th-check' }),
      el('th', { textContent: 'O', className: 'sms-bac-th-check' }),
      el('th', { textContent: 'W. Exam' }),
      el('th', { textContent: 'O. Exam' }),
      el('th', { textContent: 'M' }),
      el('th', { textContent: 'Incl.', className: 'sms-bac-th-check' }),
    ]);
    thead.appendChild(headerRow);
    table.appendChild(thead);
    table.appendChild(el('tbody', { id: 'sms-bac-tbody' }));
    tableCard.appendChild(table);
    page.appendChild(tableCard);

    // Disclaimer
    page.appendChild(el('p', {
      className: 'sms-bac-disclaimer',
      textContent: 'Unofficial calculator. The issued Baccalaureate Certificate is authoritative. Pass mark: 60/100.'
    }));

    return page;
  }

  // --- Init ---

  async function initBac() {
    const data = window.__smsGradesData;
    if (!data || !data.rawResults) return;

    courses = data.allCourses || [];
    for (const r of data.rawResults) {
      if (r.data && r.data.weightedAvg != null) {
        aMarks[r.course.id] = round(r.data.weightedAvg / 10, 2);
      }
    }

    await loadData();

    // First load: auto-detect compulsory subjects
    if (included === null) {
      autoDetectIncluded();
    }

    // Clean up stale IDs
    written = written.filter(id => courses.some(c => c.id === id));
    oral = oral.filter(id => courses.some(c => c.id === id));
    included = included.filter(id => courses.some(c => c.id === id));

    bacPageEl = buildPage();

    document.addEventListener('sms-bac-navigate', (e) => {
      if (e.detail && e.detail.action === 'open') showBacPage();
      else if (e.detail && e.detail.action === 'close') hideBacPage();
    });

    LOG(`Initialized with ${courses.length} courses`);
  }

  if (window.__smsGradesData) {
    initBac();
  } else {
    document.addEventListener('sms-grades-ready', () => initBac(), { once: true });
  }
})();
