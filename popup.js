(async function () {
  const DEFAULT_CUTOFF = "2026-02-27";
  const container = document.getElementById("course-list");
  const filterSelect = document.getElementById("date-filter");
  const dateInputRow = document.getElementById("date-input-row");
  const dateInput = document.getElementById("date-cutoff");

  const {
    allCourses = [],
    hiddenCourses = [],
    dateFilter = "all",
    dateCutoff = DEFAULT_CUTOFF,
  } = await chrome.storage.local.get(["allCourses", "hiddenCourses", "dateFilter", "dateCutoff"]);

  // --- Date filter ---
  filterSelect.value = dateFilter;
  dateInput.value = dateCutoff;
  dateInputRow.style.display = dateFilter === "all" ? "none" : "";

  filterSelect.addEventListener("change", () => {
    const mode = filterSelect.value;
    dateInputRow.style.display = mode === "all" ? "none" : "";
    chrome.storage.local.set({ dateFilter: mode });
  });

  dateInput.addEventListener("change", () => {
    chrome.storage.local.set({ dateCutoff: dateInput.value });
  });

  // --- Course list ---
  if (allCourses.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No courses found yet. Visit the SMS dashboard first.";
    container.appendChild(p);
    return;
  }

  const hiddenSet = new Set(hiddenCourses);

  for (const course of allCourses) {
    const item = document.createElement("label");
    item.className = "course-item";

    const name = document.createElement("span");
    name.className = "course-name";
    name.textContent = course.name;

    const toggle = document.createElement("label");
    toggle.className = "toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !hiddenSet.has(course.id);
    input.addEventListener("change", () => onToggle(course.id, input.checked));

    const track = document.createElement("span");
    track.className = "toggle-track";

    toggle.appendChild(input);
    toggle.appendChild(track);

    item.appendChild(name);
    item.appendChild(toggle);
    container.appendChild(item);
  }

  async function onToggle(courseId, visible) {
    const { hiddenCourses = [] } = await chrome.storage.local.get("hiddenCourses");
    const updated = new Set(hiddenCourses);
    if (visible) updated.delete(courseId);
    else updated.add(courseId);
    await chrome.storage.local.set({ hiddenCourses: [...updated] });
  }
})();
