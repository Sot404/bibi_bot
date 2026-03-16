const dayMinutes = 24 * 60;
const dayTrack = document.getElementById("dayTrack");
const dayScale = document.getElementById("dayScale");
const taskList = document.getElementById("taskList");
const emptyState = document.getElementById("emptyState");
const resetBtn = document.getElementById("resetBtn");
const appRoot = document.querySelector(".app");
const addBtn = document.getElementById("addBtn");
const splitBtn = document.getElementById("splitBtn");
const deleteBtn = document.getElementById("deleteBtn");
const welcome = document.getElementById("welcome");
const firstForm = document.getElementById("firstForm");
const firstTitle = document.getElementById("firstTitle");
const firstMinutes = document.getElementById("firstMinutes");
const enterBtn = document.getElementById("enterBtn");
const draftList = document.getElementById("draftList");
const draftEmpty = document.getElementById("draftEmpty");
const pickButtons = document.querySelectorAll(".pick");
const taskDialog = document.getElementById("taskDialog");
const taskForm = document.getElementById("taskForm");
const taskTitle = document.getElementById("taskTitle");
const taskMinutes = document.getElementById("taskMinutes");
const loginBtn = document.getElementById("loginBtn");
const userBadge = document.getElementById("userBadge");

let tasks = [];
let draftTasks = [];
let selectedId = null;
let dragState = null;
let rafId = null;
let ghostLine = null;
let supabaseClient = null;
let currentUser = null;

const colors = [
  "#ffb703",
  "#8ecae6",
  "#ff9f1c",
  "#06d6a0",
  "#f94144",
  "#f3722c",
];

const presetIcons = {
  "Διάβασμα": "reading",
  "Γυμναστική": "gym",
  "Φαγητό": "food",
};

function iconFor(type) {
  if (type === "gym") {
    return `<img src="gym.svg" alt="Gym icon" />`;
  }
  if (type === "reading") {
    return `<img src="book.svg" alt="Book icon" />`;
  }
  if (type === "food") {
    return `<img src="eat.svg" alt="Food icon" />`;
  }
  return "";
}

function minutesToLabel(minutes) {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = Math.floor(minutes % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}`;
}

function save() {
  localStorage.setItem("bibi-planner", JSON.stringify(tasks));
}

function load() {
  const raw = localStorage.getItem("bibi-planner");
  tasks = raw ? JSON.parse(raw) : [];
}

function nextColor(idx) {
  return colors[idx % colors.length];
}

function placeAtEnd(duration) {
  const sorted = [...tasks].sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const t of sorted) {
    if (cursor + duration <= t.start) break;
    cursor = Math.max(cursor, t.start + t.minutes);
  }
  return Math.min(cursor, dayMinutes - duration);
}

function render() {
  dayTrack.innerHTML = "";
  taskList.innerHTML = "";

  emptyState.style.display = tasks.length ? "none" : "block";

  const sortedTasks = [...tasks].sort((a, b) => a.start - b.start);

  tasks.forEach((task) => {
    const block = document.createElement("div");
    block.className = "task-block";
    block.dataset.id = task.id;
    block.style.left = `${(task.start / dayMinutes) * 100}%`;
    block.style.width = `${(task.minutes / dayMinutes) * 100}%`;
    block.style.background = task.color;

    if (task.id === selectedId) {
      block.style.outline = "3px solid rgba(255,255,255,0.6)";
    }

    if (task.presetType) {
      block.innerHTML = `<div class="icon">${iconFor(task.presetType)}</div>`;
    } else {
      block.innerHTML = "";
    }

    block.addEventListener("pointerdown", (event) => startDrag(event, task.id));
    block.addEventListener("click", () => selectTask(task.id));

    dayTrack.appendChild(block);

  });

  taskList.innerHTML = "";
  sortedTasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = "task-item";
    item.style.borderLeft = `4px solid ${task.color}`;
    item.innerHTML = `
      <div>
        <strong>${task.title}</strong>
        ${minutesToLabel(task.start)}–${minutesToLabel(task.start + task.minutes)} · ${task.minutes} min
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const bellBtn = document.createElement("button");
    bellBtn.className = "icon-btn";
    bellBtn.type = "button";
    bellBtn.title = "Notifications";
    bellBtn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2z"/></svg>';
    if (!task.notify) bellBtn.classList.add("muted");
    bellBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      task.notify = !task.notify;
      saveAll();
    });

    const inviteBtn = document.createElement("button");
    inviteBtn.className = "icon-btn";
    inviteBtn.type = "button";
    inviteBtn.title = "Invite";
    inviteBtn.textContent = "+";

    actions.appendChild(bellBtn);
    actions.appendChild(inviteBtn);
    item.appendChild(actions);

    item.addEventListener("click", () => selectTask(task.id));
    taskList.appendChild(item);
  });

  if (!ghostLine) {
    ghostLine = document.createElement("div");
    ghostLine.className = "ghost-line";
    ghostLine.innerHTML = "<span></span>";
  }
  dayTrack.appendChild(ghostLine);

  splitBtn.disabled = !selectedId;
  deleteBtn.disabled = !selectedId;
}

function selectTask(id) {
  selectedId = id;
  render();
}

function startDrag(event, id) {
  event.preventDefault();
  const block = event.currentTarget;
  const rect = dayTrack.getBoundingClientRect();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  const pointerMinutes = ((event.clientX - rect.left) / rect.width) * dayMinutes;
  const grabOffset = pointerMinutes - task.start;

  dragState = {
    id,
    trackLeft: rect.left,
    trackWidth: rect.width,
    grabOffset,
    block,
    lastX: event.clientX,
    targetStart: task.start,
    currentStart: task.start,
  };

  block.setPointerCapture(event.pointerId);
  block.classList.add("dragging");
  showGhost(task.start);

  block.addEventListener("pointermove", onDrag);
  block.addEventListener("pointerup", endDrag, { once: true });
}

function onDrag(event) {
  if (!dragState) return;
  const { trackWidth, trackLeft, grabOffset } = dragState;

  const distance = Math.abs(event.clientX - dragState.lastX);
  dragState.lastX = event.clientX;

  let speedFactor = 1;
  if (distance < 2) speedFactor = 0.5;
  else if (distance < 6) speedFactor = 0.8;
  else if (distance > 16) speedFactor = 1.4;
  else if (distance > 10) speedFactor = 1.2;

  const pointerMinutes = ((event.clientX - trackLeft) / trackWidth) * dayMinutes;
  const baseMinutes = pointerMinutes - grabOffset;
  const deltaMinutes = (baseMinutes - dragState.currentStart) * speedFactor;
  const task = tasks.find((t) => t.id === dragState.id);
  if (!task) return;

  let nextStart = Math.round(dragState.currentStart + deltaMinutes);
  nextStart = Math.max(0, Math.min(dayMinutes - task.minutes, nextStart));
  nextStart = applySnap(nextStart);
  dragState.targetStart = nextStart;
  showGhost(nextStart);

  if (!rafId) {
    rafId = requestAnimationFrame(tickDrag);
  }
}

function tickDrag() {
  if (!dragState) {
    rafId = null;
    return;
  }
  const task = tasks.find((t) => t.id === dragState.id);
  if (!task) {
    rafId = null;
    return;
  }

  const ease = 0.22;
  dragState.currentStart +=
    (dragState.targetStart - dragState.currentStart) * ease;

  task.start = Math.round(dragState.currentStart);
  updateBlock(dragState.block, task);

  const delta = Math.abs(dragState.targetStart - dragState.currentStart);
  if (delta > 0.2) {
    rafId = requestAnimationFrame(tickDrag);
  } else {
    rafId = null;
  }
}

function endDrag(event) {
  if (!dragState) return;
  dragState.block.classList.remove("dragging");
  dragState.block.releasePointerCapture(event.pointerId);
  const task = tasks.find((t) => t.id === dragState.id);
  if (task) {
    task.start = Math.round(dragState.targetStart);
  }
  dragState = null;
  hideGhost();
  render();
  saveAll();
}

function updateBlock(block, task) {
  block.style.left = `${(task.start / dayMinutes) * 100}%`;
  block.style.width = `${(task.minutes / dayMinutes) * 100}%`;
  const meta = block.querySelector(".task-meta");
  if (meta) {
    meta.textContent = `${minutesToLabel(task.start)} → ${minutesToLabel(
      task.start + task.minutes
    )}`;
  }
}

function showGhost(startMinutes) {
  if (!ghostLine) return;
  ghostLine.style.display = "block";
  ghostLine.style.left = `${(startMinutes / dayMinutes) * 100}%`;
  const label = ghostLine.querySelector("span");
  label.textContent = minutesToLabel(startMinutes);
}

function hideGhost() {
  if (!ghostLine) return;
  ghostLine.style.display = "none";
}

function applySnap(minutes) {
  const nearestHalfHour = Math.round(minutes / 30) * 30;
  if (Math.abs(minutes - nearestHalfHour) <= 5) {
    return nearestHalfHour;
  }
  return minutes;
}

function addTask(title, minutes) {
  const presetType = presetIcons[title] || null;
  const start = placeAtEnd(minutes);
  const task = {
    id: crypto.randomUUID(),
    title,
    minutes,
    start,
    color: nextColor(tasks.length),
    notify: true,
    presetType,
  };
  tasks.push(task);
  saveAll();
}

function splitTask() {
  const task = tasks.find((t) => t.id === selectedId);
  if (!task) return;

  const splitMinutes = Number(
    prompt("Πόσα λεπτά να κρατήσει το πρώτο κομμάτι;", Math.floor(task.minutes / 2))
  );

  if (!splitMinutes || splitMinutes <= 0 || splitMinutes >= task.minutes) return;

  const remaining = task.minutes - splitMinutes;
  task.minutes = splitMinutes;

  const newTask = {
    id: crypto.randomUUID(),
    title: task.title,
    minutes: remaining,
    start: Math.min(task.start + splitMinutes, dayMinutes - remaining),
    color: task.color,
    presetType: task.presetType,
  };

  tasks.push(newTask);
  saveAll();
}

function deleteTask() {
  if (!selectedId) return;
  tasks = tasks.filter((t) => t.id !== selectedId);
  selectedId = null;
  saveAll();
}

addBtn.addEventListener("click", () => {
  taskForm.reset();
  taskDialog.showModal();
});

splitBtn.addEventListener("click", splitTask);

deleteBtn.addEventListener("click", deleteTask);

pickButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    firstTitle.value = btn.textContent;
    firstTitle.focus();
  });
});

firstForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = firstTitle.value.trim();
  const minutes = Number(firstMinutes.value);
  if (!title || !minutes) return;
  draftTasks.push({
    id: crypto.randomUUID(),
    title,
    minutes,
  });
  firstForm.reset();
  firstMinutes.value = 60;
  renderDraft();
});

enterBtn.addEventListener("click", () => {
  draftTasks.forEach((draft) => addTask(draft.title, draft.minutes));
  draftTasks = [];
  renderDraft();
  welcome.style.display = "none";
  appRoot.classList.remove("is-hidden");
});

resetBtn.addEventListener("click", () => {
  if (!confirm("Θες να καθαρίσεις το πρόγραμμα και να ξεκινήσεις από την αρχή;")) {
    return;
  }
  tasks = [];
  draftTasks = [];
  selectedId = null;
  localStorage.removeItem("bibi-planner");
  saveAll();
  renderDraft();
  welcome.style.display = "flex";
  appRoot.classList.add("is-hidden");
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addTask(taskTitle.value.trim(), Number(taskMinutes.value));
  taskDialog.close();
});

dayTrack.addEventListener("click", () => selectTask(null));

function renderDraft() {
  draftList.innerHTML = "";
  draftEmpty.style.display = draftTasks.length ? "none" : "block";
  enterBtn.disabled = !draftTasks.length;
  draftTasks.forEach((draft) => {
    const item = document.createElement("li");
    item.className = "task-item";
    item.innerHTML = `\n      <strong>${draft.title}</strong>\n      ${draft.minutes} min\n    `;
    const del = document.createElement("button");
    del.className = "draft-delete";
    del.type = "button";
    del.textContent = "Διαγραφή";
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      draftTasks = draftTasks.filter((t) => t.id !== draft.id);
      renderDraft();
    });
    item.appendChild(del);
    draftList.appendChild(item);
  });
}

renderDraft();

function renderScale() {
  const labels = [0, 6, 12, 18, 24];
  dayScale.innerHTML = "";
  labels.forEach((h) => {
    const tick = document.createElement("div");
    tick.className = `tick${h === 24 ? " end" : ""}`;
    tick.style.left = `${(h / 24) * 100}%`;
    tick.textContent = `${h.toString().padStart(2, "0")}:00`;
    dayScale.appendChild(tick);
  });
}

renderScale();

function initSupabase() {
  const url = window.__SUPABASE_URL__;
  const anon = window.__SUPABASE_ANON_KEY__;
  if (!url || !anon || !window.supabase) return null;
  return window.supabase.createClient(url, anon);
}

async function ensureProfile(user) {
  const identity = user.identities?.find((i) => i.provider === "discord");
  const discordId =
    identity?.identity_data?.id ||
    user.user_metadata?.sub ||
    user.user_metadata?.provider_id ||
    null;
  const discordUsername =
    identity?.identity_data?.full_name ||
    identity?.identity_data?.name ||
    user.user_metadata?.name ||
    null;

  if (!discordId) return;

  await supabaseClient
    .from("profiles")
    .upsert({ user_id: user.id, discord_id: discordId, discord_username: discordUsername });
}

function athensDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

async function loadFromDb() {
  if (!supabaseClient || !currentUser) return false;
  const today = athensDateKey();
  const { data: schedule } = await supabaseClient
    .from("schedules")
    .select("id, schedule_date, tasks:tasks(id,title,minutes,start_minute,color,preset_type,notify)")
    .eq("user_id", currentUser.id)
    .eq("schedule_date", today)
    .maybeSingle();

  if (!schedule) return true;
  tasks = (schedule.tasks || []).map((t) => ({
    id: t.id,
    title: t.title,
    minutes: t.minutes,
    start: t.start_minute,
    color: t.color,
    presetType: t.preset_type,
    notify: t.notify,
  }));
  return true;
}

async function saveToDb() {
  if (!supabaseClient || !currentUser) return;
  const today = athensDateKey();

  const { data: schedule, error: upsertError } = await supabaseClient
    .from("schedules")
    .upsert({ user_id: currentUser.id, schedule_date: today }, { onConflict: "user_id,schedule_date" })
    .select("id")
    .single();

  if (upsertError) {
    console.error("saveToDb upsert error:", upsertError);
    return;
  }

  await supabaseClient.from("tasks").delete().eq("schedule_id", schedule.id);

  if (tasks.length) {
    const rows = tasks.map((t) => ({
      schedule_id: schedule.id,
      title: t.title,
      minutes: t.minutes,
      start_minute: t.start,
      color: t.color,
      preset_type: t.presetType || null,
      notify: t.notify !== false,
    }));
    const { error: insertError } = await supabaseClient.from("tasks").insert(rows);
    if (insertError) {
      console.error("saveToDb insert error:", insertError);
    }
  }
}

function saveAll() {
  save();
  render();
  saveToDb();
}

loginBtn.addEventListener("click", async () => {
  if (!supabaseClient) return;
  await supabaseClient.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: `${window.location.origin}/planner` },
  });
});

(async () => {
  supabaseClient = initSupabase();
  if (supabaseClient) {
    const { data } = await supabaseClient.auth.getUser();
    currentUser = data.user || null;
    if (currentUser) {
      userBadge.textContent = currentUser.email || "Discord user";
      await ensureProfile(currentUser);
      await loadFromDb();
    }
  }

  if (!currentUser) {
    load();
  }

  render();
  if (tasks.length) {
    welcome.style.display = "none";
    appRoot.classList.remove("is-hidden");
  }
})();
