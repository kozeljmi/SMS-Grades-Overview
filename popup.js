(async function () {
  const container = document.getElementById("course-list");

  const {
    allCourses = [],
    hiddenCourses = [],
  } = await chrome.storage.local.get(["allCourses", "hiddenCourses"]);

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

  // Disco mode toggle
  const discoToggle = document.getElementById("disco-toggle");
  const { discoMode = false } = await chrome.storage.local.get("discoMode");
  discoToggle.checked = discoMode;
  discoToggle.addEventListener("change", () => {
    chrome.storage.local.set({ discoMode: discoToggle.checked });
  });
})();
