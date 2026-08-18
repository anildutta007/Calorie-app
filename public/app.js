// --- Profiles ---
const PROFILE_KEY = "calorie-app-profile";
let currentProfile = null; // {id, name}
let pendingProfile = null; // {id, name} awaiting PIN entry
let currentTargets = null; // {calories, protein_g, carbs_g, fat_g} | null - this profile's daily nutrition target

const appMain = document.getElementById("app-main");
const profileGate = document.getElementById("profile-gate");
const profileListStep = document.getElementById("profile-list-step");
const profileListEl = document.getElementById("profile-list");
const profileAddBtn = document.getElementById("profile-add-btn");
const profilePinStep = document.getElementById("profile-pin-step");
const profilePinName = document.getElementById("profile-pin-name");
const profilePinInput = document.getElementById("profile-pin-input");
const profilePinSubmit = document.getElementById("profile-pin-submit");
const profilePinBack = document.getElementById("profile-pin-back");
const profilePinError = document.getElementById("profile-pin-error");
const profileNewStep = document.getElementById("profile-new-step");
const profileNewName = document.getElementById("profile-new-name");
const profileNewPin = document.getElementById("profile-new-pin");
const profileNewPin2 = document.getElementById("profile-new-pin2");
const profileNewSubmit = document.getElementById("profile-new-submit");
const profileNewBack = document.getElementById("profile-new-back");
const profileNewError = document.getElementById("profile-new-error");
const currentProfileName = document.getElementById("current-profile-name");
const switchProfileBtn = document.getElementById("switch-profile-btn");

function profileHeaders(extra = {}) {
  return { ...extra, "X-Profile-Id": currentProfile ? String(currentProfile.id) : "" };
}

async function initProfileGate() {
  const saved = localStorage.getItem(PROFILE_KEY);
  if (saved) {
    try {
      currentProfile = JSON.parse(saved);
      enterApp();
      return;
    } catch (e) {
      localStorage.removeItem(PROFILE_KEY);
    }
  }
  await showProfileList();
}

async function showProfileList() {
  profileGate.style.display = "flex";
  appMain.style.display = "none";
  profilePinStep.style.display = "none";
  profileNewStep.style.display = "none";
  profileListStep.style.display = "block";
  const res = await fetch("/api/profiles");
  const data = await res.json();
  renderProfileList(data.profiles || []);
}

function renderProfileList(profiles) {
  if (!profiles.length) {
    profileListEl.innerHTML = `<div class="empty-state">No profiles yet — create the first one below.</div>`;
    return;
  }
  profileListEl.innerHTML = profiles
    .map((p) => `<button class="profile-btn" data-id="${p.id}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`)
    .join("");
  profileListEl.querySelectorAll(".profile-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      pendingProfile = { id: Number(btn.dataset.id), name: btn.dataset.name };
      showPinStep();
    });
  });
}

function showPinStep() {
  profileListStep.style.display = "none";
  profilePinStep.style.display = "block";
  profilePinName.textContent = `Enter PIN for ${pendingProfile.name}`;
  profilePinInput.value = "";
  profilePinError.style.display = "none";
  profilePinInput.focus();
}

profilePinBack.addEventListener("click", showProfileList);
profilePinSubmit.addEventListener("click", submitPin);
profilePinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitPin();
});

async function submitPin() {
  const pin = profilePinInput.value.trim();
  if (!/^\d{4}$/.test(pin)) {
    profilePinError.textContent = "PIN must be 4 digits.";
    profilePinError.style.display = "block";
    return;
  }
  setBusy(profilePinSubmit, true, "Checking...");
  try {
    const res = await fetch(`/api/profiles/${pendingProfile.id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Incorrect PIN.");
    currentProfile = { id: data.id, name: data.name };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(currentProfile));
    enterApp();
  } catch (err) {
    profilePinError.textContent = err.message;
    profilePinError.style.display = "block";
  } finally {
    setBusy(profilePinSubmit, false, "Enter");
  }
}

profileAddBtn.addEventListener("click", () => {
  profileListStep.style.display = "none";
  profileNewStep.style.display = "block";
  profileNewName.value = "";
  profileNewPin.value = "";
  profileNewPin2.value = "";
  profileNewError.style.display = "none";
  profileNewName.focus();
});

profileNewBack.addEventListener("click", showProfileList);

profileNewSubmit.addEventListener("click", async () => {
  const name = profileNewName.value.trim();
  const pin = profileNewPin.value.trim();
  const pin2 = profileNewPin2.value.trim();
  if (!name) return showNewError("Enter a name.");
  if (!/^\d{4}$/.test(pin)) return showNewError("PIN must be exactly 4 digits.");
  if (pin !== pin2) return showNewError("PINs don't match.");

  setBusy(profileNewSubmit, true, "Creating...");
  try {
    const res = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, pin }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create profile.");
    currentProfile = { id: data.id, name: data.name };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(currentProfile));
    enterApp();
  } catch (err) {
    showNewError(err.message);
  } finally {
    setBusy(profileNewSubmit, false, "Create profile");
  }
});

function showNewError(msg) {
  profileNewError.textContent = msg;
  profileNewError.style.display = "block";
}

function enterApp() {
  profileGate.style.display = "none";
  appMain.style.display = "block";
  currentProfileName.textContent = currentProfile.name;
  Promise.all([loadBio(), loadTargets()]).then(loadToday);
}

switchProfileBtn.addEventListener("click", () => {
  localStorage.removeItem(PROFILE_KEY);
  currentProfile = null;
  currentBio = null;
  currentTargets = null;
  showProfileList();
});

// --- Tab switching ---
const tabButtons = document.querySelectorAll(".tab-btn");
const tabs = document.querySelectorAll(".tab");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    tabs.forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "today") loadToday();
    if (btn.dataset.tab === "history") loadHistory();
    if (btn.dataset.tab === "plan") loadMealPlan();
    if (btn.dataset.tab === "target") {
      loadBio();
      loadTargets();
    }
    if (btn.dataset.tab === "progress") loadProgress();
  });
});

// --- Voice input (Web Speech API) ---
const micBtn = document.getElementById("mic-btn");
const micStatus = document.getElementById("mic-status");
const voiceText = document.getElementById("voice-text");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recording = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  let finalTranscript = "";

  recognition.onstart = () => {
    finalTranscript = voiceText.value ? voiceText.value + " " : "";
    micStatus.textContent = "Listening...";
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalTranscript += transcript + " ";
      else interim += transcript;
    }
    voiceText.value = (finalTranscript + interim).trim();
  };

  recognition.onerror = (event) => {
    micStatus.textContent = `Mic error: ${event.error}`;
    stopRecording();
  };

  recognition.onend = () => {
    if (recording) stopRecording();
  };

  micBtn.addEventListener("click", () => {
    if (recording) stopRecording();
    else startRecording();
  });
} else {
  micBtn.disabled = true;
  micStatus.textContent = "Voice input isn't supported in this browser — try Chrome, or just type below.";
}

function startRecording() {
  recording = true;
  micBtn.textContent = "⏹ Stop";
  micBtn.classList.add("recording");
  recognition.start();
}

function stopRecording() {
  recording = false;
  micBtn.textContent = "🎤 Start speaking";
  micBtn.classList.remove("recording");
  micStatus.textContent = "";
  try { recognition.stop(); } catch (e) {}
}

// --- Text analysis ---
const analyzeTextBtn = document.getElementById("analyze-text-btn");
analyzeTextBtn.addEventListener("click", async () => {
  const text = voiceText.value.trim();
  if (!text) return;
  setBusy(analyzeTextBtn, true, "Analyzing...");
  try {
    const res = await fetch("/api/meals/text", {
      method: "POST",
      headers: profileHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to analyze.");
    showResult(data);
    voiceText.value = "";
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(analyzeTextBtn, false, "Analyze & Log");
  }
});

// --- Photo analysis ---
const photoInput = document.getElementById("photo-input");
const photoPreview = document.getElementById("photo-preview");
const analyzePhotoBtn = document.getElementById("analyze-photo-btn");
const photoCaption = document.getElementById("photo-caption");
let selectedFile = null;

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (!file) return;
  selectedFile = file;
  photoPreview.src = URL.createObjectURL(file);
  photoPreview.style.display = "block";
  analyzePhotoBtn.disabled = false;
});

// Phone camera photos are often 3-10MB (and sometimes HEIC on iPhone), which
// can exceed the hosting platform's request-body size limit and fail with a
// generic network error before the request even reaches the server - and
// HEIC isn't a format Claude's vision API accepts anyway. Downscaling to a
// JPEG client-side fixes both, and uploads faster besides.
async function resizeImageForUpload(file, maxDim = 1600, quality = 0.85) {
  if (file.size < 1.5 * 1024 * 1024) return file; // already small enough, don't bother
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob || file;
  } catch (e) {
    return file; // if resizing fails for any reason, fall back to the original file
  }
}

analyzePhotoBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  setBusy(analyzePhotoBtn, true, "Preparing photo...");
  try {
    const uploadFile = await resizeImageForUpload(selectedFile);
    setBusy(analyzePhotoBtn, true, "Analyzing...");
    const formData = new FormData();
    formData.append("photo", uploadFile, "photo.jpg");
    formData.append("caption", photoCaption.value.trim());
    const res = await fetch("/api/meals/photo", { method: "POST", headers: profileHeaders(), body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to analyze.");
    showResult(data);
    photoInput.value = "";
    photoCaption.value = "";
    photoPreview.style.display = "none";
    selectedFile = null;
    analyzePhotoBtn.disabled = true;
  } catch (err) {
    showError(err.message || "Upload failed - try a smaller photo or check your connection.");
  } finally {
    setBusy(analyzePhotoBtn, false, "Analyze & Log");
  }
});

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  btn.textContent = label;
}

// --- Result rendering ---
const resultCard = document.getElementById("result-card");

function showResult(meal) {
  resultCard.style.display = "block";
  resultCard.innerHTML = `
    <h3>${escapeHtml(meal.description)}</h3>
    ${renderFlags(meal.portion_flags)}
    ${renderItems(meal.items)}
    <div class="totals-grid" style="margin-top:12px">
      ${statBlock(Math.round(meal.calories), "kcal")}
      ${statBlock(round1(meal.protein_g), "protein g")}
      ${statBlock(round1(meal.carbs_g), "carbs g")}
      ${statBlock(round1(meal.fat_g), "fat g")}
    </div>
  `;
}

function showError(message) {
  resultCard.style.display = "block";
  resultCard.innerHTML = `<div class="flag over">⚠️ ${escapeHtml(message)}</div>`;
}

function renderItems(items) {
  return items
    .map(
      (it) => `
    <div class="item-row">
      <div>
        <div class="item-name">${escapeHtml(it.name)}</div>
        <div class="item-portion">${escapeHtml(it.portion_desc)} · ~${Math.round(it.grams)}g</div>
      </div>
      <div class="item-macros">
        ${Math.round(it.calories)} kcal<br/>
        P${round1(it.protein_g)} C${round1(it.carbs_g)} F${round1(it.fat_g)}
      </div>
    </div>`
    )
    .join("");
}

function renderFlags(flags) {
  if (!flags || flags.length === 0) return "";
  return flags
    .map((f) => {
      if (f.status === "over") {
        return `<div class="flag over">⚠️ ${cap(f.food)} portion looks large: ~${Math.round(f.estimated_grams)}g vs a standard ~${f.standard_grams}g serving. ${f.note}</div>`;
      }
      if (f.status === "under") {
        return `<div class="flag under">ℹ️ ${cap(f.food)} portion is smaller than standard (~${Math.round(f.estimated_grams)}g vs ~${f.standard_grams}g). That's fine if intentional.</div>`;
      }
      return "";
    })
    .join("");
}

function statBlock(value, label) {
  return `<div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

function round1(n) {
  return Math.round((n || 0) * 10) / 10;
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// --- Daily targets ---
const targetDisplay = document.getElementById("target-display");
const targetForm = document.getElementById("target-form");
const editTargetBtn = document.getElementById("edit-target-btn");
const cancelTargetBtn = document.getElementById("cancel-target-btn");
const saveTargetBtn = document.getElementById("save-target-btn");
const targetFormError = document.getElementById("target-form-error");
const targetCaloriesInput = document.getElementById("target-calories");
const targetProteinInput = document.getElementById("target-protein");
const targetCarbsInput = document.getElementById("target-carbs");
const targetFatInput = document.getElementById("target-fat");

// --- Target calculator (BMR/TDEE from age/sex/weight/height/activity) ---
let currentBio = null; // {age, sex, weight_kg, height_cm, activity} | null - saved so it doesn't need re-entering
let selectedSex = "male";
const sexButtons = document.querySelectorAll(".sex-btn");
const calcAgeInput = document.getElementById("calc-age");
const calcWeightInput = document.getElementById("calc-weight");
const calcHeightInput = document.getElementById("calc-height");
const calcActivitySelect = document.getElementById("calc-activity");
const calcTargetBtn = document.getElementById("calc-target-btn");
const calcStatus = document.getElementById("calc-status");

sexButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    sexButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedSex = btn.dataset.sex;
  });
});

async function loadBio() {
  const res = await fetch("/api/profile/bio", { headers: profileHeaders() });
  const data = await res.json();
  currentBio = data.bio;
}

function applyBioToCalcForm() {
  calcAgeInput.value = currentBio?.age ?? "";
  calcWeightInput.value = currentBio?.weight_kg ?? "";
  calcHeightInput.value = currentBio?.height_cm ?? "";
  calcActivitySelect.value = currentBio?.activity || "light";
  selectedSex = currentBio?.sex || "male";
  sexButtons.forEach((b) => b.classList.toggle("active", b.dataset.sex === selectedSex));
}

calcTargetBtn.addEventListener("click", async () => {
  calcStatus.textContent = "";
  setBusy(calcTargetBtn, true, "Calculating...");
  try {
    const res = await fetch("/api/profile/targets/calculate", {
      method: "POST",
      headers: profileHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        age: calcAgeInput.value,
        sex: selectedSex,
        weight_kg: calcWeightInput.value,
        height_cm: calcHeightInput.value,
        activity: calcActivitySelect.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to calculate.");
    targetCaloriesInput.value = data.suggested.calories;
    targetProteinInput.value = data.suggested.protein_g;
    targetCarbsInput.value = data.suggested.carbs_g;
    targetFatInput.value = data.suggested.fat_g;
    // Keep in-memory bio in sync so reopening Edit later this session shows
    // what was just entered, without needing a full page reload to refetch it.
    currentBio = {
      age: Number(calcAgeInput.value),
      sex: selectedSex,
      weight_kg: Number(calcWeightInput.value),
      height_cm: Number(calcHeightInput.value),
      activity: calcActivitySelect.value,
    };
    calcStatus.textContent = "Suggested target filled in below - review and Save Target to apply it.";
  } catch (err) {
    calcStatus.textContent = err.message;
  } finally {
    setBusy(calcTargetBtn, false, "📐 Calculate My Target");
  }
});

async function loadTargets() {
  const res = await fetch("/api/profile/targets", { headers: profileHeaders() });
  const data = await res.json();
  currentTargets = data.targets;
  renderTargetDisplay();
}

function renderTargetDisplay() {
  targetForm.style.display = "none";
  targetDisplay.style.display = "block";
  if (currentTargets && currentTargets.calories) {
    const bits = [`${Math.round(currentTargets.calories)} kcal`];
    if (currentTargets.protein_g) bits.push(`${Math.round(currentTargets.protein_g)}g protein`);
    if (currentTargets.carbs_g) bits.push(`${Math.round(currentTargets.carbs_g)}g carbs`);
    if (currentTargets.fat_g) bits.push(`${Math.round(currentTargets.fat_g)}g fat`);
    targetDisplay.textContent = bits.join(" · ");
  } else {
    targetDisplay.textContent = "No daily target set yet.";
  }
}

editTargetBtn.addEventListener("click", () => {
  targetDisplay.style.display = "none";
  targetForm.style.display = "block";
  targetFormError.style.display = "none";
  calcStatus.textContent = "";
  targetCaloriesInput.value = currentTargets?.calories ?? "";
  targetProteinInput.value = currentTargets?.protein_g ?? "";
  targetCarbsInput.value = currentTargets?.carbs_g ?? "";
  targetFatInput.value = currentTargets?.fat_g ?? "";
  applyBioToCalcForm();
});

cancelTargetBtn.addEventListener("click", renderTargetDisplay);

saveTargetBtn.addEventListener("click", async () => {
  setBusy(saveTargetBtn, true, "Saving...");
  targetFormError.style.display = "none";
  try {
    const res = await fetch("/api/profile/targets", {
      method: "PUT",
      headers: profileHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        calories: targetCaloriesInput.value,
        protein_g: targetProteinInput.value,
        carbs_g: targetCarbsInput.value,
        fat_g: targetFatInput.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save target.");
    currentTargets = data.targets;
    renderTargetDisplay();
    loadToday();
    loadHistory();
  } catch (err) {
    targetFormError.textContent = err.message;
    targetFormError.style.display = "block";
  } finally {
    setBusy(saveTargetBtn, false, "Save Target");
  }
});

// mode "ceiling" = don't exceed the target (calories/carbs/fat): at/under is good.
// mode "floor" = meet or beat the target (protein): at/over is good.
function macroStatus(value, target, mode) {
  if (!target) return null;
  const ratio = value / target;
  if (mode === "floor") {
    if (ratio >= 1) return "good";
    if (ratio >= 0.8) return "warn";
    return "bad";
  }
  if (ratio <= 1) return "good";
  if (ratio <= 1.1) return "warn";
  return "bad";
}

function statNote(value, target, mode) {
  if (!target) return "";
  const diff = target - value;
  if (mode === "floor") return diff <= 0 ? "Goal met" : `${round1(diff)} to go`;
  return diff >= 0 ? `${Math.round(diff)} left` : `${Math.round(-diff)} over`;
}

function daySummaryLine(total) {
  if (!currentTargets || !currentTargets.calories) return "";
  const parts = [];
  const calDiff = currentTargets.calories - total.calories;
  parts.push(calDiff >= 0 ? `${Math.round(calDiff)} kcal remaining` : `${Math.round(-calDiff)} kcal over target`);
  if (currentTargets.protein_g) {
    const proteinDiff = currentTargets.protein_g - total.protein_g;
    parts.push(proteinDiff <= 0 ? "protein goal met" : `${round1(proteinDiff)}g more protein needed`);
  }
  return parts.join(" · ");
}

// --- Today tab ---
async function loadToday() {
  const res = await fetch("/api/meals", { headers: profileHeaders() });
  const data = await res.json();
  renderTotals(document.getElementById("today-totals"), data.total, document.getElementById("today-summary"));
  renderMealList(document.getElementById("today-list"), data.meals, true);
  renderAllFlags(document.getElementById("today-flags"), data.meals);
}

function renderAllFlags(container, meals) {
  const flags = meals.flatMap((m) => m.portion_flags || []);
  container.innerHTML = flags.length ? renderFlags(flags) : "";
}

// Today/History show the 4 daily totals as a big calorie progress bar plus
// a row of 3 mini bars for carbs/fat/protein - other totals displays (meal
// cards, Log Meal result, Meal Plan days) are untouched and keep the grid.
function renderTotals(container, total, summaryEl) {
  const calories = { value: Math.round(total.calories), target: currentTargets?.calories, mode: "ceiling", label: "Calories", unit: " cal" };
  const minis = [
    { value: round1(total.carbs_g), target: currentTargets?.carbs_g, mode: "ceiling", label: "Carbs", unit: "g" },
    { value: round1(total.fat_g), target: currentTargets?.fat_g, mode: "ceiling", label: "Fat", unit: "g" },
    { value: round1(total.protein_g), target: currentTargets?.protein_g, mode: "floor", label: "Protein", unit: "g" },
  ];

  container.innerHTML = `
    <div class="stat-hero">
      <div class="stat-hero-label">${calories.label}</div>
      <div class="stat-hero-row">
        <div class="stat-hero-value">${fmt(calories.value)}${calories.unit}${
    calories.target ? `<span class="stat-hero-of"> / ${fmt(Math.round(calories.target))}</span>` : ""
  }</div>
        ${heroRemainingHtml(calories)}
      </div>
      ${barHtml(calories)}
    </div>
    <div class="stat-mini-row">
      ${minis.map(miniStatHtml).join("")}
    </div>
  `;

  if (summaryEl) {
    const line = daySummaryLine(total);
    summaryEl.textContent = line;
    summaryEl.style.display = line ? "block" : "none";
  }
}

function fmt(n) {
  return n.toLocaleString();
}

function barPercent(stat) {
  if (!stat.target) return 0;
  return Math.max(0, Math.min(100, (stat.value / stat.target) * 100));
}

function barHtml(stat, thin) {
  const status = macroStatus(stat.value, stat.target, stat.mode) || "good";
  return `<div class="stat-bar-track${thin ? " thin" : ""}"><div class="stat-bar-fill stat-${status}" style="width:${barPercent(stat)}%"></div></div>`;
}

function heroRemainingHtml(stat) {
  if (!stat.target) return "";
  const diff = stat.target - stat.value;
  if (stat.mode === "floor") {
    if (diff <= 0) return `<div class="stat-hero-remaining">Goal met</div>`;
    return `<div class="stat-hero-remaining"><strong>${fmt(round1(diff))}</strong> to go</div>`;
  }
  if (diff >= 0) return `<div class="stat-hero-remaining"><strong>${fmt(Math.round(diff))}</strong> left</div>`;
  return `<div class="stat-hero-remaining"><strong>${fmt(Math.round(-diff))}</strong> over</div>`;
}

function miniStatHtml(stat) {
  return `
    <div class="stat-mini">
      <div class="stat-mini-label">${stat.label}</div>
      <div class="stat-mini-value">${fmt(stat.value)}${stat.unit}${
    stat.target ? `<span class="stat-mini-of"> / ${fmt(Math.round(stat.target))}</span>` : ""
  }</div>
      ${barHtml(stat, true)}
    </div>`;
}

let mealsById = {}; // last-rendered meals, keyed by id, so Edit can look up full item data without refetching

function renderMealList(container, meals, showEdit) {
  meals.forEach((m) => (mealsById[m.id] = m));

  if (!meals.length) {
    container.innerHTML = `<div class="empty-state">No meals logged yet.</div>`;
    return;
  }
  container.innerHTML = meals
    .map((m) => {
      const loggedAt = new Date(m.created_at);
      const dateStr = loggedAt.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
      const timeStr = loggedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `
      <div class="meal-card">
        <div class="meal-card-header">
          <h3>${escapeHtml(m.description)}</h3>
          <div class="meal-card-actions">
            ${showEdit ? `<button class="edit-btn" data-id="${m.id}">Edit</button>` : ""}
            <button class="delete-btn" data-id="${m.id}">Delete</button>
          </div>
        </div>
        <div class="meal-time">${dateStr} · ${timeStr} · ${m.source}</div>
        ${renderItems(m.items)}
        <div class="totals-grid" style="margin-top:8px">
          ${statBlock(Math.round(m.calories), "kcal")}
          ${statBlock(round1(m.protein_g), "protein g")}
          ${statBlock(round1(m.carbs_g), "carbs g")}
          ${statBlock(round1(m.fat_g), "fat g")}
        </div>
      </div>`;
    })
    .join("");

  container.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/meals/${btn.dataset.id}`, { method: "DELETE", headers: profileHeaders() });
      loadToday();
      loadHistory();
    });
  });

  container.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => openEditMealModal(mealsById[btn.dataset.id]));
  });
}

// --- History tab ---
const historyDateInput = document.getElementById("history-date");
historyDateInput.addEventListener("change", loadHistory);

async function loadHistory() {
  if (!historyDateInput.value) {
    historyDateInput.value = new Date().toISOString().slice(0, 10);
  }
  const date = historyDateInput.value;
  const res = await fetch(`/api/meals?date=${date}`, { headers: profileHeaders() });
  const data = await res.json();
  renderTotals(document.getElementById("history-totals"), data.total, document.getElementById("history-summary"));
  renderMealList(document.getElementById("history-list"), data.meals);
}

// --- Edit meal modal (Today tab only) ---
const editMealModal = document.getElementById("edit-meal-modal");
const editMealDescriptionInput = document.getElementById("edit-meal-description");
const editMealItemsContainer = document.getElementById("edit-meal-items");
const editMealAddItemBtn = document.getElementById("edit-meal-add-item-btn");
const editMealSaveBtn = document.getElementById("edit-meal-save-btn");
const editMealError = document.getElementById("edit-meal-error");
let editingMealId = null;

document.getElementById("edit-meal-modal-close").addEventListener("click", () => {
  editMealModal.style.display = "none";
});
editMealModal.addEventListener("click", (e) => {
  if (e.target === editMealModal) editMealModal.style.display = "none";
});

function openEditMealModal(meal) {
  if (!meal) return;
  editingMealId = meal.id;
  editMealError.style.display = "none";
  editMealDescriptionInput.value = meal.description;
  editMealItemsContainer.innerHTML = "";
  meal.items.forEach((it) => editMealItemsContainer.appendChild(buildEditItemRow(it)));
  editMealModal.style.display = "flex";
}

// Only name/portion/grams are editable - calories/protein/carbs/fat are
// always recalculated server-side from those, never hand-entered here.
function buildEditItemRow(item) {
  const row = document.createElement("div");
  row.className = "edit-item-row";
  row.innerHTML = `
    <label>Name</label>
    <input type="text" class="edit-item-name" value="${escapeHtml(item?.name || "")}" placeholder="e.g. Grilled chicken" />
    <label>Portion</label>
    <input type="text" class="edit-item-portion" value="${escapeHtml(item?.portion_desc || "")}" placeholder="e.g. 1 cup" />
    <label>Grams</label>
    <input type="number" class="edit-item-grams" value="${item?.grams ?? ""}" min="0" />
    <button type="button" class="edit-item-remove">Remove item</button>
  `;
  row.querySelector(".edit-item-remove").addEventListener("click", () => row.remove());
  return row;
}

editMealAddItemBtn.addEventListener("click", () => {
  editMealItemsContainer.appendChild(buildEditItemRow(null));
});

editMealSaveBtn.addEventListener("click", async () => {
  editMealError.style.display = "none";
  const description = editMealDescriptionInput.value.trim();
  if (!description) {
    editMealError.textContent = "Enter a description.";
    editMealError.style.display = "block";
    return;
  }

  const items = Array.from(editMealItemsContainer.querySelectorAll(".edit-item-row"))
    .map((row) => ({
      name: row.querySelector(".edit-item-name").value.trim(),
      portion_desc: row.querySelector(".edit-item-portion").value.trim(),
      grams: row.querySelector(".edit-item-grams").value,
    }))
    .filter((it) => it.name);

  if (!items.length) {
    editMealError.textContent = "Add at least one item with a name.";
    editMealError.style.display = "block";
    return;
  }

  setBusy(editMealSaveBtn, true, "Recalculating nutrition...");
  try {
    const res = await fetch(`/api/meals/${editingMealId}`, {
      method: "PUT",
      headers: profileHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ description, items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save changes.");
    editMealModal.style.display = "none";
    loadToday();
    loadHistory();
  } catch (err) {
    editMealError.textContent = err.message;
    editMealError.style.display = "block";
  } finally {
    setBusy(editMealSaveBtn, false, "Save Changes");
  }
});

// --- Meal Plan tab ---
const planDaysSelect = document.getElementById("plan-days");
const planCaloriesInput = document.getElementById("plan-calories");
const planProteinInput = document.getElementById("plan-protein");
const dietButtons = document.querySelectorAll(".diet-btn");
const vegOptions = document.getElementById("veg-options");
const nonvegOptions = document.getElementById("nonveg-options");
const generatePlanBtn = document.getElementById("generate-plan-btn");
const planStatus = document.getElementById("plan-status");
const planResult = document.getElementById("plan-result");
let selectedDiet = "veg";
let currentMealPlan = null; // the plan object currently rendered, needed for PDF export
let currentRecipes = null; // { [dishName]: {serves, prep_time_min, cook_time_min, ingredients, steps, image_url} } | null
let planDishNames = []; // index-addressed list rebuilt on each render, so recipe-link buttons never need to embed dish names in HTML attributes

function showDietOptions(diet) {
  vegOptions.style.display = diet === "veg" ? "grid" : "none";
  nonvegOptions.style.display = diet === "non-veg" ? "grid" : "none";
}

const VEG_DEFAULT_PROTEINS = []; // strict vegetarian by default
const NONVEG_DEFAULT_PROTEINS = ["chicken", "fish", "egg", "mutton"]; // pork/beef opt-in

function activePanel() {
  return selectedDiet === "veg" ? vegOptions : nonvegOptions;
}

function getCheckedProteins() {
  return Array.from(activePanel().querySelectorAll(".protein-check"))
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
}

// Scoped to one panel only — veg and non-veg panels share checkbox values
// (egg, fish), so checking both from a single shared list would leak state
// between them (e.g. a non-veg default including "fish" would also tick the
// vegetarian panel's "fish" checkbox).
function setPanelProteins(panel, list) {
  const included = new Set(list || []);
  panel.querySelectorAll(".protein-check").forEach((cb) => {
    cb.checked = included.has(cb.value);
  });
}

function resetProteinPanelsToDefaults() {
  setPanelProteins(vegOptions, VEG_DEFAULT_PROTEINS);
  setPanelProteins(nonvegOptions, NONVEG_DEFAULT_PROTEINS);
}

dietButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    dietButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedDiet = btn.dataset.diet;
    showDietOptions(selectedDiet);
  });
});
showDietOptions(selectedDiet);

generatePlanBtn.addEventListener("click", async () => {
  const calories = Number(planCaloriesInput.value);
  const protein_g = Number(planProteinInput.value);
  planStatus.textContent = "";
  if (!calories || calories < 800 || calories > 6000) {
    planStatus.textContent = "Enter a calorie target between 800 and 6000.";
    return;
  }
  if (!protein_g || protein_g < 10 || protein_g > 400) {
    planStatus.textContent = "Enter a protein target between 10 and 400 grams.";
    return;
  }

  const days = Number(planDaysSelect.value) || 7;
  setBusy(generatePlanBtn, true, `Generating ${days}-day plan... (can take ~30-60s)`);
  try {
    const res = await fetch("/api/meal-plan", {
      method: "POST",
      headers: profileHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ calories, protein_g, diet: selectedDiet, included_proteins: getCheckedProteins(), days }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to generate plan.");
    applyMealPlan(data.mealPlan);
  } catch (err) {
    planStatus.textContent = err.message;
  } finally {
    setBusy(generatePlanBtn, false, "Generate Plan");
  }
});

async function loadMealPlan() {
  const res = await fetch("/api/meal-plan", { headers: profileHeaders() });
  const data = await res.json();
  if (data.mealPlan) {
    applyMealPlan(data.mealPlan);
  } else {
    resetMealPlanUI();
  }
}

const planTargetHint = document.getElementById("plan-target-hint");

function resetMealPlanUI() {
  planDaysSelect.value = "7";
  // Default from the saved Daily Target when there's no plan-specific value
  // yet, so the two stay in sync unless someone deliberately overrides it here.
  if (currentTargets && currentTargets.calories) {
    planCaloriesInput.value = currentTargets.calories;
    planProteinInput.value = currentTargets.protein_g ?? "";
    planTargetHint.textContent = "Prefilled from your Daily Target — edit below, or change the source on the Target tab.";
    planTargetHint.style.display = "block";
  } else {
    planCaloriesInput.value = "";
    planProteinInput.value = "";
    planTargetHint.style.display = "none";
  }
  dietButtons.forEach((b) => b.classList.toggle("active", b.dataset.diet === "veg"));
  selectedDiet = "veg";
  showDietOptions(selectedDiet);
  resetProteinPanelsToDefaults();
  currentMealPlan = null;
  currentRecipes = null;
  planStatus.textContent = "";
  planResult.innerHTML = `<div class="empty-state">No plan yet — set your targets above and generate one.</div>`;
}

function applyMealPlan(mealPlan) {
  planDaysSelect.value = String(Math.min(Math.max(mealPlan.days.length || 7, 1), 7));
  planCaloriesInput.value = mealPlan.calorie_target;
  planProteinInput.value = mealPlan.protein_target;
  planTargetHint.style.display = "none"; // showing this plan's own saved target, not the daily target
  dietButtons.forEach((b) => b.classList.toggle("active", b.dataset.diet === mealPlan.diet));
  selectedDiet = mealPlan.diet;
  showDietOptions(selectedDiet);
  resetProteinPanelsToDefaults();
  setPanelProteins(activePanel(), mealPlan.included_proteins);
  currentMealPlan = mealPlan;
  currentRecipes = mealPlan.recipes || null; // reuse if the server already generated/cached them
  renderMealPlan(mealPlan);
}

function renderMealPlan(mealPlan) {
  planDishNames = []; // rebuilt fresh so recipe-link data-idx stays in sync with this render
  const dietLabel = mealPlan.diet === "veg" ? "Vegetarian" : "Non-Vegetarian";
  const proteins = mealPlan.included_proteins || [];
  const proteinLabel = proteins.length ? ` (+ ${proteins.map(cap).join(", ")})` : mealPlan.diet === "veg" ? " (strict)" : "";
  planResult.innerHTML = `
    <div class="card">
      <div class="muted">Target: ${Math.round(mealPlan.calorie_target)} kcal · ${Math.round(mealPlan.protein_target)}g protein · ${dietLabel}${proteinLabel}</div>
      ${mealPlan.summary ? `<p style="margin-bottom:0">${escapeHtml(mealPlan.summary)}</p>` : ""}
      <button id="download-pdf-btn" class="secondary-btn" type="button">📄 Download / Print PDF</button>
      <div id="pdf-status" class="muted"></div>
    </div>
    ${mealPlan.days.map(renderPlanDay).join("")}
  `;
}

function renderPlanDay(day) {
  return `
    <div class="card">
      <div class="plan-day-header">
        <h3>${escapeHtml(day.day_label || `Day ${day.day_number}`)}</h3>
      </div>
      ${day.meals.map(renderPlanMeal).join("")}
      <div class="totals-grid" style="margin-top:8px">
        ${statBlock(Math.round(day.day_totals.calories), "kcal")}
        ${statBlock(round1(day.day_totals.protein_g), "protein g")}
        ${statBlock(round1(day.day_totals.carbs_g), "carbs g")}
        ${statBlock(round1(day.day_totals.fat_g), "fat g")}
      </div>
    </div>`;
}

function renderPlanMeal(meal) {
  return `
    <div class="plan-meal">
      <div class="plan-meal-type">${cap(meal.meal_type)}</div>
      ${renderPlanItems(meal.items)}
    </div>`;
}

// Like renderItems, but each dish name is a clickable "how to cook" link.
// Names are looked up by index (planDishNames) rather than embedded in a
// data-* attribute, so no HTML-attribute-escaping edge cases to worry about.
function renderPlanItems(items) {
  return items
    .map((it) => {
      const idx = planDishNames.length;
      planDishNames.push(it.name);
      return `
    <div class="item-row">
      <div>
        <div class="item-name">
          <button class="recipe-link" data-idx="${idx}" type="button">${escapeHtml(it.name)} <span class="recipe-icon">🍳</span></button>
        </div>
        <div class="item-portion">${escapeHtml(it.portion_desc)} · ~${Math.round(it.grams)}g</div>
      </div>
      <div class="item-macros">
        ${Math.round(it.calories)} kcal<br/>
        P${round1(it.protein_g)} C${round1(it.carbs_g)} F${round1(it.fat_g)}
      </div>
    </div>`;
    })
    .join("");
}

// Recipe-link clicks and the Download PDF button are both inside dynamically
// rebuilt HTML, so a single delegated listener on the stable container
// handles them instead of re-binding after every render.
planResult.addEventListener("click", (e) => {
  const recipeBtn = e.target.closest(".recipe-link");
  if (recipeBtn) {
    openRecipeModal(planDishNames[Number(recipeBtn.dataset.idx)]);
    return;
  }
  const pdfBtn = e.target.closest("#download-pdf-btn");
  if (pdfBtn) downloadPlanPdf(pdfBtn);
});

// --- Recipe modal ---
const recipeModal = document.getElementById("recipe-modal");
const recipeModalBody = document.getElementById("recipe-modal-body");

document.getElementById("recipe-modal-close").addEventListener("click", () => {
  recipeModal.style.display = "none";
});
recipeModal.addEventListener("click", (e) => {
  if (e.target === recipeModal) recipeModal.style.display = "none";
});

async function ensureRecipesLoaded() {
  if (currentRecipes) return currentRecipes;
  const res = await fetch("/api/meal-plan/recipes", {
    method: "POST",
    headers: profileHeaders({ "Content-Type": "application/json" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load recipes.");
  currentRecipes = data.recipes;
  return currentRecipes;
}

async function openRecipeModal(dishName) {
  recipeModal.style.display = "flex";
  recipeModalBody.innerHTML = `<h2>${escapeHtml(dishName)}</h2><div class="muted">Loading recipe... (first time for a plan can take ~30-60s since every dish is fetched at once)</div>`;
  try {
    const recipes = await ensureRecipesLoaded();
    renderRecipeModalBody(dishName, recipes[dishName]);
  } catch (err) {
    recipeModalBody.innerHTML = `<h2>${escapeHtml(dishName)}</h2><div class="flag over">⚠️ ${escapeHtml(err.message)}</div>`;
  }
}

function renderRecipeModalBody(dishName, recipe) {
  if (!recipe || !recipe.available) {
    recipeModalBody.innerHTML = `<h2>${escapeHtml(dishName)}</h2><div class="empty-state">Recipe not available for this dish.</div>`;
    return;
  }
  recipeModalBody.innerHTML = `<h2>${escapeHtml(dishName)}</h2>${recipeContentHtml(recipe)}`;
}

function recipeContentHtml(recipe) {
  const imageHtml = recipe.image_url
    ? `<img src="${escapeHtml(recipe.image_url)}" class="recipe-photo" alt="" />`
    : `<div class="recipe-photo-fallback">🍽️</div>`;
  const metaBits = [];
  if (recipe.serves) metaBits.push(`Serves ${recipe.serves}`);
  if (recipe.prep_time_min) metaBits.push(`Prep ${recipe.prep_time_min} min`);
  if (recipe.cook_time_min) metaBits.push(`Cook ${recipe.cook_time_min} min`);

  return `
    ${imageHtml}
    ${metaBits.length ? `<div class="muted" style="margin-bottom:12px">${metaBits.join(" · ")}</div>` : ""}
    <h3>Ingredients</h3>
    <ul class="recipe-list">${recipe.ingredients.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
    <h3>Steps</h3>
    <ol class="recipe-list">${recipe.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
  `;
}

// --- PDF export (browser print-to-PDF on a dedicated print-only view) ---
async function downloadPlanPdf(btn) {
  const statusEl = document.getElementById("pdf-status");
  setBusy(btn, true, "Preparing...");
  if (statusEl) statusEl.textContent = "Loading recipes for every dish (first time only, can take ~30-60s)...";
  try {
    const recipes = await ensureRecipesLoaded();
    buildPrintView(currentMealPlan, recipes);
    if (statusEl) statusEl.textContent = "";
    window.print();
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message;
  } finally {
    setBusy(btn, false, "📄 Download / Print PDF");
  }
}

function buildPrintView(mealPlan, recipes) {
  const dietLabel = mealPlan.diet === "veg" ? "Vegetarian" : "Non-Vegetarian";
  const proteins = mealPlan.included_proteins || [];
  const proteinLabel = proteins.length ? ` (+ ${proteins.map(cap).join(", ")})` : mealPlan.diet === "veg" ? " (strict)" : "";

  const daysHtml = mealPlan.days
    .map(
      (day) => `
    <div class="print-day">
      <h2>${escapeHtml(day.day_label || `Day ${day.day_number}`)}</h2>
      ${day.meals
        .map(
          (meal) => `
        <h3>${escapeHtml(cap(meal.meal_type))}</h3>
        ${meal.items.map((it) => renderPrintItem(it, recipes[it.name])).join("")}
      `
        )
        .join("")}
      <div class="print-day-totals">
        Day total: ${Math.round(day.day_totals.calories)} kcal · ${round1(day.day_totals.protein_g)}g protein · ${round1(day.day_totals.carbs_g)}g carbs · ${round1(day.day_totals.fat_g)}g fat
      </div>
    </div>`
    )
    .join("");

  document.getElementById("print-view").innerHTML = `
    <h1>🍽️ 7-Day Indian Meal Plan</h1>
    <div class="print-meta">Target: ${Math.round(mealPlan.calorie_target)} kcal · ${Math.round(mealPlan.protein_target)}g protein/day · ${dietLabel}${proteinLabel}</div>
    ${mealPlan.summary ? `<p>${escapeHtml(mealPlan.summary)}</p>` : ""}
    ${daysHtml}
  `;
}

function renderPrintItem(item, recipe) {
  const imageHtml = recipe && recipe.image_url ? `<img src="${escapeHtml(recipe.image_url)}" class="print-recipe-photo" />` : "";
  const ingredientsHtml =
    recipe && recipe.ingredients.length ? `<ul>${recipe.ingredients.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "";
  const stepsHtml = recipe && recipe.steps.length ? `<ol>${recipe.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>` : "";
  return `
    <div class="print-item">
      <div class="print-item-header">
        ${imageHtml}
        <div><strong>${escapeHtml(item.name)}</strong> — ${escapeHtml(item.portion_desc)} · ${Math.round(item.calories)} kcal</div>
      </div>
      ${ingredientsHtml}
      ${stepsHtml}
    </div>
  `;
}

// --- Progress tab (7-day performance charts) ---

async function loadProgress() {
  const container = document.getElementById("tab-progress");
  container.innerHTML = `<div class="empty-state">Loading your progress...</div>`;
  try {
    const res = await fetch("/api/progress?days=7", { headers: profileHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load progress.");
    renderProgress(data.days || []);
  } catch (err) {
    document.getElementById("tab-progress").innerHTML = `<div class="flag over">⚠️ ${escapeHtml(err.message)}</div>`;
  }
}

// Build a local-timezone Date from a "YYYY-MM-DD" string so toLocaleDateString
// gives the correct weekday (using new Date("YYYY-MM-DD") parses as UTC noon,
// which flips the weekday in timezones west of UTC at midnight).
function parseDateLocal(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function renderProgress(dayRows) {
  const container = document.getElementById("tab-progress");
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Build the last-7-days window ending today
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // Map date → aggregate row from the server
  const byDate = {};
  (dayRows || []).forEach((r) => (byDate[r.date] = r));

  // Fill all 7 slots, defaulting missing days to 0
  const week = dates.map((date) => {
    const row = byDate[date] || {};
    return {
      date,
      dayLabel: parseDateLocal(date).toLocaleDateString([], { weekday: "short" }),
      calories: Number(row.calories) || 0,
      protein_g: Number(row.protein_g) || 0,
      carbs_g: Number(row.carbs_g) || 0,
      fat_g: Number(row.fat_g) || 0,
      fiber_g: Number(row.fiber_g) || 0,
      sugar_g: Number(row.sugar_g) || 0,
      sodium_mg: Number(row.sodium_mg) || 0,
      saturated_fat_g: Number(row.saturated_fat_g) || 0,
      hasData: Boolean(byDate[date]),
    };
  });

  const loggedDays = week.filter((d) => d.hasData);
  const loggedCount = loggedDays.length;

  function avg(field) {
    if (!loggedCount) return 0;
    return loggedDays.reduce((s, d) => s + d[field], 0) / loggedCount;
  }

  // Compact label for bar tops: ≥1000 shown as "1.5k" to fit narrow columns
  function fmtBarVal(val, key) {
    if (!val) return "—";
    if (key === "calories" || key === "sodium_mg") {
      return val >= 1000 ? `${(val / 1000).toFixed(1)}k` : String(Math.round(val));
    }
    return String(round1(val));
  }

  const metrics = [
    { key: "calories",  label: "Calories", unit: " cal", mode: "ceiling", target: currentTargets?.calories },
    { key: "protein_g", label: "Protein",  unit: "g",    mode: "floor",   target: currentTargets?.protein_g },
    { key: "carbs_g",   label: "Carbs",    unit: "g",    mode: "ceiling", target: currentTargets?.carbs_g },
    { key: "fat_g",     label: "Fat",      unit: "g",    mode: "ceiling", target: currentTargets?.fat_g },
  ];

  function chartHtml(metric) {
    const values = week.map((d) => d[metric.key]);
    // Max bar height = target (if set) or highest recorded value, minimum 1 to avoid divide-by-zero
    const maxVal = Math.max(metric.target || 0, ...values, 1);
    const avgVal = avg(metric.key);
    const avgStr = metric.key === "calories" ? Math.round(avgVal) : round1(avgVal);

    const barsHtml = week
      .map((d) => {
        const val = d[metric.key];
        // At least 2% height so a tiny value still shows as a sliver; 0 shows nothing
        const pct = d.hasData && val > 0 ? Math.max(Math.round((val / maxVal) * 100), 2) : 0;
        const status = d.hasData && val > 0 ? (macroStatus(val, metric.target, metric.mode) || "good") : "empty";
        const isToday = d.date === todayStr;
        return `
          <div class="prog-bar-col">
            <div class="prog-bar-val${!d.hasData || val === 0 ? " prog-bar-val-empty" : ""}">${d.hasData ? fmtBarVal(val, metric.key) : "—"}</div>
            <div class="prog-bar-wrap">
              <div class="prog-bar prog-bar-${status}" style="height:${pct}%"></div>
            </div>
            <div class="prog-bar-day${isToday ? " prog-bar-day-today" : ""}">${d.dayLabel}</div>
          </div>`;
      })
      .join("");

    return `
      <div class="card">
        <div class="prog-chart-header">
          <div class="prog-chart-title">${metric.label}</div>
          ${loggedCount ? `<div class="muted">${avgStr}${metric.unit} avg · ${loggedCount}d</div>` : ""}
        </div>
        <div class="prog-bars">${barsHtml}</div>
      </div>`;
  }

  // Nutrient summary — only shown once meals with the new nutrient data exist
  const avgFiber  = avg("fiber_g");
  const avgSugar  = avg("sugar_g");
  const avgSodium = avg("sodium_mg");
  const avgSatFat = avg("saturated_fat_g");
  const hasNutrients = avgFiber > 0 || avgSugar > 0 || avgSodium > 0 || avgSatFat > 0;

  const nutrientsHtml = hasNutrients
    ? `<div class="card">
        <h2>Avg Daily Nutrients</h2>
        <div class="muted" style="margin-bottom:12px">Averaged over ${loggedCount} logged day${loggedCount === 1 ? "" : "s"}</div>
        <div class="nutrients-grid">
          <div class="nutrient-cell"><div class="nutrient-val">${round1(avgFiber)}g</div><div class="nutrient-label">Fiber</div></div>
          <div class="nutrient-cell"><div class="nutrient-val">${round1(avgSugar)}g</div><div class="nutrient-label">Sugar</div></div>
          <div class="nutrient-cell"><div class="nutrient-val">${Math.round(avgSodium)}mg</div><div class="nutrient-label">Sodium</div></div>
          <div class="nutrient-cell"><div class="nutrient-val">${round1(avgSatFat)}g</div><div class="nutrient-label">Sat. Fat</div></div>
        </div>
      </div>`
    : "";

  container.innerHTML = `
    <div class="card">
      <h2>📈 Last 7 Days</h2>
      <div class="muted">${loggedCount} of 7 days logged${loggedCount === 0 ? " — start logging meals to see your progress!" : ""}</div>
    </div>
    ${metrics.map(chartHtml).join("")}
    ${nutrientsHtml}
  `;
}

// Init
initProfileGate();
