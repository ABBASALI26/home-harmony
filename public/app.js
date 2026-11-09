
const loginScreen = document.getElementById("login-screen");
const dashboard = document.getElementById("dashboard");

const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("password");
const loginError = document.getElementById("login-error");

const activityForm = document.getElementById("activity-form");
const memberSelect = document.getElementById("member");
const categorySelect = document.getElementById("category");
const dateInput = document.getElementById("date");
const timeInput = document.getElementById("time");
const taskOptions = document.getElementById("task-options");
const notesInput = document.getElementById("notes");
const formMessage = document.getElementById("form-message");

const historyContainer = document.getElementById("activity-history");
const historyFilter = document.getElementById("history-filter");

let taskConfiguration = {};

// API helper
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

// Dashboard visibility
function showDashboard() {
  loginScreen.classList.add("hidden");
  dashboard.classList.remove("hidden");
}

function showLogin() {
  dashboard.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

// Default date and time
function setDefaultDateTime() {
  const now = new Date();

  const localDate = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  );

  dateInput.value = localDate.toISOString().slice(0, 10);
  timeInput.value = localDate.toISOString().slice(11, 16);
}

// Check login session
async function checkSession() {
  try {
    const session = await api("/api/session");

    if (session.authenticated) {
      showDashboard();
      await initializeDashboard();
    } else {
      showLogin();
    }
  } catch (error) {
    showLogin();
    loginError.textContent = "Unable to connect to the server.";
  }
}

// Login
loginForm.addEventListener("submit", async event => {
  event.preventDefault();

  loginError.textContent = "";

  const button = loginForm.querySelector("button");
  button.disabled = true;

  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        password: passwordInput.value
      })
    });

    passwordInput.value = "";

    showDashboard();

    await initializeDashboard();

  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

// Logout
document
  .getElementById("logout-button")
  .addEventListener("click", async () => {
    try {
      await api("/api/logout", {
        method: "POST"
      });
    } finally {
      showLogin();
    }
  });

// Initialize dashboard
async function initializeDashboard() {
  try {
    const config = await api("/api/config");

    taskConfiguration = config.tasks;

    memberSelect.innerHTML =
      '<option value="">Select a member</option>';

    config.members.forEach(member => {
      const option = document.createElement("option");

      option.value = member;
      option.textContent = member;

      memberSelect.appendChild(option);
    });

    setDefaultDateTime();
    renderTaskOptions();

    await loadHistory();

  } catch (error) {
    historyContainer.textContent = error.message;
  }
}

// Render cleaning task checkboxes
function renderTaskOptions() {
  const category = categorySelect.value;
  const tasks = taskConfiguration[category] || [];

  taskOptions.replaceChildren();

  tasks.forEach((task, index) => {
    const label = document.createElement("label");

    label.className = "task-option";

    const checkbox = document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.name = "tasks";
    checkbox.value = task;
    checkbox.id = `task-${index}`;

    const text = document.createElement("span");

    text.textContent = task;

    label.append(checkbox, text);

    taskOptions.appendChild(label);
  });
}

// Change category
categorySelect.addEventListener("change", renderTaskOptions);

// Save cleaning activity
activityForm.addEventListener("submit", async event => {
  event.preventDefault();

  formMessage.textContent = "";
  formMessage.className = "message";

  const selectedTasks = [
    ...taskOptions.querySelectorAll(
      'input[name="tasks"]:checked'
    )
  ].map(input => input.value);

  if (selectedTasks.length === 0) {
    formMessage.textContent =
      "Please select at least one completed task.";

    formMessage.classList.add("error");

    return;
  }

  const payload = {
    member: memberSelect.value,
    category: categorySelect.value,
    date: dateInput.value,
    time: timeInput.value,
    tasks: selectedTasks,
    notes: notesInput.value
  };

  const button = activityForm.querySelector(
    'button[type="submit"]'
  );

  button.disabled = true;

  try {
    await api("/api/records", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    formMessage.textContent =
      "Cleaning activity saved successfully!";

    formMessage.classList.add("success");

    activityForm.reset();

    setDefaultDateTime();
    renderTaskOptions();

    await loadHistory();

  } catch (error) {
    formMessage.textContent = error.message;
    formMessage.classList.add("error");

  } finally {
    button.disabled = false;
  }
});

// History filter
historyFilter.addEventListener("change", loadHistory);

// Load cleaning history and statistics
async function loadHistory() {
  try {
    const records = await api("/api/records");

    const bathroomCount = records.filter(
      record => record.category === "bathroom"
    ).length;

    const trashCount = records.filter(
      record => record.category === "trash"
    ).length;

    document.getElementById("bathroom-count").textContent =
      bathroomCount;

    document.getElementById("trash-count").textContent =
      trashCount;

    document.getElementById("total-count").textContent =
      records.length;

    renderHistory(records);

  } catch (error) {
    historyContainer.textContent = error.message;
  }
}

// Render activity history
function renderHistory(records) {
  const filter = historyFilter.value;

  const filteredRecords = records.filter(record => {
    return filter === "all" || record.category === filter;
  });

  historyContainer.replaceChildren();

  if (filteredRecords.length === 0) {
    const empty = document.createElement("p");

    empty.className = "muted";
    empty.textContent =
      "No cleaning activities recorded yet.";

    historyContainer.appendChild(empty);

    return;
  }

  filteredRecords.forEach(record => {
    const item = document.createElement("article");

    item.className = "activity-item";

    const top = document.createElement("div");

    top.className = "activity-top";

    const details = document.createElement("div");

    const name = document.createElement("div");

    name.className = "activity-name";
    name.textContent = record.member;

    const meta = document.createElement("div");

    meta.className = "activity-meta";

    meta.textContent =
      `${record.date} at ${formatTime(record.time)}`;

    details.append(name, meta);

    const tag = document.createElement("span");

    tag.className = "category-tag";

    tag.textContent =
      record.category === "bathroom"
        ? "BATHROOM"
        : "TRASH & WASTE";

    top.append(details, tag);

    const tasks = document.createElement("div");

    tasks.className = "activity-tasks";

    tasks.textContent =
      "Completed: " + record.tasks.join(", ");

    item.append(top, tasks);

    if (record.notes) {
      const notes = document.createElement("div");

      notes.className = "activity-notes";

      notes.textContent = "Notes: " + record.notes;

      item.appendChild(notes);
    }

    historyContainer.appendChild(item);
  });
}

// Format time
function formatTime(time) {
  const [hours, minutes] = time.split(":").map(Number);

  const suffix = hours >= 12 ? "PM" : "AM";

  const displayHour = hours % 12 || 12;

  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

// Start application
checkSession();
