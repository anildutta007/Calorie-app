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

// --- DB error banner (shown when the database is temporarily unreachable) ---
const dbBanner = document.getElementById("db-banner");
const dbBannerRetry = document.getElementById("db-banner-retry");

function showDbBanner(retryFn) {
  dbBanner.style.display = "flex";
  dbBannerRetry.onclick = () => {
    dbBanner.style.display = "none";
    retryFn();
  };
}

function hideDbBanner() {
  dbBanner.style.display = "none";
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
  try {
    const res = await fetch("/api/profiles");
    if (res.status >= 500) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    renderProfileList(data.profiles || []);
  } catch (err) {
    profileListEl.innerHTML = `
      <div class="flag over" style="margin-bottom:10px">
        ⚠️ Could not reach the database — please check your connection and try again.
      </div>
      <button class="secondary-btn" id="profile-list-retry">↺ Try again</button>`;
    document.getElementById("profile-list-retry")?.addEventListener("click", showProfileList);
  }
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
  resetLogTimes();
  loadAppVersion();
  loadDailyGreeting();
  Promise.all([loadBio(), loadTargets()]).then(loadToday);
}

async function loadAppVersion() {
  try {
    const res = await fetch("/api/version");
    if (!res.ok) return;
    const { version } = await res.json();
    const el = document.getElementById("app-version");
    if (el && version) el.textContent = `v${version}`;
  } catch { /* non-critical — silently ignore */ }
}

// ── Daily greeting quote ──────────────────────────────────────────────────────
const greetingEl = document.getElementById("daily-greeting");

function timeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

async function loadDailyGreeting() {
  if (!greetingEl) return;

  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `daily-quote-v1-${currentProfile.id}-${today}`;
  const cached = localStorage.getItem(cacheKey);

  const salutation = `${timeOfDay()}, ${currentProfile.name}! 👋`;

  // Show shimmer while loading
  greetingEl.innerHTML = `
    <div class="greeting-time">${salutation}</div>
    <div class="greeting-shimmer"></div>`;
  greetingEl.style.display = "flex";

  if (cached) {
    greetingEl.innerHTML = `
      <div class="greeting-time">${salutation}</div>
      <div class="greeting-quote">${cached}</div>`;
    return;
  }

  try {
    const res = await fetch(
      `/api/daily-quote?name=${encodeURIComponent(currentProfile.name)}`,
      { headers: profileHeaders() }
    );
    if (!res.ok) throw new Error("quote fetch failed");
    const { quote } = await res.json();
    localStorage.setItem(cacheKey, quote);
    greetingEl.innerHTML = `
      <div class="greeting-time">${salutation}</div>
      <div class="greeting-quote">${quote}</div>`;
  } catch {
    // Silently hide if the API call fails — don't disrupt the app
    greetingEl.style.display = "none";
  }
}

switchProfileBtn.addEventListener("click", () => {
  localStorage.removeItem(PROFILE_KEY);
  currentProfile = null;
  currentBio = null;
  currentTargets = null;
  showProfileList();
});

// --- Tab switching ---
const tabs       = document.querySelectorAll(".tab");
const topTabBtns = document.querySelectorAll(".top-tab-btn[data-tab]");

function activateTab(name) {
  // Show the right section
  tabs.forEach((t) => t.classList.remove("active"));
  const section = document.getElementById(`tab-${name}`);
  if (section) section.classList.add("active");
  // Highlight the matching nav button
  topTabBtns.forEach((b) => b.classList.remove("active"));
  const topBtn = document.querySelector(`.top-tab-btn[data-tab="${name}"]`);
  if (topBtn) topBtn.classList.add("active");
  // Always start at the top of the new tab
  window.scrollTo({ top: 0, behavior: "instant" });
}

topTabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const name = btn.dataset.tab;
    activateTab(name);
    if (name === "log")      resetLogTimes();
    if (name === "today")    loadToday();
    if (name === "history")  loadHistory();
    if (name === "plan")     loadMealPlan();
    if (name === "progress") loadProgress();
    if (name === "goal")     { loadTargets(); loadWeightGoal(); loadHealthSyncCard(); }
  });
});

// Logo tap → go home (Log Meal)
document.querySelector("#app-main .app-logo").addEventListener("click", () => {
  activateTab("log");
  resetLogTimes();
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

// ── Meal-time helpers ──────────────────────────────────────────────────────
// Returns current time as "HH:MM" for pre-filling <input type="time">
function nowTimeStr() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
}

// Converts an <input type="time"> value (HH:MM, local) to an ISO timestamp.
// Falls back to right-now if the input is empty or missing.
function mealTimeIso(inputEl) {
  const val = inputEl ? inputEl.value : "";
  if (!val) return new Date().toISOString();
  const [h, m] = val.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

const logMealTimeInput  = document.getElementById("log-meal-time");
const editMealTimeInput = document.getElementById("edit-meal-time");

// Initialise log time input to "now"
function resetLogTimes() {
  const t = nowTimeStr();
  if (logMealTimeInput) logMealTimeInput.value = t;
}

// --- Photo input (shared) ---
const photoInput   = document.getElementById("photo-input");
const photoPreview = document.getElementById("photo-preview");
let selectedFile   = null;

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (!file) return;
  selectedFile = file;
  photoPreview.src = URL.createObjectURL(file);
  photoPreview.style.display = "block";
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

// --- Unified Analyze & Log button ---
const analyzeBtn = document.getElementById("analyze-btn");
analyzeBtn.addEventListener("click", async () => {
  if (selectedFile) {
    // Photo path — any text in the textarea becomes a caption/note
    setBusy(analyzeBtn, true, "Preparing photo...");
    try {
      const uploadFile = await resizeImageForUpload(selectedFile);
      setBusy(analyzeBtn, true, "Analyzing...");
      const formData = new FormData();
      formData.append("photo", uploadFile, "photo.jpg");
      formData.append("caption", voiceText.value.trim());
      formData.append("meal_time_iso", mealTimeIso(logMealTimeInput));
      const res = await fetch("/api/meals/photo", { method: "POST", headers: profileHeaders(), body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to analyze.");
      showResult(data);
      photoInput.value = "";
      voiceText.value = "";
      photoPreview.style.display = "none";
      selectedFile = null;
      resetLogTimes();
    } catch (err) {
      showError(err.message || "Upload failed — try a smaller photo or check your connection.");
    } finally {
      setBusy(analyzeBtn, false, "Analyze & Log");
    }
  } else {
    // Text path
    const text = voiceText.value.trim();
    if (!text) return;
    setBusy(analyzeBtn, true, "Analyzing...");
    try {
      const res = await fetch("/api/meals/text", {
        method: "POST",
        headers: profileHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text, meal_time_iso: mealTimeIso(logMealTimeInput) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to analyze.");
      showResult(data);
      voiceText.value = "";
      resetLogTimes();
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(analyzeBtn, false, "Analyze & Log");
    }
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
  const burned = (todayExercise?.active_calories) || 0;
  const netBudget = currentTargets.calories + burned;
  const calDiff = netBudget - total.calories;
  if (burned > 0) {
    parts.push(calDiff >= 0
      ? `${Math.round(calDiff)} kcal remaining (incl. ${Math.round(burned)} burned)`
      : `${Math.round(-calDiff)} kcal over budget (incl. ${Math.round(burned)} burned)`);
  } else {
    parts.push(calDiff >= 0 ? `${Math.round(calDiff)} kcal remaining` : `${Math.round(-calDiff)} kcal over target`);
  }
  if (currentTargets.protein_g) {
    const proteinDiff = currentTargets.protein_g - total.protein_g;
    parts.push(proteinDiff <= 0 ? "protein goal met" : `${round1(proteinDiff)}g more protein needed`);
  }
  return parts.join(" · ");
}

// --- Today tab ---
async function loadToday() {
  try {
    const [mealsRes, exerciseRes] = await Promise.all([
      fetch("/api/meals",             { headers: profileHeaders() }),
      fetch("/api/profile/exercise",  { headers: profileHeaders() }),
    ]);
    if (mealsRes.status >= 500) throw new Error(`Server error ${mealsRes.status}`);
    const data = await mealsRes.json();
    todayExercise = exerciseRes.ok ? (await exerciseRes.json()).exercise : null;
    hideDbBanner();
    todayTotal = data.total; // keep a reference for the "complete my day" feature
    updateSuggestCard();
    renderTodayExercise(document.getElementById("today-exercise"), todayExercise);
    renderZoneMacroView(document.getElementById("today-list"), data.meals, data.total, true, loadToday);
    renderAllFlags(document.getElementById("today-flags"), data.meals);
  } catch (err) {
    showDbBanner(loadToday);
  }
}

function renderTodayExercise(container, exercise) {
  if (!container) return;
  if (!exercise || (!exercise.steps && !exercise.active_calories && !exercise.exercise_minutes)) {
    container.innerHTML = "";
    return;
  }
  const parts = [];
  if (exercise.steps)            parts.push(`👣 ${exercise.steps.toLocaleString()} steps`);
  if (exercise.active_calories)  parts.push(`🔥 ${Math.round(exercise.active_calories)} kcal burned`);
  if (exercise.exercise_minutes) parts.push(`⏱️ ${exercise.exercise_minutes} min active`);
  container.innerHTML = `
    <div class="exercise-banner">
      <span class="exercise-banner-data">${parts.join(" &thinsp;·&thinsp; ")}</span>
      <span class="exercise-banner-source">⌚ Apple Health</span>
    </div>`;
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

// ── Circular arc intake display — Today tab ───────────────────────────────
// 4 SVG circles (Calories, Protein, Carbs, Fat).  360° = daily target.
// Each logged meal becomes a clockwise arc proportional to its share.
// Time labels sit outside the ring at each arc's midpoint.
// Excess beyond target wraps back from 0° in red.

function renderCircularTotals(container, meals, total, summaryEl) {
  const macros = [
    { key: "calories",  label: "CALORIES", unit: "kcal", target: currentTargets?.calories,  color: "#2f6f4f", excessColor: "#dc2626" },
    { key: "protein_g", label: "PROTEIN",  unit: "g",    target: currentTargets?.protein_g, color: "#1d4ed8", excessColor: "#dc2626" },
    { key: "carbs_g",   label: "CARBS",    unit: "g",    target: currentTargets?.carbs_g,   color: "#b45309", excessColor: "#dc2626" },
    { key: "fat_g",     label: "FAT",      unit: "g",    target: currentTargets?.fat_g,     color: "#6d28d9", excessColor: "#dc2626" },
  ];

  container.innerHTML = `<div class="circ-grid">${
    macros.map(m => `<div class="circ-cell">${buildCircleSvg(m, meals, total)}</div>`).join("")
  }</div>`;

  if (summaryEl) {
    const line = daySummaryLine(total);
    summaryEl.textContent = line;
    summaryEl.style.display = line ? "block" : "none";
  }
}

function buildCircleSvg(macro, meals, total) {
  const { key, label, unit, target, color, excessColor } = macro;

  // SVG layout
  const VW = 200, VH = 200;
  const cx = 100, cy = 100;
  const R  = 64;   // track radius
  const SW = 15;   // stroke width of arcs
  const LR = 94;   // radius where time labels sit

  // "0° = top, clockwise" → x,y at any radius
  function pt(deg, radius) {
    const rad = (deg - 90) * Math.PI / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  // SVG arc path between two angles at radius R
  function arcPath(a0, a1, stroke, opacity) {
    const span = a1 - a0;
    if (span < 0.15) return "";
    const d = Math.min(span, 359.99);       // avoid degenerate full-circle path
    const p1 = pt(a0, R);
    const p2 = pt(a0 + d, R);
    const large = d > 180 ? 1 : 0;
    return `<path d="M${p1.x.toFixed(1)},${p1.y.toFixed(1)} A${R},${R} 0 ${large},1 ${p2.x.toFixed(1)},${p2.y.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${SW}" stroke-linecap="butt" opacity="${opacity}"/>`;
  }

  // text-anchor based on horizontal position of label
  function textAnchor(deg) {
    const cos = Math.cos((deg - 90) * Math.PI / 180);
    return cos > 0.2 ? "start" : cos < -0.2 ? "end" : "middle";
  }

  const actualRaw  = total[key] || 0;
  const actual     = key === "calories" ? Math.round(actualRaw) : round1(actualRaw);
  const targetVal  = target || 0;
  const overTarget = targetVal > 0 && actualRaw > targetVal;
  const centerColor = overTarget ? excessColor : color;
  const centerSub   = targetVal
    ? `/ ${key === "calories" ? Math.round(targetVal) : round1(targetVal)} ${unit}`
    : unit;

  // Only draw arcs for meals that contribute to this macro
  const activeMeals = meals.filter(m => (m[key] || 0) > 0);

  if (!activeMeals.length) {
    return `<svg viewBox="0 0 ${VW} ${VH}" overflow="visible" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="${SW}" opacity="0.12"/>
      <text x="${cx}" y="${cy - 15}" text-anchor="middle" font-size="12" fill="${color}" letter-spacing="0.08em" font-family="inherit">${label}</text>
      <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="22" font-weight="700" fill="${color}" font-family="inherit">0</text>
      <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="12" style="fill:var(--muted)" font-family="inherit">${centerSub}</text>
    </svg>`;
  }

  const arcEls   = [];
  const labelEls = [];
  let cursor = 0;
  const GAP = 2; // visual degrees between consecutive arcs

  activeMeals.forEach((meal, i) => {
    const value    = meal[key] || 0;
    const rawAngle = targetVal > 0 ? (value / targetVal) * 360 : 0;
    if (rawAngle < 0.5) return;

    // Opacity gradient: earliest meal slightly translucent, latest fully opaque
    const opacity = activeMeals.length === 1 ? 1 : 0.55 + 0.45 * (i / (activeMeals.length - 1));

    // Portion within the target (≤360°)
    if (cursor < 360) {
      const normalEnd = Math.min(cursor + rawAngle, 360);
      arcEls.push(arcPath(cursor, normalEnd, color, opacity));
    }
    // Excess portion (wraps back from 0° in red)
    if (cursor + rawAngle > 360) {
      const overStart = Math.max(cursor, 360) - 360;
      const overEnd   = cursor + rawAngle - 360;
      if (overEnd - overStart > 0.15) {
        arcEls.push(arcPath(overStart, overEnd, excessColor, 0.88));
      }
    }

    // Time label at midpoint of this arc
    const midAngle = cursor + rawAngle / 2;
    const midNorm  = midAngle > 360 ? midAngle - 360 : midAngle;

    if (meal.created_at && rawAngle > 5) {
      const timeStr   = new Date(meal.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const labelPt   = pt(midNorm, LR);
      const connStart = pt(midNorm, R + SW / 2 + 3);
      const ta        = textAnchor(midNorm);

      // Second line: actual value + % of target
      const dispVal  = key === "calories" ? Math.round(value) : round1(value);
      const dispPct  = targetVal > 0 ? `${Math.round((value / targetVal) * 100)}%` : "";
      const subLabel = dispPct ? `${dispVal} · ${dispPct}` : String(dispVal);

      // For arcs in the bottom half the sub-line goes ABOVE the time label so it
      // doesn't push outside the SVG viewBox; for the top/side half it goes below.
      const inBottom = midNorm > 120 && midNorm < 240;
      const subDY    = inBottom ? -11 : 11;  // relative to time-text y
      const connEndY = inBottom ? labelPt.y + 5 : labelPt.y - 5; // connector meets top/bottom edge of time text

      // Connector line from arc edge to time label
      labelEls.push(`<line x1="${connStart.x.toFixed(1)}" y1="${connStart.y.toFixed(1)}" x2="${labelPt.x.toFixed(1)}" y2="${connEndY.toFixed(1)}" stroke="${color}" stroke-width="0.9" opacity="0.4"/>`);
      // Time (primary)
      labelEls.push(`<text x="${labelPt.x.toFixed(1)}" y="${labelPt.y.toFixed(1)}" text-anchor="${ta}" dominant-baseline="middle" font-size="12" fill="${color}" font-weight="600" font-family="inherit">${timeStr}</text>`);
      // Value · % (secondary)
      labelEls.push(`<text x="${labelPt.x.toFixed(1)}" y="${(labelPt.y + subDY).toFixed(1)}" text-anchor="${ta}" dominant-baseline="middle" font-size="10.5" fill="${color}" font-family="inherit" opacity="0.8">${subLabel}</text>`);
    }

    cursor += rawAngle + GAP;
  });

  return `<svg viewBox="0 0 ${VW} ${VH}" overflow="visible" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="${SW}" opacity="0.12"/>
    ${arcEls.join("\n    ")}
    ${labelEls.join("\n    ")}
    <text x="${cx}" y="${cy - 15}" text-anchor="middle" font-size="12" fill="${color}" letter-spacing="0.08em" font-family="inherit">${label}</text>
    <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="22" font-weight="700" fill="${centerColor}" font-family="inherit">${actual}</text>
    <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="12" style="fill:var(--muted)" font-family="inherit">${centerSub}</text>
  </svg>`;
}

// ── Timezone Clock ────────────────────────────────────────────────────────────
// Replaces the 4-ring gauge. Shows a 24-hour radial clock divided into 5 time
// zones, with a dot for each logged meal positioned at its eaten time.
function renderTimezoneClock(container, meals, total, summaryEl) {
  const cx = 150, cy = 150;
  const OR = 105, IR = 58;   // outer / inner donut radii
  const DR = 80;             // meal-dot radius
  const LR = 66;             // zone-label radius (inside arc)
  const TR = 120;            // hour-label radius (outside ring)

  const ZONES = [
    { name: "Early Morning", abbr: ["EARLY","MORN"], emoji: "🌙", start:  0, end:  6, fill: "#1e3060", dot: "#5b8fcf" },
    { name: "Morning",       abbr: ["MORNING"],       emoji: "☀️", start:  6, end: 12, fill: "#78350f", dot: "#fbbf24" },
    { name: "Afternoon",     abbr: ["AFTN"],          emoji: "🌤", start: 12, end: 15, fill: "#064e3b", dot: "#34d399" },
    { name: "Evening",       abbr: ["EVE"],           emoji: "🌆", start: 15, end: 18, fill: "#7c2d12", dot: "#fb923c" },
    { name: "Night",         abbr: ["NIGHT"],         emoji: "🌙", start: 18, end: 24, fill: "#1e1b4b", dot: "#a78bfa" },
  ];

  const hToA  = h => (h / 24) * 360;                           // hours → clock degrees (0 = top, CW)
  const toRad = a => (a - 90) * Math.PI / 180;
  const pt    = (r, a) => [+(cx + r * Math.cos(toRad(a))).toFixed(2), +(cy + r * Math.sin(toRad(a))).toFixed(2)];

  function donutSector(r1, r2, h0, h1) {
    const a0 = hToA(h0), a1 = hToA(h1);
    const [ax, ay] = pt(r1, a0); const [bx, by] = pt(r1, a1);
    const [cx2, cy2] = pt(r2, a1); const [dx, dy] = pt(r2, a0);
    const lg = a1 - a0 > 180 ? 1 : 0;
    return `M${ax},${ay} A${r1},${r1} 0 ${lg},1 ${bx},${by} L${cx2},${cy2} A${r2},${r2} 0 ${lg},0 ${dx},${dy}Z`;
  }

  // Group meals by zone
  const zm = ZONES.map(() => ({ list: [], cal: 0, prot: 0, carbs: 0, fat: 0 }));
  (meals || []).forEach(m => {
    const d  = new Date(m.created_at);
    const h  = d.getHours() + d.getMinutes() / 60;
    const zi = ZONES.findIndex(z => h >= z.start && h < z.end);
    if (zi < 0) return;
    zm[zi].list.push({ ...m, h });
    zm[zi].cal   += m.calories   || 0;
    zm[zi].prot  += m.protein_g  || 0;
    zm[zi].carbs += m.carbs_g    || 0;
    zm[zi].fat   += m.fat_g      || 0;
  });

  // ── SVG ──────────────────────────────────────────────────
  const s = [`<svg viewBox="-15 -15 330 330" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:290px;display:block;margin:0 auto;overflow:visible">`];

  // 1. Colored donut sectors
  ZONES.forEach(z => s.push(`<path d="${donutSector(OR, IR, z.start, z.end)}" fill="${z.fill}"/>`));

  // 2. Zone boundary dividers + hour labels at segment edges
  [[0,"00:00"],[6,"06:00"],[12,"12:00"],[15,"15:00"],[18,"18:00"]].forEach(([h, lbl]) => {
    const a = hToA(h);
    const [x1, y1] = pt(IR, a); const [x2, y2] = pt(OR + 5, a); const [lx, ly] = pt(TR, a);
    s.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.45)" stroke-width="1.5"/>`);
    s.push(`<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="8.5" fill="#888" font-family="inherit">${lbl}</text>`);
  });

  // 3. Zone abbreviation labels inside arcs
  ZONES.forEach(z => {
    const midA = hToA((z.start + z.end) / 2);
    const big  = hToA(z.end) - hToA(z.start) >= 90;  // 90° sectors vs 45° sectors
    const [ex, ey] = pt(LR, midA);
    if (big) {
      s.push(`<text x="${ex}" y="${ey - 6}" text-anchor="middle" dominant-baseline="middle" font-size="8" font-weight="700" letter-spacing="0.06em" fill="rgba(255,255,255,0.80)" font-family="inherit">${z.abbr[0]}</text>`);
      if (z.abbr[1]) s.push(`<text x="${ex}" y="${ey + 7}" text-anchor="middle" dominant-baseline="middle" font-size="8" font-weight="700" letter-spacing="0.06em" fill="rgba(255,255,255,0.80)" font-family="inherit">${z.abbr[1]}</text>`);
    } else {
      s.push(`<text x="${ex}" y="${ey}" text-anchor="middle" dominant-baseline="middle" font-size="7.5" font-weight="700" letter-spacing="0.05em" fill="rgba(255,255,255,0.80)" font-family="inherit">${z.abbr[0]}</text>`);
    }
  });

  // 4. Meal dots at their eaten time
  (meals || []).forEach(m => {
    const d  = new Date(m.created_at);
    const h  = d.getHours() + d.getMinutes() / 60;
    const zi = ZONES.findIndex(z => h >= z.start && h < z.end);
    if (zi < 0) return;
    const [mx, my] = pt(DR, hToA(h));
    s.push(`<circle cx="${mx}" cy="${my}" r="5.5" fill="${ZONES[zi].dot}" stroke="white" stroke-width="1.5"/>`);
  });

  // 5. Centre circle + totals
  const totalCal  = Math.round((total || {}).calories  || 0);
  const totalProt = Math.round((total || {}).protein_g || 0);
  s.push(`<circle cx="${cx}" cy="${cy}" r="${IR - 3}" fill="var(--card,#fff)"/>`);
  s.push(`<text x="${cx}" y="${cy - 14}" text-anchor="middle" dominant-baseline="middle" font-size="24" font-weight="800" fill="var(--ink,#1f2323)" font-family="inherit">${totalCal}</text>`);
  s.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" dominant-baseline="middle" font-size="9.5" fill="var(--muted,#6b7280)" font-family="inherit">kcal today</text>`);
  s.push(`<text x="${cx}" y="${cy + 18}" text-anchor="middle" dominant-baseline="middle" font-size="8.5" fill="var(--muted,#6b7280)" font-family="inherit">${totalProt}g protein</text>`);
  s.push(`</svg>`);

  // ── Compact zone summary (individual meals shown in zone timeline below) ──
  let bd = `<div class="tz-breakdown">`;
  ZONES.forEach((z, i) => {
    const zd    = zm[i];
    const range = `${String(z.start).padStart(2,"0")}:00–${String(z.end).padStart(2,"0")}:00`;
    bd += `<div class="tz-zone">
      <div class="tz-zone-hdr">
        <span class="tz-dot" style="background:${z.dot}"></span>
        <strong class="tz-zone-name">${z.emoji} ${z.name}</strong>
        <span class="tz-range muted">${range}</span>
        ${zd.cal > 0 ? `<strong class="tz-cal">${Math.round(zd.cal)} kcal</strong>` : ""}
      </div>
      ${zd.list.length
        ? `<div class="tz-macros muted">P ${Math.round(zd.prot)}g · C ${Math.round(zd.carbs)}g · F ${Math.round(zd.fat)}g · ${zd.list.length} meal${zd.list.length !== 1 ? "s" : ""}</div>`
        : `<div class="tz-macros muted tz-empty">No meals logged</div>`}
    </div>`;
  });
  bd += `</div>`;

  container.innerHTML = s.join("") + bd;

  if (summaryEl) {
    const line = daySummaryLine(total || {});
    summaryEl.textContent = line;
    summaryEl.style.display = line ? "block" : "none";
  }
}

let mealsById = {}; // last-rendered meals, keyed by id, so Edit can look up full item data without refetching
let todayTotal = null;    // {calories, protein_g, carbs_g, fat_g} — updated on every loadToday()
let todayExercise = null; // exercise_log row for today from Apple Health, or null

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

// --- 24-hour day timeline (Today + History tabs) ---
// showEdit    – show the Edit button (Today only)
// onDelete    – callback to run after a meal is deleted
// scrollToNow – scroll the current hour into view (Today only)
function renderDayTimeline(container, meals, showEdit, onDelete, scrollToNow) {
  meals.forEach((m) => (mealsById[m.id] = m));

  // Group meals by the hour they were logged (local time)
  const byHour = {};
  meals.forEach((m) => {
    const h = new Date(m.created_at).getHours();
    (byHour[h] = byHour[h] || []).push(m);
  });

  const nowHour = new Date().getHours();

  const rows = Array.from({ length: 24 }, (_, h) => {
    const label = `${String(h).padStart(2, "0")}:00`;
    const isCurrent = h === nowHour;
    const slotMeals = byHour[h] || [];
    const rowClass = `tl-row${slotMeals.length ? " tl-meals" : " tl-empty"}${isCurrent ? " tl-now" : ""}`;

    if (!slotMeals.length) {
      return `<div class="${rowClass}" data-hour="${h}">
        <div class="tl-label">${label}</div>
        ${isCurrent
          ? '<div class="tl-now-marker"></div>'
          : '<div class="tl-rule"></div>'}
      </div>`;
    }

    const cardsHtml = slotMeals.map((m) => {
      const timeStr = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `<div class="tl-card">
        <div class="tl-card-header">
          <div class="tl-card-title">${escapeHtml(m.description)}</div>
          <div class="tl-card-actions">
            <button class="detail-btn" data-id="${m.id}" title="Show food details">D</button>
            ${showEdit ? `<button class="edit-btn" data-id="${m.id}">Edit</button>` : ""}
            <button class="delete-btn" data-id="${m.id}">Delete</button>
          </div>
        </div>
        <div class="tl-card-time">${timeStr} · ${m.source}</div>
        <div class="tl-detail" hidden>${renderItemsCompact(m.items)}</div>
        <div class="tl-macros">
          <div class="tl-chip"><b>${Math.round(m.calories)}</b> kcal</div>
          <div class="tl-chip">P <b>${round1(m.protein_g)}g</b></div>
          <div class="tl-chip">C <b>${round1(m.carbs_g)}g</b></div>
          <div class="tl-chip">F <b>${round1(m.fat_g)}g</b></div>
        </div>
      </div>`;
    }).join("");

    return `<div class="${rowClass}" data-hour="${h}">
      <div class="tl-label">${label}</div>
      <div class="tl-cards">${cardsHtml}</div>
    </div>`;
  }).join("");

  container.innerHTML = `<div class="day-timeline">${rows}</div>`;

  // Wire up detail toggle, delete and edit buttons
  container.querySelectorAll(".detail-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card   = btn.closest(".tl-card");
      const detail = card.querySelector(".tl-detail");
      const open   = !detail.hidden;
      detail.hidden = open;
      btn.classList.toggle("detail-btn-on", !open);
      btn.title = open ? "Show food details" : "Hide food details";
    });
  });

  container.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this meal?")) return;
      await fetch(`/api/meals/${btn.dataset.id}`, { method: "DELETE", headers: profileHeaders() });
      if (onDelete) onDelete();
    });
  });
  container.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => openEditMealModal(mealsById[btn.dataset.id]));
  });

  // Scroll current hour into view — only when explicitly requested (Today tab)
  if (scrollToNow) {
    requestAnimationFrame(() => {
      const nowRow = container.querySelector(`[data-hour="${nowHour}"]`);
      if (nowRow) nowRow.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
}

function renderItemsCompact(items) {
  if (!items || !items.length) return "";
  const parts = items.map(
    (it) => `${escapeHtml(it.name)} <span class="tl-item-g">~${Math.round(it.grams)}g</span>`
  );
  return `<div class="tl-items">${parts.join(" &middot; ")}</div>`;
}

// ── Zone Timeline ─────────────────────────────────────────────────────────────
// Groups meals into the same 5 time zones as the clock wheel.
// Replaces the 24-hour slot timeline on Today + History tabs.
function renderZoneTimeline(container, meals, showEdit, onDelete) {
  meals.forEach(m => (mealsById[m.id] = m));

  const ZONES = [
    { name: "Early Morning", emoji: "🌙", start:  0, end:  6, dot: "#5b8fcf" },
    { name: "Morning",       emoji: "☀️", start:  6, end: 12, dot: "#fbbf24" },
    { name: "Afternoon",     emoji: "🌤", start: 12, end: 15, dot: "#34d399" },
    { name: "Evening",       emoji: "🌆", start: 15, end: 18, dot: "#fb923c" },
    { name: "Night",         emoji: "🌙", start: 18, end: 24, dot: "#a78bfa" },
  ];

  // Group meals by zone
  const byZone = ZONES.map(() => []);
  meals.forEach(m => {
    const d  = new Date(m.created_at);
    const h  = d.getHours() + d.getMinutes() / 60;
    const zi = ZONES.findIndex(z => h >= z.start && h < z.end);
    if (zi >= 0) byZone[zi].push(m);
  });

  let html = `<div class="zone-timeline">`;

  ZONES.forEach((z, i) => {
    const zMeals = byZone[i];
    const range  = `${String(z.start).padStart(2,"0")}:00–${String(z.end).padStart(2,"0")}:00`;
    const hasM   = zMeals.length > 0;

    html += `<div class="zt-section${hasM ? "" : " zt-empty"}">
      <div class="zt-header">
        <span class="zt-dot" style="background:${z.dot}"></span>
        <span class="zt-zone-title">${z.emoji} ${z.name}</span>
        <span class="zt-time-range muted">${range}</span>
        ${hasM ? `<span class="zt-count muted">${zMeals.length} meal${zMeals.length !== 1 ? "s" : ""}</span>` : ""}
      </div>`;

    if (hasM) {
      zMeals.forEach(m => {
        const t = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        html += `<div class="tl-card">
          <div class="tl-card-header">
            <div class="tl-card-title">${escapeHtml(m.description)}</div>
            <div class="tl-card-actions">
              <button class="detail-btn" data-id="${m.id}" title="Show food details">D</button>
              ${showEdit ? `<button class="edit-btn" data-id="${m.id}">Edit</button>` : ""}
              <button class="delete-btn" data-id="${m.id}">Delete</button>
            </div>
          </div>
          <div class="tl-card-time">${t} · ${m.source || ""}</div>
          <div class="tl-detail" hidden>${renderItemsCompact(m.items)}</div>
          <div class="tl-macros">
            <div class="tl-chip"><b>${Math.round(m.calories || 0)}</b> kcal</div>
            <div class="tl-chip">P <b>${round1(m.protein_g)}g</b></div>
            <div class="tl-chip">C <b>${round1(m.carbs_g)}g</b></div>
            <div class="tl-chip">F <b>${round1(m.fat_g)}g</b></div>
          </div>
        </div>`;
      });
    } else {
      html += `<div class="zt-empty-msg muted">No meals logged</div>`;
    }

    html += `</div>`;
  });

  html += `</div>`;
  container.innerHTML = html;

  // Wire up detail toggle
  container.querySelectorAll(".detail-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const card   = btn.closest(".tl-card");
      const detail = card.querySelector(".tl-detail");
      const open   = !detail.hidden;
      detail.hidden = open;
      btn.classList.toggle("detail-btn-on", !open);
      btn.title = open ? "Show food details" : "Hide food details";
    });
  });

  // Wire up delete
  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this meal?")) return;
      await fetch(`/api/meals/${btn.dataset.id}`, { method: "DELETE", headers: profileHeaders() });
      if (onDelete) onDelete();
    });
  });

  // Wire up edit
  container.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => openEditMealModal(mealsById[btn.dataset.id]));
  });
}

// ── Combined Zone View (Rings + Meals) ────────────────────────────────────────
// Renders 4 macro donut rings at top, then meals grouped by zone below (no rings in meal section)
function renderZoneMacroView(container, meals, total, showEdit, onDelete) {
  meals.forEach(m => (mealsById[m.id] = m));

  const ZONES = [
    { name: "Early Morning", emoji: "🌙", start:  0, end:  6, dot: "#5b8fcf" },
    { name: "Morning",       emoji: "☀️", start:  6, end: 12, dot: "#d97706" },
    { name: "Afternoon",     emoji: "🌤", start: 12, end: 15, dot: "#059669" },
    { name: "Evening",       emoji: "🌆", start: 15, end: 18, dot: "#ea580c" },
    { name: "Night",         emoji: "🌙", start: 18, end: 24, dot: "#7c3aed" },
  ];

  const MACROS = [
    { key: "calories",  label: "CALORIES", unit: "kcal", color: "#2f6f4f" },
    { key: "protein_g", label: "PROTEIN",  unit: "g",    color: "#1d4ed8" },
    { key: "carbs_g",   label: "CARBS",    unit: "g",    color: "#b45309" },
    { key: "fat_g",     label: "FAT",      unit: "g",    color: "#6d28d9" },
  ];

  // Group meals by zone, sum macros per zone
  const zoneData = ZONES.map(() => ({
    meals: [], calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0
  }));

  (meals || []).forEach(m => {
    const d  = new Date(m.created_at);
    const h  = d.getHours() + d.getMinutes() / 60;
    const zi = ZONES.findIndex(z => h >= z.start && h < z.end);
    if (zi >= 0) {
      zoneData[zi].meals.push(m);
      zoneData[zi].calories  += m.calories   || 0;
      zoneData[zi].protein_g += m.protein_g  || 0;
      zoneData[zi].carbs_g   += m.carbs_g    || 0;
      zoneData[zi].fat_g     += m.fat_g      || 0;
    }
  });

  // Build 4 SVG donut rings
  function buildZoneMacroRing(macro) {
    const { key, label, unit, color } = macro;
    const VW = 200, VH = 200;
    const cx = 100, cy = 100;
    const R = 64;
    const SW = 15;

    const dayTotal = total[key] || 0;
    const displayTotal = key === "calories" ? Math.round(dayTotal) : round1(dayTotal);
    const centerSub = `/ ${key === "calories" ? Math.round(currentTargets?.[key] || 0) : round1(currentTargets?.[key] || 0)} ${unit}`;

    // If no data, show empty ring
    if (dayTotal === 0) {
      return `<svg viewBox="0 0 ${VW} ${VH}" overflow="visible" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="${SW}" opacity="0.12"/>
        <text x="${cx}" y="${cy - 15}" text-anchor="middle" font-size="12" fill="${color}" letter-spacing="0.08em" font-family="inherit">${label}</text>
        <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="22" font-weight="700" fill="${color}" font-family="inherit">0</text>
        <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="12" style="fill:var(--muted)" font-family="inherit">${centerSub}</text>
      </svg>`;
    }

    // Calculate each zone's angle
    function toRad(deg) {
      return (deg - 90) * Math.PI / 180;
    }
    function pt(deg, radius) {
      return {
        x: cx + radius * Math.cos(toRad(deg)),
        y: cy + radius * Math.sin(toRad(deg))
      };
    }
    function arcPath(a0, a1, stroke) {
      const d = a1 - a0;
      if (d < 0.15) return "";
      const p1 = pt(a0, R);
      const p2 = pt(a1, R);
      const large = d > 180 ? 1 : 0;
      return `<path d="M${p1.x.toFixed(1)},${p1.y.toFixed(1)} A${R},${R} 0 ${large},1 ${p2.x.toFixed(1)},${p2.y.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${SW}" stroke-linecap="butt"/>`;
    }

    const arcs = [];
    const labels = [];
    let angle = 0;
    const GAP = 2;
    const LR = 45; // label radius (inside the ring)

    zoneData.forEach((zdata, i) => {
      const value = zdata[key] || 0;
      const pct = dayTotal > 0 ? (value / dayTotal) * 360 : 0;
      const pctPercent = dayTotal > 0 ? Math.round((value / dayTotal) * 100) : 0;

      if (pct >= 0.15) {
        arcs.push(arcPath(angle, angle + pct, ZONES[i].color));

        // Calculate label position at midpoint of arc, inside the ring
        const midAngle = angle + pct / 2;
        const labelPt = pt(midAngle, LR);

        // Format the value based on macro type
        const dispVal = key === "calories" ? Math.round(value) : round1(value);
        const labelText = `${dispVal} · ${pctPercent}%`;

        // Rotate text to align with arc direction
        const rotation = midAngle;
        labels.push(`<text x="${labelPt.x.toFixed(1)}" y="${labelPt.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="8" fill="white" font-weight="600" font-family="inherit" transform="rotate(${rotation} ${labelPt.x.toFixed(1)} ${labelPt.y.toFixed(1)})">${labelText}</text>`);

        angle += pct + GAP;
      }
    });

    return `<svg viewBox="0 0 ${VW} ${VH}" overflow="visible" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="${SW}" opacity="0.12"/>
      ${arcs.join("\n    ")}
      ${labels.join("\n    ")}
      <text x="${cx}" y="${cy - 15}" text-anchor="middle" font-size="12" fill="${color}" letter-spacing="0.08em" font-family="inherit">${label}</text>
      <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="22" font-weight="700" fill="${color}" font-family="inherit">${displayTotal}</text>
      <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="12" style="fill:var(--muted)" font-family="inherit">${centerSub}</text>
    </svg>`;
  }

  // Build the rings section HTML
  const ringsHtml = `<div class="circ-grid">${
    MACROS.map(m => `<div class="circ-cell">${buildZoneMacroRing(m)}</div>`).join("")
  }</div>`;

  // Build the meals by zone section
  let mealsHtml = `<div class="zone-timeline">`;
  ZONES.forEach((z, i) => {
    const zm = zoneData[i];
    const range = `${String(z.start).padStart(2,"0")}:00–${String(z.end).padStart(2,"0")}:00`;
    const hasM = zm.meals.length > 0;

    mealsHtml += `<div class="zt-section${hasM ? "" : " zt-empty"}">
      <div class="zt-header">
        <span class="zt-dot" style="background:${z.dot}"></span>
        <span class="zt-zone-title">${z.emoji} ${z.name}</span>
        <span class="zt-time-range muted">${range}</span>
        ${hasM ? `<span class="zt-kcal muted">${Math.round(zm.calories)} kcal</span>` : ""}
      </div>`;

    if (hasM) {
      zm.meals.forEach(m => {
        const t = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        mealsHtml += `<div class="tl-card">
          <div class="tl-card-header">
            <div class="tl-card-title">${escapeHtml(m.description)}</div>
            <div class="tl-card-actions">
              <button class="detail-btn" data-id="${m.id}" title="Show food details">D</button>
              ${showEdit ? `<button class="edit-btn" data-id="${m.id}">Edit</button>` : ""}
              <button class="delete-btn" data-id="${m.id}">Delete</button>
            </div>
          </div>
          <div class="tl-card-time">${t} · ${m.source || ""}</div>
          <div class="tl-detail" hidden>${renderItemsCompact(m.items)}</div>
          <div class="tl-macros">
            <div class="tl-chip"><b>${Math.round(m.calories || 0)}</b> kcal</div>
            <div class="tl-chip">P <b>${round1(m.protein_g)}g</b></div>
            <div class="tl-chip">C <b>${round1(m.carbs_g)}g</b></div>
            <div class="tl-chip">F <b>${round1(m.fat_g)}g</b></div>
          </div>
        </div>`;
      });
    } else {
      mealsHtml += `<div class="zt-empty-msg muted">No meals logged</div>`;
    }

    mealsHtml += `</div>`;
  });
  mealsHtml += `</div>`;

  // Combine both and set HTML
  container.innerHTML = ringsHtml + mealsHtml;

  // Wire up detail toggle, delete, edit buttons
  container.querySelectorAll(".detail-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const card   = btn.closest(".tl-card");
      const detail = card.querySelector(".tl-detail");
      const open   = !detail.hidden;
      detail.hidden = open;
      btn.classList.toggle("detail-btn-on", !open);
      btn.title = open ? "Show food details" : "Hide food details";
    });
  });

  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this meal?")) return;
      await fetch(`/api/meals/${btn.dataset.id}`, { method: "DELETE", headers: profileHeaders() });
      if (onDelete) onDelete();
    });
  });

  container.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => openEditMealModal(mealsById[btn.dataset.id]));
  });
}

// ── Zone Panels ───────────────────────────────────────────────────────────────
// Main view for Today + History: 5 time-period sections, each showing
// 4 macro progress rings (for that period's intake) + individual meal cards.
// A "Day Total" section with 4 rings for the full day appears at the bottom.
// Portion warnings are rendered separately AFTER this, at end of page.
function renderZonePanels(container, meals, total, showEdit, onDelete) {
  meals.forEach(m => (mealsById[m.id] = m));

  const ZONES = [
    { name: "Early Morning", emoji: "🌙", start:  0, end:  6, dot: "#5b8fcf", bg: "rgba(91,143,207,0.08)" },
    { name: "Morning",       emoji: "☀️", start:  6, end: 12, dot: "#d97706", bg: "rgba(217,119,6,0.08)"  },
    { name: "Afternoon",     emoji: "🌤", start: 12, end: 15, dot: "#059669", bg: "rgba(5,150,105,0.08)"  },
    { name: "Evening",       emoji: "🌆", start: 15, end: 18, dot: "#ea580c", bg: "rgba(234,88,12,0.08)"  },
    { name: "Night",         emoji: "🌙", start: 18, end: 24, dot: "#7c3aed", bg: "rgba(124,58,237,0.08)" },
  ];

  const MACROS = [
    { key: "calories",  label: "CALORIES", unit: "kcal", target: currentTargets?.calories,  color: "#2f6f4f", excessColor: "#dc2626" },
    { key: "protein_g", label: "PROTEIN",  unit: "g",    target: currentTargets?.protein_g, color: "#1d4ed8", excessColor: "#dc2626" },
    { key: "carbs_g",   label: "CARBS",    unit: "g",    target: currentTargets?.carbs_g,   color: "#b45309", excessColor: "#dc2626" },
    { key: "fat_g",     label: "FAT",      unit: "g",    target: currentTargets?.fat_g,     color: "#6d28d9", excessColor: "#dc2626" },
  ];

  // Group meals by zone
  const byZone = ZONES.map(() => ({ meals: [], calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }));
  meals.forEach(m => {
    const d  = new Date(m.created_at);
    const h  = d.getHours() + d.getMinutes() / 60;
    const zi = ZONES.findIndex(z => h >= z.start && h < z.end);
    if (zi >= 0) {
      byZone[zi].meals.push(m);
      byZone[zi].calories  += m.calories   || 0;
      byZone[zi].protein_g += m.protein_g  || 0;
      byZone[zi].carbs_g   += m.carbs_g    || 0;
      byZone[zi].fat_g     += m.fat_g      || 0;
    }
  });

  let html = `<div class="zone-panels">`;

  // ── 5 zone sections ──
  ZONES.forEach((z, i) => {
    const zm   = byZone[i];
    const hasM = zm.meals.length > 0;
    const range = `${String(z.start).padStart(2,"0")}:00–${String(z.end).padStart(2,"0")}:00`;

    html += `<div class="zp-section" style="--zp-dot:${z.dot};--zp-bg:${z.bg}">
      <div class="zp-header">
        <span class="zp-dot-badge"></span>
        <span class="zp-zone-name">${z.emoji} ${z.name}</span>
        <span class="zp-range muted">${range}</span>
        ${hasM ? `<span class="zp-kcal">${Math.round(zm.calories)} kcal</span>` : ""}
      </div>`;

    if (hasM) {
      // 4 macro rings for this zone's intake vs daily target
      html += `<div class="circ-grid zp-rings">`;
      MACROS.forEach(mac => {
        html += `<div class="circ-cell">${buildCircleSvg(mac, zm.meals, zm)}</div>`;
      });
      html += `</div>`;

      // Individual meal cards
      zm.meals.forEach(m => {
        const t = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        html += `<div class="tl-card">
          <div class="tl-card-header">
            <div class="tl-card-title">${escapeHtml(m.description)}</div>
            <div class="tl-card-actions">
              <button class="detail-btn" data-id="${m.id}" title="Show food details">D</button>
              ${showEdit ? `<button class="edit-btn" data-id="${m.id}">Edit</button>` : ""}
              <button class="delete-btn" data-id="${m.id}">Delete</button>
            </div>
          </div>
          <div class="tl-card-time">${t} · ${m.source || ""}</div>
          <div class="tl-detail" hidden>${renderItemsCompact(m.items)}</div>
          <div class="tl-macros">
            <div class="tl-chip"><b>${Math.round(m.calories || 0)}</b> kcal</div>
            <div class="tl-chip">P <b>${round1(m.protein_g)}g</b></div>
            <div class="tl-chip">C <b>${round1(m.carbs_g)}g</b></div>
            <div class="tl-chip">F <b>${round1(m.fat_g)}g</b></div>
          </div>
        </div>`;
      });
    } else {
      html += `<div class="zp-no-meals muted">No meals logged</div>`;
    }

    html += `</div>`; // .zp-section
  });

  // ── Day Total section ──
  const dayTotal = total || {};
  const summLine = daySummaryLine(dayTotal);
  html += `<div class="zp-section zp-day-total">
    <div class="zp-header">
      <span class="zp-dot-badge" style="--zp-dot:#2f6f4f"></span>
      <span class="zp-zone-name">📊 Day Total</span>
      <span id="today-summary" class="day-summary" style="display:${summLine ? "block" : "none"};flex:1;text-align:right;font-size:0.78rem;margin-left:auto">${summLine || ""}</span>
    </div>
    <div class="circ-grid zp-rings">`;
  MACROS.forEach(mac => {
    html += `<div class="circ-cell">${buildCircleSvg(mac, meals, dayTotal)}</div>`;
  });
  html += `</div></div>`;

  html += `</div>`; // .zone-panels
  container.innerHTML = html;

  // ── Wire up buttons ──
  container.querySelectorAll(".detail-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const card   = btn.closest(".tl-card");
      const detail = card.querySelector(".tl-detail");
      const open   = !detail.hidden;
      detail.hidden = open;
      btn.classList.toggle("detail-btn-on", !open);
      btn.title = open ? "Show food details" : "Hide food details";
    });
  });
  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this meal?")) return;
      await fetch(`/api/meals/${btn.dataset.id}`, { method: "DELETE", headers: profileHeaders() });
      if (onDelete) onDelete();
    });
  });
  container.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => openEditMealModal(mealsById[btn.dataset.id]));
  });
}

// --- History tab ---
const historyDateInput = document.getElementById("history-date");
historyDateInput.addEventListener("change", loadHistory);

async function loadHistory() {
  const today = new Date().toISOString().slice(0, 10);
  if (!historyDateInput.value) historyDateInput.value = today;
  const date = historyDateInput.value;
  try {
    const res = await fetch(`/api/meals?date=${date}`, { headers: profileHeaders() });
    if (res.status >= 500) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    hideDbBanner();
    renderZoneMacroView(document.getElementById("history-list"), data.meals, data.total, false, loadHistory);
    renderAllFlags(document.getElementById("history-flags"), data.meals);
  } catch (err) {
    showDbBanner(loadHistory);
  }
}

// ── 7-day progress: 2×2 bar charts (Progress tab) ────────────────────────────
// Called directly from renderProgress() with the data it already fetched.
// Layout: 2×2 grid — one SVG bar chart per macro (Calories, Protein, Carbs, Fat).
// Each chart: 7 day bars, dashed target line, y-axis labels, today highlighted.

function render7DayTable(container, dayRows) {
  const todayStr = new Date().toISOString().slice(0, 10);

  // Build 7-day window oldest → newest
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const byDate = {};
  dayRows.forEach((r) => (byDate[r.date] = r));

  const macros = [
    { key: "calories",  label: "Calories", color: "#3B82F6", target: currentTargets?.calories,  fmt: Math.round },
    { key: "protein_g", label: "Protein",  color: "#10B981", target: currentTargets?.protein_g, fmt: round1 },
    { key: "carbs_g",   label: "Carbs",    color: "#F59E0B", target: currentTargets?.carbs_g,   fmt: round1 },
    { key: "fat_g",     label: "Fat",      color: "#EC4899", target: currentTargets?.fat_g,     fmt: round1 },
  ];

  // ── SVG bar chart for one macro ───────────────────────────────────────────
  function barChart(macro) {
    const W = 260, H = 116, PL = 34, PR = 6, PT = 16, PB = 20;
    const iW = W - PL - PR, iH = H - PT - PB;

    // null = day not logged; treat 0 as null too
    const vals = dates.map((date) => {
      const row = byDate[date];
      if (!row) return null;
      const v = Number(row[macro.key]) || 0;
      return v > 0 ? v : null;
    });

    const defined = vals.filter((v) => v !== null);
    const tgt     = macro.target || 0;
    const ceiling = Math.max(tgt * 1.15, ...(defined.length ? [Math.max(...defined) * 1.1] : [1]), 1);

    const slotW   = iW / 7;
    const barW    = slotW * 0.65;
    const xCenter = (i) => PL + slotW * i + slotW / 2;
    const yp      = (v) => PT + iH * (1 - v / ceiling);

    // Compact value formatter (used for value labels above bars too)
    const fmtY = (v) =>
      macro.key === "calories" && v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v);

    // Y-axis grid lines + labels (4 ticks)
    const TICKS = 4;
    const step  = ceiling / TICKS;
    const gridLines = Array.from({ length: TICKS }, (_, k) => {
      const v = step * (k + 1);
      const y = yp(v).toFixed(1);
      return `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}"
                stroke="var(--border)" stroke-width="0.5"/>
              <text x="${PL - 3}" y="${(+y + 3.5).toFixed(1)}" text-anchor="end"
                font-size="7.5" fill="var(--muted)">${fmtY(v)}</text>`;
    }).join("");

    // Dashed target line + target value label on the right end
    const tgtY = tgt > 0 ? yp(tgt).toFixed(1) : null;
    const tgtLine = tgt > 0 && tgt <= ceiling * 1.05
      ? `<line x1="${PL}" y1="${tgtY}" x2="${W - PR}" y2="${tgtY}"
           stroke="${macro.color}" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.55"/>
         <text x="${W - PR - 2}" y="${(parseFloat(tgtY) - 3).toFixed(1)}" text-anchor="end"
           font-size="7.5" fill="${macro.color}" font-weight="700" opacity="0.85">${fmtY(tgt)}</text>`
      : "";

    // SVG hatch pattern for over-target bars
    const patId = `hatch-${macro.key}`;
    const hatchDef = `<defs>
      <pattern id="${patId}" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45 0 0)">
        <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>
      </pattern>
    </defs>`;

    // Bars — today full opacity, others muted; over-target get crosshatch overlay + value label above
    const bars = vals.map((v, i) => {
      if (v === null) return "";
      const isToday = dates[i] === todayStr;
      const isOver  = tgt > 0 && v > tgt;
      const barH    = Math.max(iH * (Math.min(v, ceiling) / ceiling), 2).toFixed(1);
      const x       = (xCenter(i) - barW / 2).toFixed(1);
      const y       = (PT + iH - parseFloat(barH)).toFixed(1);
      const dispVal = fmtY(v);
      // value label sits above the bar; if bar is very tall push it just above top padding
      const labelY  = Math.max(parseFloat(y) - 2, PT - 1).toFixed(1);
      return `<rect x="${x}" y="${y}" width="${barW.toFixed(1)}" height="${barH}"
          rx="3" fill="${macro.color}" opacity="${isToday ? "1" : "0.7"}"/>
        ${isOver ? `<rect x="${x}" y="${y}" width="${barW.toFixed(1)}" height="${barH}"
          rx="3" fill="url(#${patId})"/>` : ""}
        <text x="${xCenter(i).toFixed(1)}" y="${labelY}" text-anchor="middle"
          font-size="7" fill="${macro.color}" font-weight="700" opacity="${isToday ? "1" : "0.75"}">${dispVal}</text>`;
    }).join("");

    // X-axis labels — today in macro colour
    const xLabels = dates.map((date, i) => {
      const dName   = parseDateLocal(date).toLocaleDateString([], { weekday: "short" });
      const isToday = date === todayStr;
      return `<text x="${xCenter(i).toFixed(1)}" y="${H - 3}" text-anchor="middle"
        font-size="7.5" fill="${isToday ? macro.color : "var(--muted)"}"
        font-weight="${isToday ? "700" : "400"}">${dName}</text>`;
    }).join("");

    return `<div class="card pg-chart">
      <div class="pg-chart-title" style="color:${macro.color}">${macro.label}</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">
        ${hatchDef}${gridLines}${tgtLine}${bars}${xLabels}
      </svg>
    </div>`;
  }

  container.innerHTML = `
    <div class="pg-charts-grid">
      ${macros.map(barChart).join("")}
    </div>`;
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
  // Pre-fill the time from the original created_at (local HH:MM)
  if (editMealTimeInput && meal.created_at) {
    const d = new Date(meal.created_at);
    editMealTimeInput.value = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  editMealItemsContainer.innerHTML = "";
  meal.items.forEach((it) => editMealItemsContainer.appendChild(buildEditItemRow(it)));
  editMealModal.style.display = "flex";
}

// Only name/portion/grams are editable - calories/protein/carbs/fat are
// always recalculated server-side from those, never hand-entered here.
function buildEditItemRow(item) {
  // Detect if this item was entered in ml (from portion_desc or item unit hint)
  const isML = /ml\b/i.test(item?.portion_desc || "");
  const row = document.createElement("div");
  row.className = "edit-item-row";
  row.innerHTML = `
    <label>Name</label>
    <input type="text" class="edit-item-name" value="${escapeHtml(item?.name || "")}" placeholder="e.g. Milk, protein shake" />
    <label>Portion</label>
    <input type="text" class="edit-item-portion" value="${escapeHtml(item?.portion_desc || "")}" placeholder="e.g. 1 cup, 200ml, 1 scoop" />
    <label>Amount</label>
    <div class="item-amount-row">
      <input type="number" class="edit-item-grams" value="${item?.grams ?? ""}" min="0" placeholder="e.g. 200" />
      <div class="unit-toggle" role="group" aria-label="Unit">
        <button type="button" class="unit-btn ${isML ? "" : "active"}" data-unit="g">g</button>
        <button type="button" class="unit-btn ${isML ? "active" : ""}" data-unit="ml">ml</button>
      </div>
    </div>
    <button type="button" class="edit-item-remove">Remove item</button>
  `;
  // Wire unit toggle
  const unitBtns = row.querySelectorAll(".unit-btn");
  unitBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      unitBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
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
    .map((row) => {
      const name      = row.querySelector(".edit-item-name").value.trim();
      const gramsRaw  = Number(row.querySelector(".edit-item-grams").value) || 0;
      const unit      = row.querySelector(".unit-btn.active")?.dataset.unit || "g";
      let portion_desc = row.querySelector(".edit-item-portion").value.trim();
      // Auto-fill portion if blank — gives the server/AI the full context (e.g. "200 ml")
      if (!portion_desc && gramsRaw) portion_desc = `${gramsRaw} ${unit}`;
      // For ml: 1 ml ≈ 1 g (standard food-tracking convention; density tables omitted intentionally)
      return { name, portion_desc, grams: gramsRaw };
    })
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
      body: JSON.stringify({ description, items, meal_time_iso: mealTimeIso(editMealTimeInput) }),
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
const planLikesInput = document.getElementById("plan-likes");
const planAvoidInput = document.getElementById("plan-avoid");
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
let pdfIncludedDishes = new Set(); // dish names whose recipes the user wants in the PDF (default none)

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
      body: JSON.stringify({
        calories,
        protein_g,
        diet: selectedDiet,
        included_proteins: getCheckedProteins(),
        days,
        preferences: planLikesInput.value.trim(),
        avoid: planAvoidInput.value.trim(),
      }),
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
  planLikesInput.value = "";
  planAvoidInput.value = "";
  currentMealPlan = null;
  currentRecipes = null;
  pdfIncludedDishes = new Set();
  planStatus.textContent = "";
  planResult.innerHTML = `<div class="empty-state">No plan yet — set your targets above and generate one.</div>`;
}

function applyMealPlan(mealPlan) {
  pdfIncludedDishes = new Set(); // clear PDF recipe selections for fresh plan
  planDaysSelect.value = String(Math.min(Math.max(mealPlan.days.length || 7, 1), 7));
  // Always prefill the form from the current daily target so new generations
  // use the latest target.  Only fall back to the plan's own stored targets
  // if no daily target has been set yet.
  if (currentTargets && currentTargets.calories) {
    planCaloriesInput.value = currentTargets.calories;
    planProteinInput.value = currentTargets.protein_g ?? mealPlan.protein_target;
    planTargetHint.textContent = "Prefilled from your Daily Target — edit below, or change it on the Target tab.";
    planTargetHint.style.display = "block";
  } else {
    planCaloriesInput.value = mealPlan.calorie_target;
    planProteinInput.value = mealPlan.protein_target;
    planTargetHint.style.display = "none";
  }
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
      <div class="email-plan-row">
        <input id="email-plan-input" type="email" placeholder="your@email.com" autocomplete="email" />
        <button id="send-email-btn" class="secondary-btn" type="button">📧 Send to Email</button>
      </div>
      <div id="email-plan-status" class="muted"></div>
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

// Like renderItems, but each dish name is a clickable "how to cook" link and
// has a checkbox to opt that dish's recipe into the PDF download.
// Names are looked up by index (planDishNames) rather than embedded in a
// data-* attribute, so no HTML-attribute-escaping edge cases to worry about.
function renderPlanItems(items) {
  return items
    .map((it) => {
      const idx = planDishNames.length;
      planDishNames.push(it.name);
      const pdfChecked = pdfIncludedDishes.has(it.name) ? " checked" : "";
      return `
    <div class="item-row">
      <div>
        <div class="item-name">
          <div class="plan-item-actions">
            <button class="recipe-link" data-idx="${idx}" type="button">${escapeHtml(it.name)} <span class="recipe-icon">🍳</span></button>
            <label class="pdf-toggle" title="Include this recipe in the PDF download">
              <input type="checkbox" class="pdf-recipe-check" data-idx="${idx}"${pdfChecked}>
              📄 PDF
            </label>
          </div>
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

  const emailBtn = e.target.closest("#send-email-btn");
  if (emailBtn) sendPlanEmail(emailBtn);
});

// Track which dishes are opted into the PDF (change, not click, for checkboxes)
planResult.addEventListener("change", (e) => {
  const cb = e.target.closest(".pdf-recipe-check");
  if (!cb) return;
  const dishName = planDishNames[Number(cb.dataset.idx)];
  if (!dishName) return;
  if (cb.checked) pdfIncludedDishes.add(dishName);
  else            pdfIncludedDishes.delete(dishName);
  // Update the PDF button label with current recipe count
  const pdfBtn = document.getElementById("download-pdf-btn");
  if (pdfBtn) {
    const n = pdfIncludedDishes.size;
    pdfBtn.textContent = n > 0
      ? `📄 Download PDF (${n} recipe${n > 1 ? "s" : ""})`
      : "📄 Download PDF (no recipes)";
  }
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
  try {
    let recipes = {};
    if (pdfIncludedDishes.size > 0) {
      const n = pdfIncludedDishes.size;
      if (statusEl) statusEl.textContent = `Loading ${n} selected recipe${n > 1 ? "s" : ""} (first time can take ~30-60s)...`;
      recipes = await ensureRecipesLoaded();
    }
    buildPrintView(currentMealPlan, recipes);
    if (statusEl) statusEl.textContent = "";
    window.print();
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message;
  } finally {
    const n = pdfIncludedDishes.size;
    setBusy(btn, false, n > 0 ? `📄 Download PDF (${n} recipe${n > 1 ? "s" : ""})` : "📄 Download PDF (no recipes)");
  }
}

async function sendPlanEmail(btn) {
  const emailInput = document.getElementById("email-plan-input");
  const statusEl   = document.getElementById("email-plan-status");
  const email = (emailInput?.value || "").trim();

  if (!email) {
    if (statusEl) statusEl.textContent = "⚠️ Please enter an email address.";
    emailInput?.focus();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (statusEl) statusEl.textContent = "⚠️ Please enter a valid email address.";
    emailInput?.focus();
    return;
  }

  const selectedRecipeNames = [...pdfIncludedDishes];
  const n = selectedRecipeNames.length;
  setBusy(btn, true, "Sending…");
  if (statusEl) statusEl.textContent = n > 0
    ? `Preparing email with ${n} recipe${n > 1 ? "s" : ""} — this may take ~30 seconds the first time...`
    : "Sending meal plan...";

  try {
    const res = await fetch("/api/meal-plan/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...profileHeaders() },
      body: JSON.stringify({ email, selectedRecipeNames }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to send.");
    if (statusEl) statusEl.textContent = `✅ Sent! Check ${email} (it may take a minute to arrive).`;
    if (emailInput) emailInput.value = "";
  } catch (err) {
    if (statusEl) statusEl.textContent = `⚠️ ${err.message}`;
  } finally {
    setBusy(btn, false, "📧 Send to Email");
  }
}

// Canonical meal-type sort order for the calendar rows
const MEAL_TYPE_ORDER = [
  "breakfast", "morning snack", "mid-morning snack",
  "snack", "pre-workout", "lunch",
  "afternoon snack", "evening snack", "dinner", "post-dinner"
];

function mealTypeSortKey(type) {
  const lower = type.toLowerCase();
  const idx = MEAL_TYPE_ORDER.findIndex((t) => lower.includes(t) || t.includes(lower));
  return idx === -1 ? 99 : idx;
}

function buildPrintView(mealPlan, recipes) {
  const dietLabel = mealPlan.diet === "veg" ? "Vegetarian" : "Non-Vegetarian";
  const proteins  = mealPlan.included_proteins || [];
  const proteinLabel = proteins.length
    ? ` + ${proteins.map(cap).join(", ")}`
    : mealPlan.diet === "veg" ? " (strict)" : "";
  const days = mealPlan.days;

  // ── Page 1: calendar grid ─────────────────────────────────────────────

  // Collect unique meal types in canonical order
  const mealTypeSet = new Set();
  days.forEach((day) => day.meals.forEach((m) => mealTypeSet.add(m.meal_type)));
  const mealTypes = [...mealTypeSet].sort(
    (a, b) => mealTypeSortKey(a) - mealTypeSortKey(b)
  );

  // Build lookup: dayIndex → mealType(lower) → items[]
  const mealMap = days.map((day) => {
    const m = {};
    day.meals.forEach((meal) => { m[meal.meal_type] = meal.items; });
    return m;
  });

  // Header row — one <th> per day
  const headerCells = days
    .map((d) => `<th class="cal-day-header">${escapeHtml(d.day_label || `Day ${d.day_number}`)}</th>`)
    .join("");

  // Body rows — one <tr> per meal type
  const bodyRows = mealTypes
    .map((mealType) => {
      const cells = days
        .map((_, di) => {
          const items = mealMap[di][mealType] || [];
          const content = items.length
            ? items.map((it) => {
                const macros = it.calories != null
                  ? `<span class="cal-dish-macros">${Math.round(it.calories)} kcal · P ${round1(it.protein_g)}g · C ${round1(it.carbs_g)}g · F ${round1(it.fat_g)}g</span>`
                  : "";
                return `<div class="cal-dish">${escapeHtml(it.name)}${macros ? `<br>${macros}` : ""}</div>`;
              }).join("")
            : `<span class="cal-empty">—</span>`;
          return `<td>${content}</td>`;
        })
        .join("");
      return `<tr><th class="meal-type-cell">${escapeHtml(cap(mealType))}</th>${cells}</tr>`;
    })
    .join("");

  // Totals footer row
  const totalCells = days
    .map((d) => {
      const t = d.day_totals;
      return `<td class="cal-totals-cell">${Math.round(t.calories)} kcal<br>${round1(t.protein_g)}g P · ${round1(t.carbs_g)}g C · ${round1(t.fat_g)}g F</td>`;
    })
    .join("");

  // ── Page 2+: recipe cards for selected dishes ─────────────────────────
  const recipeDishes = [...pdfIncludedDishes].filter((name) => recipes[name]);
  const recipesHtml = recipeDishes.length
    ? `<div class="print-recipes-section">
        <h2 class="print-recipes-heading">Recipes</h2>
        ${recipeDishes.map((name) => renderPrintRecipe(name, recipes[name])).join("")}
      </div>`
    : "";

  document.getElementById("print-view").innerHTML = `
    <div class="print-calendar-section">
      <div class="print-cal-header">
        <div class="print-cal-title">🍽️ ${days.length}-Day Indian Meal Plan · ${dietLabel}${proteinLabel}</div>
        <div class="print-cal-meta">Target: ${Math.round(mealPlan.calorie_target)} kcal · ${Math.round(mealPlan.protein_target)}g protein${currentTargets?.carbs_g ? ` · ${Math.round(currentTargets.carbs_g)}g carbs` : ""}${currentTargets?.fat_g ? ` · ${Math.round(currentTargets.fat_g)}g fat` : ""} / day</div>
      </div>
      ${mealPlan.summary ? `<p class="print-cal-summary">${escapeHtml(mealPlan.summary)}</p>` : ""}
      <table class="meal-calendar">
        <thead>
          <tr>
            <th class="meal-type-cell meal-type-header">Meal</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="cal-totals-row">
            <th class="meal-type-cell">Daily totals</th>
            ${totalCells}
          </tr>
        </tbody>
      </table>
    </div>
    ${recipesHtml}
  `;
}

// Recipe card for page 2+ (selected dishes only)
function renderPrintRecipe(name, recipe) {
  const imageHtml = recipe.image_url
    ? `<img src="${escapeHtml(recipe.image_url)}" class="print-recipe-photo" alt="${escapeHtml(name)}" />`
    : "";
  const meta = [
    recipe.serves        ? `Serves ${recipe.serves}` : "",
    recipe.prep_time_min ? `Prep ${recipe.prep_time_min} min` : "",
    recipe.cook_time_min ? `Cook ${recipe.cook_time_min} min` : "",
  ].filter(Boolean).join(" · ");
  const ingredientsHtml = recipe.ingredients?.length
    ? `<div class="print-recipe-block"><strong>Ingredients</strong><ul>${recipe.ingredients.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul></div>`
    : "";
  const stepsHtml = recipe.steps?.length
    ? `<div class="print-recipe-block"><strong>Method</strong><ol>${recipe.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol></div>`
    : "";
  return `
    <div class="print-recipe-card">
      <div class="print-recipe-header">
        ${imageHtml}
        <div>
          <div class="print-recipe-name">${escapeHtml(name)}</div>
          ${meta ? `<div class="print-recipe-meta">${meta}</div>` : ""}
        </div>
      </div>
      <div class="print-recipe-body">
        ${ingredientsHtml}
        ${stepsHtml}
      </div>
    </div>`;
}

// ─── Complete My Day — suggest meals for remaining targets ──────────────────

let suggestDiet          = "veg";
let currentSuggestions   = null; // array returned by the API, kept for PDF/email
let suggestionRemaining  = null; // {calories, protein_g, carbs_g, fat_g} remaining when suggestions were generated

const suggestTriggerCard = document.getElementById("suggest-trigger-card");
const suggestMealsBtn    = document.getElementById("suggest-meals-btn");
const suggestStatusEl    = document.getElementById("suggest-status");
const suggestPanel       = document.getElementById("suggest-panel");
const suggestPanelBody   = document.getElementById("suggest-panel-body");
const suggestPanelFooter = document.getElementById("suggest-panel-footer");
const suggestPanelClose  = document.getElementById("suggest-panel-close");

// Diet toggle inside the trigger card
document.querySelectorAll("#suggest-diet-toggle .diet-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#suggest-diet-toggle .diet-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    suggestDiet = btn.dataset.diet;
  });
});

// Show the trigger card only when a calorie target is set
function updateSuggestCard() {
  if (!suggestTriggerCard) return;
  suggestTriggerCard.style.display = (currentTargets?.calories) ? "block" : "none";
}

// ── Open panel ────────────────────────────────────────────────────────────────
function openSuggestPanelLoading(remaining) {
  suggestPanel.style.display = "flex";
  document.body.style.overflow = "hidden"; // prevent bg scroll while panel is open
  suggestPanelFooter.style.display = "none";
  suggestPanelBody.innerHTML = `
    <div class="suggest-remaining-summary">
      <div class="suggest-remaining-title">Remaining targets today</div>
      <div class="suggest-remaining-chips">${remainingChipsHtml(remaining)}</div>
    </div>
    <div class="suggest-loading">
      <div class="suggest-spinner"></div>
      <div>Finding the best Indian meals for your remaining targets…</div>
      <div class="muted" style="font-size:0.82rem;margin-top:6px">This usually takes 10–20 seconds</div>
    </div>`;
}

function closeSuggestPanel() {
  suggestPanel.style.display = "none";
  document.body.style.overflow = "";
}

suggestPanelClose.addEventListener("click", closeSuggestPanel);

// Close on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && suggestPanel.style.display !== "none") closeSuggestPanel();
});

// ── Main button handler ───────────────────────────────────────────────────────
suggestMealsBtn.addEventListener("click", async () => {
  suggestStatusEl.textContent = "";

  if (!currentTargets?.calories) {
    suggestStatusEl.textContent = "Please set a daily target first (Goals tab → Daily Target).";
    return;
  }

  // Compute what's left for today
  const total = todayTotal || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const remaining = {
    calories:  Math.max(0, (currentTargets.calories  || 0) - (total.calories  || 0)),
    protein_g: Math.max(0, (currentTargets.protein_g || 0) - (total.protein_g || 0)),
    carbs_g:   Math.max(0, (currentTargets.carbs_g   || 0) - (total.carbs_g   || 0)),
    fat_g:     Math.max(0, (currentTargets.fat_g     || 0) - (total.fat_g     || 0)),
  };

  if (remaining.calories < 80) {
    suggestStatusEl.textContent = "🎉 You've already met (or exceeded) your calorie target for today — great job!";
    return;
  }

  // Open the panel immediately with a loading state
  suggestionRemaining = remaining;
  openSuggestPanelLoading(remaining);

  setBusy(suggestMealsBtn, true, "Generating suggestions…");
  try {
    const res = await fetch("/api/meals/suggest-completion", {
      method:  "POST",
      headers: profileHeaders({ "Content-Type": "application/json" }),
      body:    JSON.stringify({
        remaining_calories:  remaining.calories,
        remaining_protein_g: remaining.protein_g,
        remaining_carbs_g:   remaining.carbs_g,
        remaining_fat_g:     remaining.fat_g,
        diet:                suggestDiet,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to generate suggestions.");
    // data now contains { single_dish, suggestions }
    currentSuggestions = data; // keep the whole object for PDF / email
    renderSuggestionsInPanel(data, remaining);
  } catch (err) {
    suggestPanelBody.innerHTML += `<div class="flag over" style="margin:20px">⚠️ ${escapeHtml(err.message)}</div>`;
    suggestPanelFooter.style.display = "none";
  } finally {
    setBusy(suggestMealsBtn, false, "🍽️ Suggest Meals for Rest of Day");
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function remainingChipsHtml(r) {
  return [
    { label: "Calories", value: `${Math.round(r.calories)} kcal` },
    { label: "Protein",  value: `${Math.round(r.protein_g)}g`   },
    { label: "Carbs",    value: `${Math.round(r.carbs_g)}g`     },
    { label: "Fat",      value: `${Math.round(r.fat_g)}g`       },
  ].map((x) => `<div class="suggest-chip"><strong>${x.value}</strong><span>${x.label}</span></div>`).join("");
}

// ── Render results in panel ───────────────────────────────────────────────────
function renderSuggestionsInPanel({ single_dish, suggestions }, remaining) {
  suggestPanelBody.innerHTML = `
    <div class="suggest-remaining-summary">
      <div class="suggest-remaining-title">Remaining targets today</div>
      <div class="suggest-remaining-chips">${remainingChipsHtml(remaining)}</div>
    </div>

    <!-- All-in-one single dish -->
    <div class="suggest-section-label">⭐ All-in-one option</div>
    <div class="suggest-list">
      ${renderSuggestionCard(single_dish, -1)}
    </div>

    <!-- Divider -->
    <div class="suggest-divider">— or spread it across —</div>

    <!-- Multi-dish options -->
    <div class="suggest-section-label">🍽️ Multiple dishes</div>
    <div class="suggest-list">
      ${suggestions.map(renderSuggestionCard).join("")}
    </div>`;

  // Wire recipe expand/collapse for every card
  suggestPanelBody.querySelectorAll(".suggest-recipe-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card  = btn.closest(".suggest-card");
      const block = card.querySelector(".suggest-recipe-block");
      const open  = block.style.display !== "none";
      block.style.display = open ? "none" : "block";
      btn.textContent     = open ? "🍳 View Recipe" : "▲ Hide Recipe";
    });
  });

  suggestPanelFooter.style.display = "block";
}

// i === -1  ➜ single-dish (all-in-one) card; i >= 0 ➜ multi-dish option
function renderSuggestionCard(s, i) {
  const isSingle = i === -1;
  const recipe = s.recipe || {};
  const meta = [
    recipe.serves        ? `Serves ${recipe.serves}`          : "",
    recipe.prep_time_min ? `Prep ${recipe.prep_time_min} min` : "",
    recipe.cook_time_min ? `Cook ${recipe.cook_time_min} min` : "",
  ].filter(Boolean).join(" · ");

  const ingHtml = recipe.ingredients?.length
    ? `<div class="suggest-recipe-section"><strong>Ingredients</strong>
         <ul>${recipe.ingredients.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`
    : "";
  const stepsHtml = recipe.steps?.length
    ? `<div class="suggest-recipe-section"><strong>Method</strong>
         <ol>${recipe.steps.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ol></div>`
    : "";

  const hasRecipe = ingHtml || stepsHtml;
  const tagHtml = isSingle
    ? `<div class="suggest-card-tag suggest-card-tag--single">⭐ Covers everything</div>`
    : `<div class="suggest-card-tag">Option ${i + 1}</div>`;

  return `
    <div class="suggest-card${isSingle ? " suggest-card--single" : ""}">
      ${tagHtml}
      <h3 class="suggest-card-name">${escapeHtml(s.name)}</h3>
      <p class="suggest-card-desc">${escapeHtml(s.description)}</p>
      <div class="suggest-card-portion muted">${escapeHtml(s.portion_desc)}</div>
      <div class="tl-macros" style="margin-top:10px">
        <div class="tl-chip"><b>${Math.round(s.calories)}</b> kcal</div>
        <div class="tl-chip">P <b>${round1(s.protein_g)}g</b></div>
        <div class="tl-chip">C <b>${round1(s.carbs_g)}g</b></div>
        <div class="tl-chip">F <b>${round1(s.fat_g)}g</b></div>
      </div>
      ${hasRecipe ? `
        <button class="suggest-recipe-toggle secondary-btn" style="margin-top:14px;width:auto;padding:8px 14px">🍳 View Recipe</button>
        <div class="suggest-recipe-block" style="display:none">
          ${meta ? `<div class="muted suggest-recipe-meta">${meta}</div>` : ""}
          ${ingHtml}
          ${stepsHtml}
        </div>` : ""}
    </div>`;
}

// ── PDF download ──────────────────────────────────────────────────────────────
document.getElementById("suggest-download-btn").addEventListener("click", () => {
  if (!currentSuggestions) return;
  buildSuggestionPrintView(currentSuggestions, suggestionRemaining);
  window.print();
});

function printDishCard(s, tagLabel) {
  const recipe = s.recipe || {};
  const meta = [
    recipe.serves        ? `Serves ${recipe.serves}`          : "",
    recipe.prep_time_min ? `Prep ${recipe.prep_time_min} min` : "",
    recipe.cook_time_min ? `Cook ${recipe.cook_time_min} min` : "",
  ].filter(Boolean).join(" · ");
  const ingHtml = recipe.ingredients?.length
    ? `<div class="print-recipe-block"><strong>Ingredients</strong>
         <ul>${recipe.ingredients.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`
    : "";
  const stepsHtml = recipe.steps?.length
    ? `<div class="print-recipe-block"><strong>Method</strong>
         <ol>${recipe.steps.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ol></div>`
    : "";
  return `
    <div class="print-recipe-card">
      <div class="print-recipe-header">
        <div>
          <div class="print-suggest-tag">${tagLabel}</div>
          <div class="print-recipe-name">${escapeHtml(s.name)}</div>
          ${meta ? `<div class="print-recipe-meta">${meta}</div>` : ""}
          <div class="print-recipe-meta">
            ${escapeHtml(s.portion_desc)} ·
            ${Math.round(s.calories)} kcal ·
            P ${round1(s.protein_g)}g · C ${round1(s.carbs_g)}g · F ${round1(s.fat_g)}g
          </div>
        </div>
      </div>
      <p style="font-style:italic;color:#555;font-size:12px;margin:6px 0 8px">${escapeHtml(s.description)}</p>
      <div class="print-recipe-body">${ingHtml}${stepsHtml}</div>
    </div>`;
}

function buildSuggestionPrintView({ single_dish, suggestions }, remaining) {
  const remHtml = remaining
    ? `<div class="print-suggest-remaining">
        Remaining targets: ${Math.round(remaining.calories || 0)} kcal ·
        ${Math.round(remaining.protein_g || 0)}g protein ·
        ${Math.round(remaining.carbs_g   || 0)}g carbs ·
        ${Math.round(remaining.fat_g     || 0)}g fat
       </div>`
    : "";

  const singleHtml = single_dish
    ? `<h3 class="print-recipes-heading" style="font-size:14px">⭐ All-in-one option</h3>
       ${printDishCard(single_dish, "⭐ Covers everything")}`
    : "";

  const multiHtml = suggestions?.length
    ? `<h3 class="print-recipes-heading" style="font-size:14px;margin-top:20px">🍽️ Multiple dishes</h3>
       ${suggestions.map((s, i) => printDishCard(s, `Option ${i + 1}`)).join("")}`
    : "";

  document.getElementById("print-view").innerHTML = `
    <div class="print-calendar-section">
      <div class="print-cal-header">
        <div class="print-cal-title">🍽️ Complete My Day — Meal Suggestions</div>
        <div class="print-cal-meta">Generated by Dutta Food Planner &amp; Calorie Counter</div>
      </div>
      ${remHtml}
    </div>
    <div class="print-recipes-section">
      ${singleHtml}
      ${multiHtml}
    </div>`;
}

// ── Email ─────────────────────────────────────────────────────────────────────
document.getElementById("suggest-email-btn").addEventListener("click", async function () {
  const btn       = this;
  const emailInput = document.getElementById("suggest-email-input");
  const statusEl   = document.getElementById("suggest-email-status");
  const email      = (emailInput?.value || "").trim();

  statusEl.textContent = "";
  if (!email) { statusEl.textContent = "Please enter an email address."; return; }
  if (!currentSuggestions?.length) return;

  setBusy(btn, true, "Sending…");
  try {
    const res = await fetch("/api/meals/suggest-completion/email", {
      method:  "POST",
      headers: profileHeaders({ "Content-Type": "application/json" }),
      body:    JSON.stringify({
        email,
        single_dish:  currentSuggestions?.single_dish  || null,
        suggestions:  currentSuggestions?.suggestions  || [],
        remaining:    suggestionRemaining,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to send email.");
    statusEl.textContent = `✓ Sent to ${email}`;
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    setBusy(btn, false, "📧 Send");
  }
});

// --- Apple Health sync card (Goals tab) ---

async function loadHealthSyncCard() {
  const container = document.getElementById("health-sync-section");
  if (!container) return;
  try {
    const res = await fetch("/api/profile/health-token", { headers: profileHeaders() });
    if (!res.ok) return; // silently skip on auth errors
    const data = await res.json();
    renderHealthSyncCard(container, data);
  } catch {
    // supplementary feature — don't surface errors
  }
}

function renderHealthSyncCard(container, data) {
  const { connected, webhookUrl } = data;
  container.innerHTML = `
    <div class="card health-sync-card">
      <h2>⌚ Apple Health Sync</h2>
      <p class="muted" style="margin-bottom:14px">
        Connect the free <strong>Health Auto Export</strong> app (by Gregory Yount) to automatically
        push your steps, burned calories, and exercise minutes from Apple Health every day.
        Your calorie budget on the Today tab will update to reflect what you've burned.
      </p>
      ${connected ? `
        <div class="health-sync-status-row">
          <span class="health-sync-badge connected">✓ Connected</span>
        </div>
        <p class="muted" style="margin:10px 0 4px;font-size:0.82rem">Your webhook URL <span class="muted">(tap to copy)</span>:</p>
        <div class="health-sync-url" id="health-sync-url-display">${escapeHtml(webhookUrl)}</div>
        <div id="health-sync-copy-msg" class="muted" style="font-size:0.78rem;min-height:1.2em;margin-top:3px"></div>
        <div style="margin-top:10px">
          <button id="health-sync-revoke-btn" class="secondary-btn" type="button">Disconnect</button>
        </div>
        <details class="health-sync-setup" open>
          <summary>📱 How to set up Health Auto Export</summary>
          <ol class="health-sync-steps">
            <li>Install <strong>Health Auto Export</strong> from the App Store (free, by Gregory Yount).</li>
            <li>Open the app → tap <strong>Automations</strong> → <strong>+</strong> → <strong>REST API Automation</strong>.</li>
            <li>Paste the URL above into the <strong>URL</strong> field. Set Method to <strong>POST</strong>.</li>
            <li>Under <strong>Metrics</strong>, enable: <em>Step Count</em>, <em>Active Energy Burned</em>, <em>Resting Energy Burned</em>, <em>Exercise Time</em>.</li>
            <li>Set <strong>Export Frequency</strong> to <em>Daily</em> and save. Done!</li>
          </ol>
          <p class="muted" style="margin:8px 0 0;font-size:0.8rem">The app pushes the previous day's data every morning. Your Today tab will show steps and burned calories as soon as it syncs.</p>
        </details>
      ` : `
        <div class="health-sync-status-row">
          <span class="health-sync-badge disconnected">Not connected</span>
        </div>
        <p class="muted" style="margin:10px 0 14px;font-size:0.88rem">
          Generate a private webhook URL for this profile, then paste it into Health Auto Export on your iPhone.
          No Apple developer account or OAuth needed.
        </p>
        <button id="health-sync-connect-btn" class="primary-btn" type="button">🔗 Generate Webhook URL</button>
      `}
      <div id="health-sync-error" class="flag over" style="display:none;margin-top:10px"></div>
    </div>`;

  if (connected) {
    const urlEl     = document.getElementById("health-sync-url-display");
    const copyMsg   = document.getElementById("health-sync-copy-msg");
    urlEl?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(webhookUrl);
        copyMsg.textContent = "✓ Copied to clipboard";
        setTimeout(() => { copyMsg.textContent = ""; }, 2500);
      } catch {
        copyMsg.textContent = "Tap and hold the URL to copy manually.";
      }
    });

    document.getElementById("health-sync-revoke-btn")?.addEventListener("click", async () => {
      const errEl = document.getElementById("health-sync-error");
      errEl.style.display = "none";
      if (!confirm("Disconnect Apple Health sync? Your historical exercise data will be kept.")) return;
      const btn = document.getElementById("health-sync-revoke-btn");
      setBusy(btn, true, "Disconnecting…");
      try {
        const r = await fetch("/api/profile/health-token", { method: "DELETE", headers: profileHeaders() });
        if (!r.ok) throw new Error((await r.json()).error || "Failed to disconnect.");
        await loadHealthSyncCard();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = "block";
        setBusy(btn, false, "Disconnect");
      }
    });
  } else {
    document.getElementById("health-sync-connect-btn")?.addEventListener("click", async () => {
      const errEl = document.getElementById("health-sync-error");
      errEl.style.display = "none";
      const btn = document.getElementById("health-sync-connect-btn");
      setBusy(btn, true, "Generating…");
      try {
        const r = await fetch("/api/profile/health-token", { method: "POST", headers: profileHeaders() });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed to generate URL.");
        await loadHealthSyncCard();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = "block";
        setBusy(btn, false, "🔗 Generate Webhook URL");
      }
    });
  }
}

// --- Weight Goal tab ---

// Sex toggle state for the weight-goal inline form (separate from Target tab's)
let wgSelectedSex = "male";

async function loadWeightGoal() {
  // Render into the sub-div so the static Daily Target card above is preserved
  const container = document.getElementById("goal-assessment");

  // Ensure bio is in memory (enterApp() loads it but may not have awaited yet)
  if (!currentBio) await loadBio();

  // If bio is incomplete, show the inline bio form so the user can fill it in
  const bioOk = currentBio && currentBio.weight_kg && currentBio.height_cm && currentBio.age && currentBio.sex;
  if (!bioOk) {
    renderWeightGoalForm(container, currentBio || {});
    return;
  }

  container.innerHTML = `<div class="empty-state">Calculating your ideal weight...</div>`;
  try {
    const res = await fetch("/api/weight-goal", { headers: profileHeaders() });
    const data = await res.json();
    if (!res.ok) {
      if (data.needsBio) { renderWeightGoalForm(container, currentBio || {}); return; }
      throw new Error(data.error || "Failed to load assessment.");
    }
    renderWeightGoalResult(container, data);
  } catch (err) {
    container.innerHTML = `<div class="flag over">⚠️ ${escapeHtml(err.message)}</div>`;
  }
}

// Inline bio form shown when the profile has no saved bio yet
function renderWeightGoalForm(container, bio) {
  wgSelectedSex = bio.sex || "male";
  container.innerHTML = `
    <div class="card">
      <h2>⚖️ Find Your Ideal Weight</h2>
      <p class="muted" style="margin-bottom:14px">Enter your details — we'll calculate your ideal weight and build a personalised weight-loss plan.</p>
      <label for="wg-age">Age</label>
      <input type="number" id="wg-age" placeholder="e.g. 35" min="2" max="120" value="${escapeHtml(String(bio.age || ""))}" />
      <label>Sex</label>
      <div class="diet-toggle">
        <button type="button" class="sex-btn wg-sex-btn${wgSelectedSex === "male" ? " active" : ""}" data-sex="male">Male</button>
        <button type="button" class="sex-btn wg-sex-btn${wgSelectedSex === "female" ? " active" : ""}" data-sex="female">Female</button>
      </div>
      <label for="wg-weight">Current weight (kg)</label>
      <input type="number" id="wg-weight" placeholder="e.g. 75" min="10" max="300" value="${escapeHtml(String(bio.weight_kg || ""))}" />
      <label for="wg-height">Height (cm)</label>
      <input type="number" id="wg-height" placeholder="e.g. 170" min="50" max="250" value="${escapeHtml(String(bio.height_cm || ""))}" />
      <label for="wg-activity">Activity level</label>
      <select id="wg-activity">
        <option value="sedentary"  ${(bio.activity === "sedentary")  ? "selected" : ""}>Sedentary (little/no exercise)</option>
        <option value="light"      ${(!bio.activity || bio.activity === "light") ? "selected" : ""}>Lightly active (1-3 days/week)</option>
        <option value="moderate"   ${(bio.activity === "moderate")   ? "selected" : ""}>Moderately active (3-5 days/week)</option>
        <option value="active"     ${(bio.activity === "active")     ? "selected" : ""}>Very active (6-7 days/week)</option>
        <option value="very_active"${(bio.activity === "very_active") ? "selected" : ""}>Extremely active (physical job + training)</option>
      </select>
      <button id="wg-calc-btn" class="primary-btn" type="button">Calculate My Ideal Weight</button>
      <div id="wg-form-error" class="flag over" style="display:none"></div>
    </div>`;

  // Sex toggle
  container.querySelectorAll(".wg-sex-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".wg-sex-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      wgSelectedSex = btn.dataset.sex;
    });
  });

  // Submit — saves bio via existing endpoint, then fetches weight-goal
  container.querySelector("#wg-calc-btn").addEventListener("click", async () => {
    const errEl = container.querySelector("#wg-form-error");
    errEl.style.display = "none";
    const age = Number(container.querySelector("#wg-age").value);
    const weight_kg = Number(container.querySelector("#wg-weight").value);
    const height_cm = Number(container.querySelector("#wg-height").value);
    const activity = container.querySelector("#wg-activity").value;

    if (!age || age < 2 || age > 120)            { errEl.textContent = "Enter a valid age (2-120)."; errEl.style.display = "block"; return; }
    if (!weight_kg || weight_kg < 10 || weight_kg > 300) { errEl.textContent = "Enter a valid weight (10-300 kg)."; errEl.style.display = "block"; return; }
    if (!height_cm || height_cm < 50 || height_cm > 250) { errEl.textContent = "Enter a valid height (50-250 cm)."; errEl.style.display = "block"; return; }

    const calcBtn = container.querySelector("#wg-calc-btn");
    setBusy(calcBtn, true, "Calculating...");
    try {
      // Save bio (reuses the Target tab's bio-save endpoint)
      const bioRes = await fetch("/api/profile/targets/calculate", {
        method: "POST",
        headers: profileHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ age, sex: wgSelectedSex, weight_kg, height_cm, activity }),
      });
      if (!bioRes.ok) {
        const d = await bioRes.json();
        throw new Error(d.error || "Failed to save details.");
      }
      // Keep currentBio in sync
      currentBio = { age, sex: wgSelectedSex, weight_kg, height_cm, activity };

      // Now fetch the weight goal assessment
      container.innerHTML = `<div class="empty-state">Calculating your ideal weight...</div>`;
      const res = await fetch("/api/weight-goal", { headers: profileHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load assessment.");
      renderWeightGoalResult(container, data);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = "block";
      setBusy(calcBtn, false, "Calculate My Ideal Weight");
    }
  });
}

const BMI_BADGE_CLASS = { "Underweight": "bmi-under", "Normal weight": "bmi-normal", "Overweight": "bmi-over", "Obese": "bmi-obese" };

function renderWeightGoalResult(container, data) {
  const badgeClass = BMI_BADGE_CLASS[data.bmi_category] || "bmi-normal";

  // --- Card 1: BMI & assessment ---
  const bmiCard = `
    <div class="card">
      <h2>Your Weight Assessment</h2>
      <div class="bmi-row">
        <div class="bmi-big">${data.bmi}</div>
        <div>
          <div class="bmi-badge ${badgeClass}">${escapeHtml(data.bmi_category)}</div>
          <div class="muted" style="margin-top:4px">BMI (Body Mass Index)</div>
        </div>
      </div>
      <div class="wg-stats">
        <div class="wg-stat-row"><span>Current weight</span><strong>${data.current_weight_kg} kg</strong></div>
        <div class="wg-stat-row"><span>Ideal weight</span><strong>${data.ideal_weight_kg} kg</strong></div>
        <div class="wg-stat-row"><span>Healthy range</span><strong>${data.ideal_range.lower}–${data.ideal_range.upper} kg</strong></div>
        ${data.weight_to_lose_kg > 0 ? `
          <div class="wg-stat-row wg-stat-highlight"><span>To reach ideal</span><strong>Lose ${data.weight_to_lose_kg} kg</strong></div>
          <div class="wg-stat-row"><span>Estimated timeline</span><strong>~${data.estimated_weeks} weeks</strong> at 0.5 kg/week</div>
        ` : ""}
      </div>
      ${data.at_ideal_weight ? `<div class="flag under" style="margin-top:10px">🎉 You're in the healthy weight range — great work! Focus on maintaining with a balanced diet and regular movement.</div>` : ""}
      ${data.is_underweight ? `<div class="flag over" style="margin-top:10px">⚠️ Your BMI is below the healthy range. Please speak with a doctor or dietitian about a safe weight-gain plan.</div>` : ""}
    </div>`;

  // --- Card 2: Diet targets (only if overweight) ---
  let dietCard = "";
  if (data.weight_to_lose_kg > 0 && data.loss_targets) {
    const t = data.loss_targets;
    dietCard = `
      <div class="card" id="wg-diet-card">
        <h2>🍽️ Daily Targets for Weight Loss</h2>
        <div class="muted" style="margin-bottom:12px">
          500 kcal below your maintenance (${Math.round(t.maintenance_calories)} kcal) — a safe rate of ~0.5 kg/week fat loss.
        </div>
        <div class="wg-targets-grid">
          <div class="wg-target-cell"><div class="wg-target-val">${Math.round(t.calories).toLocaleString()}</div><div class="wg-target-lbl">Calories</div></div>
          <div class="wg-target-cell"><div class="wg-target-val">${t.protein_g}g</div><div class="wg-target-lbl">Protein</div></div>
          <div class="wg-target-cell"><div class="wg-target-val">${t.carbs_g}g</div><div class="wg-target-lbl">Carbs</div></div>
          <div class="wg-target-cell"><div class="wg-target-val">${t.fat_g}g</div><div class="wg-target-lbl">Fat</div></div>
        </div>
        <div class="muted" style="margin:10px 0">Higher protein (${t.protein_g}g) helps preserve muscle while you lose fat.</div>
        <button id="wg-apply-target-btn" class="primary-btn" type="button">✅ Apply These Targets</button>
        <div id="wg-apply-status" class="muted" style="margin-top:8px;display:none"></div>
        <button id="wg-go-mealplan-btn" class="secondary-btn" type="button">🥗 Generate Weight-Loss Meal Plan</button>
      </div>`;
  }

  // --- Card 3: Exercise plan (lazy) ---
  const exerciseCard = `
    <div class="card" id="wg-exercise-card">
      <h2>🏃 Exercise Plan</h2>
      <div class="muted" style="margin-bottom:12px">Get a personalised, beginner-friendly weekly exercise plan generated by AI — no gym equipment required.</div>
      <button id="wg-exercise-btn" class="secondary-btn" type="button">🤖 Generate My Exercise Plan</button>
      <div id="wg-exercise-result"></div>
    </div>`;

  // --- Recalculate link ---
  const recalcHtml = `<div style="text-align:center;margin-top:4px"><button class="link-btn" id="wg-recalc-btn">↩ Update my details</button></div>`;

  container.innerHTML = bmiCard + dietCard + exerciseCard + recalcHtml;

  // Apply target button
  const applyBtn = container.querySelector("#wg-apply-target-btn");
  if (applyBtn && data.loss_targets) {
    applyBtn.addEventListener("click", async () => {
      const statusEl = container.querySelector("#wg-apply-status");
      setBusy(applyBtn, true, "Saving...");
      try {
        const res = await fetch("/api/profile/targets", {
          method: "PUT",
          headers: profileHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            calories: data.loss_targets.calories,
            protein_g: data.loss_targets.protein_g,
            carbs_g: data.loss_targets.carbs_g,
            fat_g: data.loss_targets.fat_g,
          }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Failed to save target.");
        currentTargets = d.targets;
        renderTargetDisplay(); // refresh the Target tab display
        statusEl.textContent = "✅ Daily target updated! Head to Today tab to track your progress.";
        statusEl.style.display = "block";
      } catch (err) {
        statusEl.textContent = `⚠️ ${err.message}`;
        statusEl.style.display = "block";
      } finally {
        setBusy(applyBtn, false, "✅ Apply These Targets");
      }
    });
  }

  // Go to Meal Plan tab with weight-loss targets pre-filled
  const mealPlanBtn = container.querySelector("#wg-go-mealplan-btn");
  if (mealPlanBtn && data.loss_targets) {
    mealPlanBtn.addEventListener("click", () => {
      // Switch to Meal Plan tab and pre-fill with loss targets
      activateTab("plan");
      planCaloriesInput.value = Math.round(data.loss_targets.calories);
      planProteinInput.value  = Math.round(data.loss_targets.protein_g);
      planTargetHint.textContent = "Pre-filled with your weight-loss targets — generate your plan below.";
      planTargetHint.style.display = "block";
      loadMealPlan();
    });
  }

  // Recalculate — go back to the form
  container.querySelector("#wg-recalc-btn").addEventListener("click", () => {
    renderWeightGoalForm(container, currentBio || {});
  });

  // Exercise plan generation (lazy)
  const exerciseBtn = container.querySelector("#wg-exercise-btn");
  exerciseBtn.addEventListener("click", async () => {
    const resultEl = container.querySelector("#wg-exercise-result");
    setBusy(exerciseBtn, true, "Generating exercise plan... (~20s)");
    try {
      const res = await fetch("/api/weight-goal/exercises", {
        method: "POST",
        headers: profileHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          weight_to_lose_kg: data.weight_to_lose_kg,
          age:               data.age,
          activity:          data.activity,
          sex:               data.sex,
          bmi:               data.bmi,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to generate plan.");
      resultEl.innerHTML = renderExercisePlan(d.plan);
      exerciseBtn.style.display = "none";
    } catch (err) {
      resultEl.innerHTML = `<div class="flag over" style="margin-top:10px">⚠️ ${escapeHtml(err.message)}</div>`;
      setBusy(exerciseBtn, false, "🤖 Generate My Exercise Plan");
    }
  });
}

function intensityBadge(intensity) {
  const map = { low: "🟢 Low", moderate: "🟡 Moderate", vigorous: "🔴 Vigorous" };
  return map[intensity] || intensity;
}

function renderExercisePlan(plan) {
  if (!plan) return `<div class="flag over">No plan returned.</div>`;

  const cardioHtml = (plan.cardio || []).map((c) => `
    <div class="ex-item">
      <div class="ex-name">${escapeHtml(c.activity)}</div>
      <div class="ex-meta">${c.duration_min} min · ${c.days_per_week}×/week · ${intensityBadge(c.intensity)}</div>
      ${c.tip ? `<div class="ex-tip">${escapeHtml(c.tip)}</div>` : ""}
    </div>`).join("");

  const strengthHtml = (plan.strength || []).map((s) => {
    const query = encodeURIComponent(s.search_query || `how to do ${s.exercise}`);
    const videoUrl = `https://www.youtube.com/results?search_query=${query}`;
    return `
    <div class="ex-item">
      <div class="ex-name">
        ${escapeHtml(s.exercise)}
        <a href="${videoUrl}" target="_blank" rel="noopener noreferrer" class="ex-video-link">▶ How to</a>
      </div>
      <div class="ex-meta">${s.sets} sets · ${escapeHtml(s.reps)} · ${s.days_per_week}×/week</div>
    </div>`;
  }).join("");

  const tipsHtml = (plan.tips || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");

  return `
    <div class="ex-summary">${escapeHtml(plan.summary || "")}</div>

    <div class="ex-section-title">❤️ Cardio</div>
    <div class="ex-list">${cardioHtml}</div>

    <div class="ex-section-title">💪 Strength Training</div>
    <div class="ex-list">${strengthHtml}</div>

    ${tipsHtml ? `
    <div class="ex-section-title">💡 Tips</div>
    <ul class="ex-tips">${tipsHtml}</ul>` : ""}

    ${plan.est_weekly_calories_burned ? `<div class="muted" style="margin-top:12px">Estimated extra calories burned from exercise: ~${Math.round(plan.est_weekly_calories_burned).toLocaleString()} kcal/week</div>` : ""}
  `;
}

// --- Progress tab (7-day performance charts) ---

async function loadProgress() {
  const container = document.getElementById("tab-progress");
  container.innerHTML = `<div class="empty-state">Loading your progress...</div>`;
  try {
    const [progressRes, weightRes] = await Promise.all([
      fetch("/api/progress?days=7",            { headers: profileHeaders() }),
      fetch("/api/profile/weight?months=6",    { headers: profileHeaders() }),
    ]);
    const data       = await progressRes.json();
    if (!progressRes.ok) throw new Error(data.error || "Failed to load progress.");
    const weightData = weightRes.ok ? await weightRes.json() : { entries: [] };
    renderProgress(data.days || [], weightData.entries || []);
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

function renderProgress(dayRows, weightEntries = []) {
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

  // Weight line chart — only shown if at least 2 entries exist
  const latestW = weightEntries.length ? weightEntries[weightEntries.length - 1] : null;
  const weightHtml = weightEntries.length >= 2
    ? `<div class="card">
        <div class="weight-header">
          <h2>⚖️ Weight — 6 Months</h2>
          ${latestW ? `<div class="weight-latest">${latestW.weight_kg} kg <span class="muted">${new Date(latestW.logged_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span></div>` : ""}
        </div>
        <div class="weight-chart-wrap">${weightChartSvg(weightEntries)}</div>
      </div>`
    : "";

  container.innerHTML = `
    <div class="card">
      <h2>📈 Last 7 Days</h2>
      <div class="muted">${loggedCount} of 7 days logged${loggedCount === 0 ? " — start logging meals to see your progress!" : ""}</div>
    </div>
    <div id="week-overview"></div>
    <div id="ai-summary-card" class="card ai-summary-card">
      <div class="ai-summary-loading">
        <div class="ai-shimmer ai-shimmer-score"></div>
        <div class="ai-shimmer ai-shimmer-line" style="width:90%"></div>
        <div class="ai-shimmer ai-shimmer-line" style="width:75%"></div>
      </div>
    </div>
    ${nutrientsHtml}
    ${weightHtml}
  `;

  // Populate the 7-day macro overview table immediately (data already in hand)
  render7DayTable(document.getElementById("week-overview"), dayRows);

  // Kick off AI summary async — fills in #ai-summary-card when ready.
  // week is ordered oldest→newest (index 0 = 6 days ago, index 6 = today).
  // Drop the last slot (today) — today's log is still in progress and
  // partial data would skew the AI's analysis.
  const weekForAi = week.slice(0, -1); // drop today (last element)
  const loggedCountForAi = weekForAi.filter((d) => d.hasData).length;
  if (loggedCountForAi > 0) {
    loadProgressAiSummary(weekForAi);
  } else {
    document.getElementById("ai-summary-card").innerHTML =
      `<div class="muted" style="font-size:0.85rem">Log at least one full day of meals to get your AI diet summary.</div>`;
  }

}

// ── Weight tab ───────────────────────────────────────────────────────────────

async function loadHealthTab() {
  const container = document.getElementById("tab-health");
  container.innerHTML = `<div class="empty-state">Loading health data…</div>`;
  try {
    const [weightRes, activityRes] = await Promise.all([
      fetch("/api/profile/weight?months=6",          { headers: profileHeaders() }),
      fetch("/api/profile/exercise/history?days=14", { headers: profileHeaders() }),
    ]);
    const weightData   = weightRes.ok   ? await weightRes.json()   : { entries: [] };
    const activityData = activityRes.ok ? await activityRes.json() : { entries: [] };

    container.innerHTML = `<div id="health-weight-section"></div><div id="health-activity-section"></div>`;
    renderWeightSection(document.getElementById("health-weight-section"), weightData.entries || []);
    renderActivitySection(document.getElementById("health-activity-section"), activityData.entries || []);
  } catch (err) {
    container.innerHTML = `<div class="flag over">⚠️ ${escapeHtml(err.message)}</div>`;
  }
}

// ── Activity section (manual entry) ──────────────────────────────────────────

function renderActivitySection(container, historyEntries) {
  if (!container) return;

  const today = new Date().toISOString().slice(0, 10);

  // Build a lookup map from recent history so we can pre-fill on date change
  const byDate = {};
  (historyEntries || []).forEach(e => { byDate[e.date] = e; });

  // Today's data (if any) — used to pre-populate the form initially
  const todayData = byDate[today] || {};

  // Recent history table (show last 14 days that have data)
  const histRows = historyEntries.filter(e => e.steps || e.active_calories || e.exercise_minutes);
  const histHtml = histRows.length ? `
    <div class="act-history">
      <div class="act-history-title muted" style="font-size:0.8rem;margin-bottom:6px">Recent entries</div>
      ${histRows.map(e => {
        const d = parseDateLocal(e.date);
        const label = d.toLocaleDateString([], { weekday:"short", month:"short", day:"numeric" });
        const parts = [];
        if (e.steps)            parts.push(`👣 ${e.steps.toLocaleString()}`);
        if (e.active_calories)  parts.push(`🔥 ${Math.round(e.active_calories)} kcal`);
        if (e.exercise_minutes) parts.push(`⏱️ ${e.exercise_minutes} min`);
        const src = e.source === "apple_health" ? " · ⌚ Auto" : "";
        return `<div class="act-history-row">
          <span class="act-history-date">${label}</span>
          <span class="act-history-data">${parts.join(" · ")}${src}</span>
        </div>`;
      }).join("")}
    </div>` : "";

  container.innerHTML = `
    <div class="card">
      <h2>🏃 Daily Activity</h2>
      <p class="muted" style="margin-bottom:14px">Enter any values you know — all fields are optional. Saving only updates the fields you fill in.</p>
      <label for="act-date">Date</label>
      <input type="date" id="act-date" value="${today}" max="${today}" />
      <div class="act-grid">
        <div>
          <label for="act-steps">Steps</label>
          <input type="number" id="act-steps" placeholder="e.g. 8 000" min="0" max="200000" step="1"
            value="${todayData.steps || ""}" />
        </div>
        <div>
          <label for="act-active-cal">Active calories (kcal)</label>
          <input type="number" id="act-active-cal" placeholder="e.g. 400" min="0" max="10000" step="1"
            value="${todayData.active_calories ? Math.round(todayData.active_calories) : ""}" />
        </div>
        <div>
          <label for="act-rest-cal">Resting calories (kcal)</label>
          <input type="number" id="act-rest-cal" placeholder="e.g. 1 650" min="0" max="10000" step="1"
            value="${todayData.resting_calories ? Math.round(todayData.resting_calories) : ""}" />
        </div>
        <div>
          <label for="act-mins">Exercise (minutes)</label>
          <input type="number" id="act-mins" placeholder="e.g. 30" min="0" max="1440" step="1"
            value="${todayData.exercise_minutes || ""}" />
        </div>
      </div>
      <button id="act-save-btn" class="primary-btn" type="button" style="margin-top:12px">Save Activity</button>
      <div id="act-status" class="muted" style="margin-top:6px;min-height:1.2em"></div>
      <p class="muted" style="margin-top:14px;font-size:0.8rem">💡 Prefer automatic sync? Connect Apple Health in the <strong>🎯 Goals</strong> tab — no manual entry needed.</p>
      ${histHtml}
    </div>`;

  // Date picker → pre-populate form with that day's existing data
  document.getElementById("act-date")?.addEventListener("change", async (e) => {
    const date = e.target.value;
    // Check local cache first
    if (byDate[date]) {
      fillActivityForm(byDate[date]);
      return;
    }
    // Otherwise fetch from server
    try {
      const res = await fetch(`/api/profile/exercise?date=${date}`, { headers: profileHeaders() });
      const d = res.ok ? await res.json() : {};
      fillActivityForm(d.exercise || {});
    } catch { fillActivityForm({}); }
  });

  function fillActivityForm(data) {
    document.getElementById("act-steps").value        = data.steps            || "";
    document.getElementById("act-active-cal").value   = data.active_calories  ? Math.round(data.active_calories)  : "";
    document.getElementById("act-rest-cal").value     = data.resting_calories ? Math.round(data.resting_calories) : "";
    document.getElementById("act-mins").value         = data.exercise_minutes || "";
  }

  // Save button
  document.getElementById("act-save-btn")?.addEventListener("click", async () => {
    const date     = document.getElementById("act-date").value;
    const steps    = document.getElementById("act-steps").value.trim();
    const activeCal= document.getElementById("act-active-cal").value.trim();
    const restCal  = document.getElementById("act-rest-cal").value.trim();
    const mins     = document.getElementById("act-mins").value.trim();
    const statusEl = document.getElementById("act-status");

    if (!steps && !activeCal && !restCal && !mins) {
      statusEl.textContent = "Enter at least one value."; return;
    }

    const body = { date };
    if (steps)     body.steps            = Number(steps);
    if (activeCal) body.active_calories  = Number(activeCal);
    if (restCal)   body.resting_calories = Number(restCal);
    if (mins)      body.exercise_minutes = Number(mins);

    const btn = document.getElementById("act-save-btn");
    setBusy(btn, true, "Saving…");
    statusEl.textContent = "";

    try {
      const r = await fetch("/api/profile/exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...profileHeaders() },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to save.");
      statusEl.textContent = "✓ Activity saved";
      // Update local cache and refresh history list
      byDate[date] = d.entry;
      await refreshActivitySection();
      // Also refresh Today tab exercise banner if the date is today
      if (date === new Date().toISOString().slice(0, 10)) {
        todayExercise = d.entry;
        renderTodayExercise(document.getElementById("today-exercise"), todayExercise);
        // Refresh the day-total summary line (zone panels already rendered)
        const _summEl = document.getElementById("today-summary");
        if (_summEl) {
          const _line = daySummaryLine(todayTotal || {});
          _summEl.textContent = _line;
          _summEl.style.display = _line ? "block" : "none";
        }
      }
    } catch (err) {
      statusEl.textContent = err.message;
    } finally {
      setBusy(btn, false, "Save Activity");
    }
  });
}

// ── Weight chart + log form ───────────────────────────────────────────────────

function weightChartSvg(entries) {
  if (!entries.length) return "";

  const W = 340, H = 180;
  const padL = 40, padR = 10, padT = 14, padB = 28;
  const cW = W - padL - padR;
  const cH = H - padT - padB;

  // 6-month window ending today
  const toTs   = Date.now();
  const fromDt = new Date();
  fromDt.setMonth(fromDt.getMonth() - 6);
  fromDt.setHours(0, 0, 0, 0);
  const fromTs = fromDt.getTime();
  const spanMs = toTs - fromTs;

  // Filter to entries in the window
  const pts = entries
    .map(e => ({ ts: new Date(e.logged_at).getTime(), w: e.weight_kg, id: e.id }))
    .filter(p => p.ts >= fromTs && p.ts <= toTs)
    .sort((a, b) => a.ts - b.ts);

  if (!pts.length) {
    // entries exist but all outside the window — should be rare
    return `<div class="muted" style="text-align:center;padding:16px 0;font-size:0.85rem">No entries in the last 6 months.</div>`;
  }

  // Auto-scale Y axis
  const weights = pts.map(p => p.w);
  const rawMin  = Math.min(...weights);
  const rawMax  = Math.max(...weights);
  const pad     = Math.max(1, (rawMax - rawMin) * 0.25) || 2;
  const minW    = Math.floor((rawMin - pad) * 2) / 2;
  const maxW    = Math.ceil((rawMax + pad) * 2) / 2;
  const wSpan   = maxW - minW || 1;

  const xPos = ts => padL + ((ts - fromTs) / spanMs) * cW;
  const yPos = kg => padT + (1 - (kg - minW) / wSpan) * cH;

  // Y-axis grid ticks
  const rawStep = (maxW - minW) / 4;
  const step = rawStep < 1 ? 0.5 : rawStep < 2.5 ? 1 : rawStep < 5 ? 2 : 5;
  const yTicks = [];
  let t = Math.ceil(minW / step) * step;
  while (t <= maxW + 0.01) { yTicks.push(Math.round(t * 10) / 10); t = Math.round((t + step) * 10) / 10; }

  const gridLines = yTicks.map(val => {
    const y = yPos(val).toFixed(1);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-width="1"/>
            <text x="${padL - 4}" y="${(+y + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${val}</text>`;
  }).join("");

  // Month separator lines + labels
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthLines = [];
  const mc = new Date(fromDt); mc.setDate(1); mc.setHours(0, 0, 0, 0);
  if (mc.getTime() <= fromTs) mc.setMonth(mc.getMonth() + 1);
  while (mc.getTime() <= toTs) {
    const x = xPos(mc.getTime()).toFixed(1);
    monthLines.push(
      `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3,3"/>
       <text x="${x}" y="${H - padB + 12}" text-anchor="middle" font-size="9" fill="var(--muted)">${MON[mc.getMonth()]}</text>`
    );
    mc.setMonth(mc.getMonth() + 1);
  }

  // SVG path
  const pathCoords = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xPos(p.ts).toFixed(1)},${yPos(p.w).toFixed(1)}`).join(" ");
  const areaClose  = pts.length > 1
    ? `L${xPos(pts[pts.length-1].ts).toFixed(1)},${H - padB} L${xPos(pts[0].ts).toFixed(1)},${H - padB}Z`
    : "";

  const area = pts.length > 1
    ? `<path d="${pathCoords} ${areaClose}" fill="var(--accent)" fill-opacity="0.07"/>`
    : "";
  const line = pts.length > 1
    ? `<path d="${pathCoords}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    : "";

  const dots = pts.map((p, i) => {
    const isLast = i === pts.length - 1;
    const cx = xPos(p.ts).toFixed(1);
    const cy = yPos(p.w).toFixed(1);
    const dateLabel = new Date(p.ts).toLocaleDateString([], { month:"short", day:"numeric" });
    return `<circle cx="${cx}" cy="${cy}" r="${isLast ? 4.5 : 3}" fill="${isLast ? "var(--accent)" : "var(--card)"}" stroke="var(--accent)" stroke-width="2">
              <title>${p.w} kg · ${dateLabel}</title>
            </circle>`;
  }).join("");

  // Latest weight label — position to avoid clipping
  const last = pts[pts.length - 1];
  const lx = Math.min(xPos(last.ts) + 7, W - padR - 30);
  const ly = Math.max(yPos(last.w) - 5, padT + 10);

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">
    ${gridLines}
    ${monthLines.join("")}
    ${area}
    ${line}
    ${dots}
    <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="10" font-weight="700" fill="var(--accent)">${last.w}kg</text>
  </svg>`;
}

function renderWeightSection(container, entries) {
  if (!container) return;

  const now      = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const timeStr  = now.toTimeString().slice(0, 5);

  const latest       = entries.length ? entries[entries.length - 1] : null;
  const latestKg     = latest ? `${latest.weight_kg} kg` : null;
  const latestDateLbl = latest
    ? new Date(latest.logged_at).toLocaleDateString([], { month: "short", day: "numeric" })
    : null;

  const chartHtml = entries.length
    ? `<div class="weight-chart-wrap">${weightChartSvg(entries)}</div>`
    : `<p class="muted" style="text-align:center;padding:20px 0 8px">No entries yet — log your first weigh-in below.</p>`;

  // Entry list (newest first, up to 30)
  const listItems = [...entries].reverse().slice(0, 30);
  const listHtml = listItems.length
    ? `<div class="weight-entry-list">
        ${listItems.map(e => {
          const d = new Date(e.logged_at);
          const dateLbl = d.toLocaleDateString([], { weekday:"short", month:"short", day:"numeric" });
          const timeLbl = d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
          return `<div class="weight-entry-row">
            <div class="weight-entry-info">
              <span class="weight-entry-kg">${e.weight_kg} kg</span>
              <span class="weight-entry-meta">${dateLbl} · ${timeLbl}</span>
              ${e.note ? `<span class="weight-entry-note">${escapeHtml(e.note)}</span>` : ""}
            </div>
            <button class="weight-delete-btn icon-btn" data-id="${e.id}" type="button" title="Delete">🗑</button>
          </div>`;
        }).join("")}
      </div>`
    : "";

  container.innerHTML = `
    <div class="card">
      <h2>⚖️ Log a Weigh-in</h2>
      <div class="weight-log-grid">
        <div>
          <label for="wl-kg">Weight (kg)</label>
          <input type="number" id="wl-kg" placeholder="e.g. 72.5" min="10" max="500" step="0.1" />
        </div>
        <div>
          <label for="wl-date">Date</label>
          <input type="date" id="wl-date" value="${todayStr}" max="${todayStr}" />
        </div>
        <div>
          <label for="wl-time">Time</label>
          <input type="time" id="wl-time" value="${timeStr}" />
        </div>
      </div>
      <label for="wl-note" style="margin-top:8px;display:block">Note <span class="label-opt">(optional)</span></label>
      <input type="text" id="wl-note" placeholder="e.g. after morning walk, fasted" maxlength="200" />
      <button id="wl-submit" class="primary-btn" type="button" style="margin-top:10px">Log Weight</button>
      <div id="wl-status" class="muted" style="margin-top:6px;min-height:1.2em"></div>
    </div>
    ${listHtml ? `<div class="card"><h2>Recent Weigh-ins</h2>${listHtml}</div>` : ""}`;

  // Wire log button
  document.getElementById("wl-submit")?.addEventListener("click", async () => {
    const kg      = parseFloat(document.getElementById("wl-kg").value);
    const date    = document.getElementById("wl-date").value;
    const time    = document.getElementById("wl-time").value || "00:00";
    const note    = document.getElementById("wl-note").value.trim();
    const statusEl = document.getElementById("wl-status");

    if (!kg || !Number.isFinite(kg) || kg < 10 || kg > 500) {
      statusEl.textContent = "Enter a valid weight between 10 and 500 kg."; return;
    }
    if (!date) { statusEl.textContent = "Select a date."; return; }

    // Build ISO timestamp in local time (JS treats "2026-08-23T09:30:00" as local)
    const logged_at = new Date(`${date}T${time}:00`).toISOString();
    const btn = document.getElementById("wl-submit");
    setBusy(btn, true, "Saving…");
    statusEl.textContent = "";

    try {
      const r = await fetch("/api/profile/weight", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...profileHeaders() },
        body: JSON.stringify({ weight_kg: kg, logged_at, note }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to log weight.");
      statusEl.textContent = `✓ Logged ${kg} kg`;
      document.getElementById("wl-kg").value = "";
      document.getElementById("wl-note").value = "";
      await refreshWeightSection();
    } catch (err) {
      statusEl.textContent = err.message;
    } finally {
      setBusy(btn, false, "Log Weight");
    }
  });

  // Wire delete buttons
  container.querySelectorAll(".weight-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this weight entry?")) return;
      try {
        const r = await fetch(`/api/profile/weight/${btn.dataset.id}`, {
          method: "DELETE", headers: profileHeaders(),
        });
        if (!r.ok) throw new Error((await r.json()).error || "Failed.");
        await refreshWeightSection();
      } catch (err) { alert(err.message); }
    });
  });
}

async function refreshWeightSection() {
  const container = document.getElementById("health-weight-section");
  if (!container) return;
  try {
    const res = await fetch("/api/profile/weight?months=6", { headers: profileHeaders() });
    const data = res.ok ? await res.json() : { entries: [] };
    renderWeightSection(container, data.entries || []);
  } catch { /* silently skip */ }
}

async function refreshActivitySection() {
  const container = document.getElementById("health-activity-section");
  if (!container) return;
  try {
    const res = await fetch("/api/profile/exercise/history?days=14", { headers: profileHeaders() });
    const data = res.ok ? await res.json() : { entries: [] };
    renderActivitySection(container, data.entries || []);
  } catch { /* silently skip */ }
}

async function loadProgressAiSummary(week) {
  const card = document.getElementById("ai-summary-card");
  if (!card) return;
  try {
    const res = await fetch("/api/progress/ai-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...profileHeaders() },
      body: JSON.stringify({
        name: currentProfile.name,
        targets: currentTargets,
        week,
      }),
    });
    if (!res.ok) throw new Error("summary fetch failed");
    const { score, summary, include, exclude } = await res.json();

    const scoreClass = score >= 8 ? "score-good" : score >= 5 ? "score-ok" : "score-low";
    const includeHtml = include.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    const excludeHtml = exclude.map((s) => `<li>${escapeHtml(s)}</li>`).join("");

    card.innerHTML = `
      <div class="ai-summary-header">
        <div class="ai-score-badge ${scoreClass}">${score}<span class="ai-score-denom">/10</span></div>
        <div class="ai-summary-title">
          <div class="ai-summary-label">AI Diet Review</div>
          <div class="ai-summary-text">${escapeHtml(summary)}</div>
        </div>
      </div>
      <div class="ai-suggestions">
        <div class="ai-suggest-col">
          <div class="ai-suggest-head ai-suggest-include">✅ Include more</div>
          <ul class="ai-suggest-list">${includeHtml}</ul>
        </div>
        <div class="ai-suggest-col">
          <div class="ai-suggest-head ai-suggest-exclude">🚫 Reduce</div>
          <ul class="ai-suggest-list">${excludeHtml}</ul>
        </div>
      </div>`;
  } catch {
    if (card) card.innerHTML =
      `<div class="muted" style="font-size:0.85rem">Could not load AI summary — please try again later.</div>`;
  }
}

// Init
initProfileGate();
