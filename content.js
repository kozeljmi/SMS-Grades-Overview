(function () {
  "use strict";

  const LOG = DEV ? (...args) => console.log("[SMS Grades]", ...args) : () => {};
  const ERR = DEV ? (...args) => console.error("[SMS Grades]", ...args) : () => {};

  const BASE_URL = "https://sms.eursc.eu/content/studentui/grades_details.php";

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
      if (id) {
        courses.push({ id, name });
      }
    }
    LOG(`Discovered ${courses.length} courses:`, courses.map((c) => c.name).join(", "));
    return courses;
  }

  function parseGradesHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const rows = doc.querySelectorAll(".tablesorter tbody tr");
    LOG(`Found ${rows.length} grade rows`);

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

    const graded = grades.filter((g) => g.isGraded && g.weight > 0);
    let weightedAvg = null;
    if (graded.length > 0) {
      const totalWeighted = graded.reduce((sum, g) => sum + g.gradeValue * g.weight, 0);
      const totalWeight = graded.reduce((sum, g) => sum + g.weight, 0);
      weightedAvg = totalWeighted / totalWeight;
    }

    LOG(`Parsed: ${graded.length} graded, ${grades.length} total, avg=${weightedAvg?.toFixed(1) ?? "N/A"}`);
    return { grades, weightedAvg, gradedCount: graded.length, totalCount: grades.length };
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

  function createWidget() {
    return el("div", { id: "sms-grades-widget" }, [
      el("div", { className: "sms-grades-header" }, [
        el("h3", { textContent: "Grades Overview" }),
        el("div", { className: "sms-grades-general-avg", id: "sms-grades-general-avg" }),
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
    LOG(`General average: ${generalAvg.toFixed(1)} across ${subjectAverages.length} subjects`);

    container.appendChild(
      el("span", { className: "sms-general-avg-badge", style: { backgroundColor: color }, textContent: generalAvg.toFixed(1) })
    );
    container.appendChild(
      el("span", { className: "sms-general-avg-label", textContent: `General Average (${subjectAverages.length} subjects)` })
    );
  }

  function renderCards(results) {
    const container = document.getElementById("sms-grades-cards");
    if (!container) return;

    clearChildren(container);
    LOG(`Rendering ${results.length} course cards`);

    for (const { course, data, error } of results) {
      const nameEl = el("div", { className: "sms-grade-card-name", textContent: course.name });

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

      container.appendChild(el("div", { className: "sms-grade-card" }, [nameEl, avgEl, infoEl]));
    }
  }

  function renderRecent(results) {
    const container = document.getElementById("sms-grades-recent");
    if (!container) return;

    const allGraded = [];
    for (const { course, data } of results) {
      if (!data) continue;
      for (const g of data.grades) {
        if (g.isGraded) {
          allGraded.push({ ...g, courseName: course.name });
        }
      }
    }

    allGraded.sort((a, b) => {
      const [da, ma, ya] = a.date.split("/").map(Number);
      const [db, mb, yb] = b.date.split("/").map(Number);
      return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
    });

    const recent = allGraded.slice(0, 10);
    LOG(`Rendering ${recent.length} recent grades`);

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

  async function init() {
    LOG("Initializing...");

    const wrapper = document.querySelector(".dashboard-wrapper");
    if (!wrapper) {
      ERR("Dashboard wrapper not found");
      return;
    }

    LOG("Dashboard wrapper found, injecting widget");
    const widget = createWidget();
    wrapper.prepend(widget);

    // Step 1: Discover courses
    LOG("Fetching course list...");
    let allCourses;
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
      LOG("No courses found");
      const cards = document.getElementById("sms-grades-cards");
      clearChildren(cards);
      cards.appendChild(el("div", { className: "sms-grades-empty", textContent: "No courses found." }));
      return;
    }

    // Save course list for the popup
    chrome.storage.local.set({ allCourses });
    LOG("Saved course list to storage");

    // Step 2: Filter out hidden courses
    const { hiddenCourses = [] } = await chrome.storage.local.get("hiddenCourses");
    const hiddenSet = new Set(hiddenCourses);
    const visibleCourses = allCourses.filter((c) => !hiddenSet.has(c.id));
    LOG(`Visible: ${visibleCourses.length}, hidden: ${hiddenCourses.length}`);

    if (visibleCourses.length === 0) {
      const cards = document.getElementById("sms-grades-cards");
      clearChildren(cards);
      cards.appendChild(el("div", { className: "sms-grades-empty", textContent: "All courses are hidden. Use the extension popup to show courses." }));
      clearChildren(document.getElementById("sms-grades-recent"));
      return;
    }

    // Step 3: Fetch grades for each visible course
    const results = [];
    const promises = visibleCourses.map(async (course) => {
      try {
        LOG(`Fetching grades for ${course.name} (${course.id})...`);
        const html = await fetchPage(`${BASE_URL}?course_id=${course.id}`);
        const data = parseGradesHtml(html);
        results.push({ course, data, error: null });
      } catch (err) {
        ERR(`Failed to fetch ${course.name} (${course.id}):`, err.message);
        results.push({ course, data: null, error: err.message });
      }
    });

    await Promise.all(promises);

    LOG("All courses fetched, rendering...");
    renderGeneralAverage(results);
    renderCards(results);
    renderRecent(results);
    LOG("Done!");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
