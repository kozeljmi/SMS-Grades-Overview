(function () {
  "use strict";

  const LOG = DEV ? (...args) => console.log("[SMS Grades]", ...args) : () => {};
  const ERR = DEV ? (...args) => console.error("[SMS Grades]", ...args) : () => {};

  const BASE_URL = "https://sms.eursc.eu/content/studentui/grades_details.php";

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
    const widget = document.createElement("div");
    widget.id = "sms-grades-widget";
    widget.innerHTML = `
      <div class="sms-grades-header">
        <h3>Grades Overview</h3>
        <div class="sms-grades-general-avg" id="sms-grades-general-avg"></div>
      </div>
      <div class="sms-grades-cards" id="sms-grades-cards">
        <div class="sms-grades-loading">Loading grades...</div>
      </div>
      <div class="sms-grades-section">
        <h4>Recent Grades</h4>
        <div id="sms-grades-recent">
          <div class="sms-grades-loading">Loading...</div>
        </div>
      </div>
    `;
    return widget;
  }

  function renderGeneralAverage(results) {
    const container = document.getElementById("sms-grades-general-avg");
    if (!container) return;

    const subjectAverages = results
      .filter((r) => r.data && r.data.weightedAvg != null)
      .map((r) => r.data.weightedAvg);

    if (subjectAverages.length === 0) {
      container.innerHTML = "";
      return;
    }

    const generalAvg = subjectAverages.reduce((sum, v) => sum + v, 0) / subjectAverages.length;
    const color = gradeColor(generalAvg);
    LOG(`General average: ${generalAvg.toFixed(1)} across ${subjectAverages.length} subjects`);

    container.innerHTML = `
      <span class="sms-general-avg-badge" style="background-color:${color};">${generalAvg.toFixed(1)}</span>
      <span class="sms-general-avg-label">General Average (${subjectAverages.length} subjects)</span>
    `;
  }

  function renderCards(results) {
    const container = document.getElementById("sms-grades-cards");
    if (!container) return;

    container.innerHTML = "";
    LOG(`Rendering ${results.length} course cards`);

    for (const { course, data, error } of results) {
      const card = document.createElement("div");
      card.className = "sms-grade-card";

      if (error) {
        card.innerHTML = `
          <div class="sms-grade-card-name">${course.name}</div>
          <div class="sms-grade-card-avg" style="background-color:#999;">Error</div>
          <div class="sms-grade-card-info">${error}</div>
        `;
      } else {
        const avg = data.weightedAvg;
        const avgDisplay = avg != null ? avg.toFixed(1) : "N/A";
        const color = gradeColor(avg);
        card.innerHTML = `
          <div class="sms-grade-card-name">${course.name}</div>
          <div class="sms-grade-card-avg" style="background-color:${color};">${avgDisplay}</div>
          <div class="sms-grade-card-info">${data.gradedCount} / ${data.totalCount} graded</div>
        `;
      }

      container.appendChild(card);
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

    if (recent.length === 0) {
      container.innerHTML = '<div class="sms-grades-empty">No graded assignments yet.</div>';
      return;
    }

    let html = `<table class="sms-grades-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Subject</th>
          <th>Description</th>
          <th>Grade</th>
        </tr>
      </thead>
      <tbody>`;

    for (const g of recent) {
      const color = gradeColor(g.gradeValue);
      html += `
        <tr>
          <td>${g.date}</td>
          <td>${g.courseName}</td>
          <td>${g.description}</td>
          <td><span class="sms-grade-badge" style="background-color:${color};">${g.gradeValue.toFixed(1)}</span></td>
        </tr>`;
    }

    html += "</tbody></table>";
    container.innerHTML = html;
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
      document.getElementById("sms-grades-cards").innerHTML =
        '<div class="sms-grades-loading">Failed to load courses. Are you logged in?</div>';
      return;
    }

    if (allCourses.length === 0) {
      LOG("No courses found");
      document.getElementById("sms-grades-cards").innerHTML =
        '<div class="sms-grades-empty">No courses found.</div>';
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
      document.getElementById("sms-grades-cards").innerHTML =
        '<div class="sms-grades-empty">All courses are hidden. Use the extension popup to show courses.</div>';
      document.getElementById("sms-grades-recent").innerHTML = "";
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
