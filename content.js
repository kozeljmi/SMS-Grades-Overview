(function () {
  "use strict";

  const LOG = (typeof DEV === "undefined" || DEV) ? (...args) => console.log("[SMS Grades]", ...args) : () => {};
  const ERR = (typeof DEV === "undefined" || DEV) ? (...args) => console.error("[SMS Grades]", ...args) : () => {};

  const STUDENT_GRADES_URL = "https://sms.eursc.eu/content/studentui/grades_details.php";
  const GUARDIAN_GRADES_URL = "https://sms.eursc.eu/content/guardian/performance_sheet.php";
  const DEFAULT_CUTOFF = "2026-02-27";

  function detectBaseUrl() {
    const isGuardian = !!document.querySelector('a[href*="/content/guardian/"]');
    return isGuardian ? GUARDIAN_GRADES_URL : STUDENT_GRADES_URL;
  }

  // --- Raw results cache (fetched once, filtered on every render) ---
  let allCourses = [];
  let rawResults = []; // { course, data, error } with unfiltered data

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

  // --- Network ---

  function fetchPage(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "fetchPage", url }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response.html);
        } else {
          reject(new Error(response?.error || "Unknown error"));
        }
      });
    });
  }

  // --- Parsing ---

  function parseCourseList(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const select = doc.querySelector("#course_id");
    if (!select) {
      ERR("Could not find #course_id select element");
      return [];
    }

    const courses = [];
    for (const option of select.options) {
      const id = option.value.trim();
      const name = option.textContent.trim();
      if (id) courses.push({ id, name });
    }
    LOG(`Discovered ${courses.length} courses:`, courses.map((c) => c.name).join(", "));
    return courses;
  }

  function parseGradesHtml(html, isGuardian) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const rows = doc.querySelectorAll(".tablesorter tbody tr");

    const grades = [];
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 5) continue;

      const date = cells[0]?.textContent.trim();
      const type = cells[1]?.textContent.trim();
      const description = cells[2]?.textContent.trim();
      const weight = parseFloat(cells[3]?.textContent.trim()) || 0;
      const lastCell = cells[cells.length - 1];
      const gradeText = lastCell?.textContent.trim();
      const isGraded = gradeText !== "Not yet graded" && !isNaN(parseFloat(gradeText));
      const gradeValue = isGraded ? parseFloat(gradeText) : null;
      const actualGrade = cells.length >= 6 ? cells[4]?.textContent.trim() : "";

      grades.push({ date, type, description, weight, actualGrade, gradeValue, isGraded });
    }

    // Guardian view shows raw scores with %, not real percentages.
    // Detect /10 scale: if all graded values are <= 10, multiply by 10.
    const graded = grades.filter((g) => g.isGraded && g.weight > 0);
    if (isGuardian && graded.length > 0 && graded.every((g) => g.gradeValue <= 10)) {
      for (const g of graded) g.gradeValue *= 10;
    }

    let weightedAvg = null;
    if (graded.length > 0) {
      const totalWeighted = graded.reduce((sum, g) => sum + g.gradeValue * g.weight, 0);
      const totalWeight = graded.reduce((sum, g) => sum + g.weight, 0);
      weightedAvg = totalWeighted / totalWeight;
    }

    return { grades, weightedAvg, gradedCount: graded.length, totalCount: grades.length };
  }

  // --- Filtering ---

  function parseDate(str) {
    const [d, m, y] = str.split("/").map(Number);
    return new Date(y, m - 1, d);
  }

  function applyDateFilter(data, filter, cutoff) {
    if (filter === "all") return data;
    const filtered = data.grades.filter((g) => {
      const d = parseDate(g.date);
      return filter === "before" ? d < cutoff : d >= cutoff;
    });
    const graded = filtered.filter((g) => g.isGraded && g.weight > 0);
    let weightedAvg = null;
    if (graded.length > 0) {
      const totalWeighted = graded.reduce((sum, g) => sum + g.gradeValue * g.weight, 0);
      const totalWeight = graded.reduce((sum, g) => sum + g.weight, 0);
      weightedAvg = totalWeighted / totalWeight;
    }
    return { grades: filtered, weightedAvg, gradedCount: graded.length, totalCount: filtered.length };
  }

  function gradeColor(value) {
    if (value == null) return "#999";
    if (value >= 90) return "#63be7b";
    if (value >= 80) return "#83c77d";
    if (value >= 70) return "#a2d07f";
    if (value >= 60) return "#c6da81";
    if (value >= 50) return "#e6e483";
    return "#f8696b";
  }

  // --- Widget skeleton ---

  function createWidget() {
    return el("div", { id: "sms-grades-widget" }, [
      el("div", { className: "sms-grades-header" }, [
        el("h3", { textContent: "Grades Overview" }),
        el("div", { className: "sms-grades-general-avg", id: "sms-grades-general-avg" }),
        el("div", { className: "sms-grades-filter", id: "sms-grades-filter" }),
      ]),
      el("div", { className: "sms-grades-cards", id: "sms-grades-cards" }, [
        el("div", { className: "sms-grades-loading", textContent: "Loading grades..." }),
      ]),
      el("div", { className: "sms-grades-section" }, [
        el("h4", { textContent: "Recent Grades" }),
        el("div", { id: "sms-grades-recent" }, [
          el("div", { className: "sms-grades-loading", textContent: "Loading..." }),
        ]),
      ]),
    ]);
  }

  // --- Date filter controls (in widget) ---

  function renderFilterControls(dateFilter, dateCutoff) {
    const container = document.getElementById("sms-grades-filter");
    if (!container) return;
    clearChildren(container);

    const select = el("select", { className: "sms-filter-select" });
    for (const [value, label] of [["all", "All grades"], ["before", "Before date"], ["after", "After date"]]) {
      const opt = el("option", { value, textContent: label });
      if (value === dateFilter) opt.selected = true;
      select.appendChild(opt);
    }

    const dateInput = el("input", { className: "sms-filter-date", type: "date", value: dateCutoff });
    if (dateFilter === "all") dateInput.style.display = "none";

    select.addEventListener("change", () => {
      const mode = select.value;
      dateInput.style.display = mode === "all" ? "none" : "";
      chrome.storage.local.set({ dateFilter: mode });
    });

    dateInput.addEventListener("change", () => {
      chrome.storage.local.set({ dateCutoff: dateInput.value });
    });

    container.appendChild(select);
    container.appendChild(dateInput);
  }

  // --- Render functions ---

  function renderGeneralAverage(results) {
    const container = document.getElementById("sms-grades-general-avg");
    if (!container) return;

    const subjectAverages = results
      .filter((r) => r.data && r.data.weightedAvg != null)
      .map((r) => r.data.weightedAvg);

    clearChildren(container);
    if (subjectAverages.length === 0) return;

    const generalAvg = subjectAverages.reduce((sum, v) => sum + v, 0) / subjectAverages.length;
    const color = gradeColor(generalAvg);

    container.appendChild(
      el("span", { className: "sms-general-avg-badge", style: { backgroundColor: color }, textContent: generalAvg.toFixed(1) })
    );
    container.appendChild(
      el("span", { className: "sms-general-avg-label", textContent: `General Average (${subjectAverages.length} subjects)` })
    );
  }

  function hideCourse(courseId) {
    chrome.storage.local.get("hiddenCourses", ({ hiddenCourses = [] }) => {
      const updated = new Set(hiddenCourses);
      updated.add(courseId);
      chrome.storage.local.set({ hiddenCourses: [...updated] });
    });
  }

  function renderCards(results) {
    const container = document.getElementById("sms-grades-cards");
    if (!container) return;

    clearChildren(container);

    if (results.length === 0) {
      container.appendChild(el("div", { className: "sms-grades-empty", textContent: "All courses are hidden. Use the extension popup to show courses." }));
      return;
    }

    for (const { course, data, error } of results) {
      const nameEl = el("div", { className: "sms-grade-card-name", textContent: course.name });

      const dismissBtn = el("button", { className: "sms-grade-card-dismiss", textContent: "\u00d7" });
      dismissBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        hideCourse(course.id);
      });

      let avgEl, infoEl;
      if (error) {
        avgEl = el("div", { className: "sms-grade-card-avg", style: { backgroundColor: "#999" }, textContent: "Error" });
        infoEl = el("div", { className: "sms-grade-card-info", textContent: error });
      } else {
        const avg = data.weightedAvg;
        const avgDisplay = avg != null ? avg.toFixed(1) : "N/A";
        const color = gradeColor(avg);
        avgEl = el("div", { className: "sms-grade-card-avg", style: { backgroundColor: color }, textContent: avgDisplay });
        infoEl = el("div", { className: "sms-grade-card-info", textContent: `${data.gradedCount} / ${data.totalCount} graded` });
      }

      container.appendChild(el("div", { className: "sms-grade-card" }, [dismissBtn, nameEl, avgEl, infoEl]));
    }
  }

  function renderRecent(results) {
    const container = document.getElementById("sms-grades-recent");
    if (!container) return;

    const allGraded = [];
    for (const { course, data } of results) {
      if (!data) continue;
      for (const g of data.grades) {
        if (g.isGraded) allGraded.push({ ...g, courseName: course.name });
      }
    }

    allGraded.sort((a, b) => {
      const [da, ma, ya] = a.date.split("/").map(Number);
      const [db, mb, yb] = b.date.split("/").map(Number);
      return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
    });

    const recent = allGraded.slice(0, 10);
    clearChildren(container);

    if (recent.length === 0) {
      container.appendChild(el("div", { className: "sms-grades-empty", textContent: "No graded assignments yet." }));
      return;
    }

    const headerRow = el("tr", null, ["Date", "Subject", "Description", "Grade"].map(
      (text) => el("th", { textContent: text })
    ));

    const tbody = el("tbody");
    for (const g of recent) {
      const color = gradeColor(g.gradeValue);
      tbody.appendChild(el("tr", null, [
        el("td", { textContent: g.date }),
        el("td", { textContent: g.courseName }),
        el("td", { textContent: g.description }),
        el("td", null, [
          el("span", { className: "sms-grade-badge", style: { backgroundColor: color }, textContent: g.gradeValue.toFixed(1) }),
        ]),
      ]));
    }

    container.appendChild(el("table", { className: "sms-grades-table" }, [
      el("thead", null, [headerRow]),
      tbody,
    ]));
  }

  // --- Reactive render: filter raw data + render, no fetch ---

  async function renderAll() {
    const { hiddenCourses = [], dateFilter = "all", dateCutoff = DEFAULT_CUTOFF } = await chrome.storage.local.get(["hiddenCourses", "dateFilter", "dateCutoff"]);
    const cutoffDate = new Date(dateCutoff);
    const hiddenSet = new Set(hiddenCourses);

    // Filter visible courses from raw results
    const visible = rawResults.filter((r) => !hiddenSet.has(r.course.id));

    // Apply date filter
    const filtered = visible.map((r) => {
      if (!r.data) return r;
      return { ...r, data: applyDateFilter(r.data, dateFilter, cutoffDate) };
    });

    LOG(`renderAll: ${visible.length} visible, filter=${dateFilter}, cutoff=${dateCutoff}`);

    // Update filter controls to reflect current state (without re-creating if values match)
    renderFilterControls(dateFilter, dateCutoff);
    renderGeneralAverage(filtered);
    renderCards(filtered);
    renderRecent(filtered);
  }

  // --- Init: fetch once, then set up reactive rendering ---

  async function init() {
    LOG("Initializing...");

    const wrapper = document.querySelector(".dashboard-wrapper");
    if (!wrapper) {
      ERR("Dashboard wrapper not found");
      return;
    }

    const BASE_URL = detectBaseUrl();
    const isGuardian = BASE_URL.includes('/guardian/');
    LOG(`User mode: ${isGuardian ? 'guardian' : 'student'}`);

    const widget = createWidget();
    wrapper.prepend(widget);

    // Step 1: Discover courses
    LOG("Fetching course list...");
    try {
      const html = await fetchPage(BASE_URL);
      allCourses = parseCourseList(html);
    } catch (err) {
      ERR("Failed to fetch course list:", err.message);
      const cards = document.getElementById("sms-grades-cards");
      clearChildren(cards);
      cards.appendChild(el("div", { className: "sms-grades-loading", textContent: "Failed to load courses. Are you logged in?" }));
      return;
    }

    if (allCourses.length === 0) {
      const cards = document.getElementById("sms-grades-cards");
      clearChildren(cards);
      cards.appendChild(el("div", { className: "sms-grades-empty", textContent: "No courses found." }));
      return;
    }

    chrome.storage.local.set({ allCourses, isGuardian });

    // Step 2: Fetch grades for ALL courses (raw, unfiltered)
    const promises = allCourses.map(async (course) => {
      try {
        LOG(`Fetching grades for ${course.name} (${course.id})...`);
        const html = await fetchPage(`${BASE_URL}?course_id=${course.id}`);
        const data = parseGradesHtml(html, isGuardian);
        return { course, data, error: null };
      } catch (err) {
        ERR(`Failed to fetch ${course.name} (${course.id}):`, err.message);
        return { course, data: null, error: err.message };
      }
    });

    rawResults = await Promise.all(promises);
    LOG(`Fetched ${rawResults.length} courses`);

    // Step 3: Initial render
    await renderAll();

    // Step 4: Listen for storage changes → re-render reactively
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if ("hiddenCourses" in changes || "dateFilter" in changes || "dateCutoff" in changes) {
        LOG("Settings changed, re-rendering...");
        renderAll();
      }
      if ("discoMode" in changes) {
        const table = findAttendanceTable();
        if (table) setDisco(table, !!changes.discoMode.newValue);
      }
      if ("jumpscareMode" in changes) {
        if (changes.jumpscareMode.newValue) scheduleJumpscare();
        else stopJumpscare();
      }
    });

    LOG("Done — reactive listener active");
  }

  // --- Jumpscare mode ---

  const JUMPSCARE_IMAGES = ["scares/epstein.png", "scares/jumptrump.png", "scares/stephen.png"];
  const JUMPSCARE_MIN_INTERVAL = 30000;
  const JUMPSCARE_MAX_INTERVAL = 120000;

  let jumpscareTimer = null;
  let lastMouseX = window.innerWidth / 2;
  let lastMouseY = window.innerHeight / 2;

  document.addEventListener("mousemove", (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });

  function triggerJumpscare() {
    const src = JUMPSCARE_IMAGES[Math.floor(Math.random() * JUMPSCARE_IMAGES.length)];
    const overlay = el("div", { className: "sms-jumpscare" });
    const imgEl = el("img", {
      src: chrome.runtime.getURL(src),
      className: "sms-jumpscare-img",
    });
    imgEl.style.left = lastMouseX + "px";
    imgEl.style.top = lastMouseY + "px";
    overlay.appendChild(imgEl);
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 800);
    scheduleJumpscare();
  }

  function scheduleJumpscare() {
    clearTimeout(jumpscareTimer);
    const delay = JUMPSCARE_MIN_INTERVAL + Math.random() * (JUMPSCARE_MAX_INTERVAL - JUMPSCARE_MIN_INTERVAL);
    jumpscareTimer = setTimeout(triggerJumpscare, delay);
    LOG(`Next jumpscare in ${(delay / 1000).toFixed(0)}s`);
  }

  function stopJumpscare() {
    clearTimeout(jumpscareTimer);
    jumpscareTimer = null;
  }

  let lastManualScare = 0;
  const MANUAL_COOLDOWN = 2; //200000;

  document.addEventListener("keydown", (e) => {
    if (e.key !== "e" || e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    if (jumpscareTimer === null) return;
    const now = Date.now();
    if (now - lastManualScare < MANUAL_COOLDOWN) return;
    lastManualScare = now;
    triggerJumpscare();
  });

  function initJumpscare() {
    chrome.storage.local.get("jumpscareMode", ({ jumpscareMode }) => {
      if (jumpscareMode === undefined) {
        chrome.storage.local.set({ jumpscareMode: true });
        scheduleJumpscare();
      } else if (jumpscareMode) {
        scheduleJumpscare();
      }
    });
  }

  // --- Schedule + Attendance ---

  const SCHEDULE_URL = "https://sms.eursc.eu/data/common_handler.php?action=Contact::AJAX_U_GetSchedule";
  const ATTENDANCE_URL = "https://sms.eursc.eu/data/common_handler.php?action=User_Attendance::AJAX_U_GetStudentAbsenceDetails";
  const SCHOOL_YEAR_START = "2025-09-01";

  function parseAttendanceDates() {
    const table = findAttendanceTable();
    if (!table) return null;

    const cells = table.querySelectorAll("td[onclick]");
    if (cells.length === 0) return null;

    let userId = null;
    const dates = [];
    for (const cell of cells) {
      const onclick = cell.getAttribute("onclick");
      const match = onclick.match(/fetchAttendanceDetails\((\d+),\s*"([^"]+)"\)/);
      if (match) {
        if (!userId) userId = match[1];
        dates.push(match[2]);
      }
    }
    return { userId, dates };
  }

  async function fetchSchedule(userId) {
    const start = Math.floor(new Date(SCHOOL_YEAR_START).getTime() / 1000);
    const end = Math.floor(Date.now() / 1000);
    const res = await fetch(SCHEDULE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
      body: `user_id=${userId}&inc_appointment=true&start=${start}&end=${end}`,
      credentials: "include",
    });
    return res.json();
  }

  function buildCourseSchedule(entries) {
    const courses = {};
    for (const e of entries) {
      if (e.entry_type !== "Course") continue;
      if (!courses[e.title]) {
        courses[e.title] = {
          code: e.title,
          id: e.id,
          courseId: e.course_id,
          color: e.color,
          teacher: e.teacher_name_list,
          totalPeriods: 0,
        };
      }
      courses[e.title].totalPeriods++;
    }
    return courses;
  }

  async function fetchAttendanceDetail(userId, date) {
    const res = await fetch(ATTENDANCE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
      body: `user_id=${userId}&date=${date}`,
      credentials: "include",
    });
    return res.text();
  }

  function parseAttendanceDetail(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const rows = doc.querySelectorAll("tr.row-hover-style, tr[class*='row-hover']");
    const records = [];
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 4) continue;
      records.push({
        date: cells[0].textContent.trim(),
        period: cells[1].textContent.trim(),
        course: cells[2].textContent.trim(),
        status: cells[3].textContent.trim(),
      });
    }
    return records;
  }

  function countAbsences(allRecords) {
    const byCourse = {};
    for (const r of allRecords) {
      if (r.status.toLowerCase() !== "absent") continue;
      byCourse[r.course] = (byCourse[r.course] || 0) + 1;
    }
    return byCourse;
  }

  function attendanceColor(pct) {
    if (pct >= 95) return "#63be7b";
    if (pct >= 85) return "#a2d07f";
    if (pct >= 75) return "#e0e383";
    if (pct >= 60) return "#fdd17f";
    if (pct >= 40) return "#fa9d75";
    return "#f8696b";
  }

  function renderAttendanceSection(courseSchedule, absences) {
    let section = document.getElementById("sms-attendance-section");
    if (!section) {
      const widget = document.getElementById("sms-grades-widget");
      if (!widget) return;
      section = el("div", { id: "sms-attendance-section", className: "sms-grades-section" }, [
        el("h4", { textContent: "Attendance by Course" }),
        el("div", { id: "sms-attendance-content" }),
      ]);
      widget.appendChild(section);
    }

    const container = document.getElementById("sms-attendance-content");
    clearChildren(container);

    const rows = Object.values(courseSchedule)
      .map((c) => {
        const absent = absences[c.code] || 0;
        const present = c.totalPeriods - absent;
        const pct = c.totalPeriods > 0 ? (present / c.totalPeriods) * 100 : 100;
        return { ...c, absent, present, pct };
      })
      .sort((a, b) => a.pct - b.pct);

    if (rows.length === 0) {
      container.appendChild(el("div", { className: "sms-grades-empty", textContent: "No attendance data found." }));
      return;
    }

    const headerRow = el("tr", null, ["Course", "Present", "Absent", "Total", "Rate"].map(
      (text) => el("th", { textContent: text })
    ));

    const tbody = el("tbody");
    for (const r of rows) {
      const color = attendanceColor(r.pct);
      tbody.appendChild(el("tr", null, [
        el("td", { textContent: r.code }),
        el("td", { textContent: String(r.present) }),
        el("td", { textContent: String(r.absent) }),
        el("td", { textContent: String(r.totalPeriods) }),
        el("td", null, [
          el("span", { className: "sms-grade-badge", style: { backgroundColor: color }, textContent: r.pct.toFixed(0) + "%" }),
        ]),
      ]));
    }

    container.appendChild(el("table", { className: "sms-grades-table" }, [
      el("thead", null, [headerRow]),
      tbody,
    ]));
  }

  async function fetchAndRenderAttendance() {
    const parsed = parseAttendanceDates();
    if (!parsed) {
      LOG("No clickable attendance dates found");
      return;
    }

    const { userId, dates } = parsed;
    const today = new Date().toISOString().slice(0, 10);

    // Check cache
    const { attendanceCache: cached } = await chrome.storage.local.get("attendanceCache");
    if (cached && cached.date === today && cached.dateCount === dates.length) {
      LOG("Using cached attendance data");
      renderAttendanceSection(cached.courseSchedule, cached.absences);
      return;
    }

    LOG(`Fetching schedule for user ${userId}...`);
    let courseSchedule;
    try {
      const entries = await fetchSchedule(userId);
      courseSchedule = buildCourseSchedule(entries);
      // Store for other parts of the extension
      chrome.storage.local.set({ courseSchedule });
      LOG(`Schedule: ${Object.keys(courseSchedule).length} courses, ${entries.length} total periods`);
    } catch (err) {
      ERR("Failed to fetch schedule:", err.message);
      return;
    }

    LOG(`Fetching absence details for ${dates.length} dates...`);
    const allRecords = [];
    for (const date of dates) {
      try {
        const html = await fetchAttendanceDetail(userId, date);
        const records = parseAttendanceDetail(html);
        allRecords.push(...records);
      } catch (err) {
        ERR(`Failed to fetch attendance for ${date}:`, err.message);
      }
    }

    const absences = countAbsences(allRecords);
    LOG("Absences by course:", absences);

    // Cache
    chrome.storage.local.set({ attendanceCache: { date: today, dateCount: dates.length, courseSchedule, absences } });

    renderAttendanceSection(courseSchedule, absences);
  }

  // --- Disco mode for attendance grid ---

  function findAttendanceTable() {
    const headers = document.querySelectorAll(".dashlet_header");
    for (const h of headers) {
      if (h.textContent.trim().startsWith("Attendance")) {
        const content = h.nextElementSibling;
        if (content) return content.querySelector("table");
      }
    }
    return null;
  }

  function setDisco(table, on) {
    const rows = table.querySelectorAll("tbody tr");
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      for (let i = 1; i < cells.length; i++) {
        if (on) {
          if (!cells[i].dataset.origBg) {
            cells[i].dataset.origBg = cells[i].style.backgroundColor || "";
          }
          cells[i].style.backgroundColor = "";
          cells[i].classList.add("sms-disco-cell");
          cells[i].style.animationDelay = (Math.random() * 1.5).toFixed(2) + "s";
        } else {
          cells[i].classList.remove("sms-disco-cell");
          cells[i].style.animationDelay = "";
          if (cells[i].dataset.origBg !== undefined) {
            cells[i].style.backgroundColor = cells[i].dataset.origBg;
            delete cells[i].dataset.origBg;
          }
        }
      }
    }
  }

  function initDisco() {
    const table = findAttendanceTable();
    if (!table) {
      LOG("Attendance table not found, retrying...");
      return false;
    }
    if (table.dataset.discoReady) return true;
    table.dataset.discoReady = "1";

    chrome.storage.local.get("discoMode", ({ discoMode }) => {
      if (discoMode) setDisco(table, true);
    });

    fetchAndRenderAttendance();

    LOG("Disco mode initialized");
    return true;
  }

  function waitForAttendance() {
    if (initDisco()) return;
    const observer = new MutationObserver(() => {
      if (initDisco()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { init(); waitForAttendance(); initJumpscare(); });
  } else {
    init();
    waitForAttendance();
    initJumpscare();
  }
})();
