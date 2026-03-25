(async function () {
  const container = document.getElementById("course-list");

  const { allCourses = [], hiddenCourses = [] } = await chrome.storage.local.get([
    "allCourses",
    "hiddenCourses",
  ]);

  if (allCourses.length === 0) {
    container.innerHTML =
      '<p class="empty">No courses found yet. Visit the SMS dashboard first.</p>';
    return;
  }

  const hiddenSet = new Set(hiddenCourses);

  for (const course of allCourses) {
    const label = document.createElement("label");
    label.className = "course-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !hiddenSet.has(course.id);
    checkbox.addEventListener("change", () => onToggle(course.id, checkbox.checked));

    const span = document.createElement("span");
    span.textContent = course.name;

    label.appendChild(checkbox);
    label.appendChild(span);
    container.appendChild(label);
  }

  async function onToggle(courseId, visible) {
    const { hiddenCourses = [] } = await chrome.storage.local.get("hiddenCourses");
    const updated = new Set(hiddenCourses);

    if (visible) {
      updated.delete(courseId);
    } else {
      updated.add(courseId);
    }

    await chrome.storage.local.set({ hiddenCourses: [...updated] });
  }
})();
