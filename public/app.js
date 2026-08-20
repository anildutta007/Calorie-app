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
  loadDailyGreeting();
  Promise.all([loadBio(), loadTargets()]).then(loadToday);
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
    if (btn.dataset.tab === "progress") loadProgress();
    if (btn.dataset.tab === "goal") {
      loadTargets(); // refresh target display at top of merged tab
      loadWeightGoal();
    }
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
  try {
    const res = await fetch("/api/meals", { headers: profileHeaders() });
    if (res.status >= 500) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    hideDbBanner();
    renderTotals(document.getElementById("today-totals"), data.total, document.getElementById("today-summary"));
    renderDayTimeline(document.getElementById("today-list"), data.meals, true, loadToday, true);
    renderAllFlags(document.getElementById("today-flags"), data.meals);
  } catch (err) {
    showDbBanner(loadToday);
  }
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

// --- History tab ---
const historyDateInput = document.getElementById("history-date");
historyDateInput.addEventListener("change", loadHistory);

async function loadHistory() {
  if (!historyDateInput.value) {
    historyDateInput.value = new Date().toISOString().slice(0, 10);
  }
  const date = historyDateInput.value;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(`/api/meals?date=${date}`, { headers: profileHeaders() });
    if (res.status >= 500) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    hideDbBanner();
    renderTotals(document.getElementById("history-totals"), data.total, document.getElementById("history-summary"));
    // Scroll to current hour only when viewing today's date
    renderDayTimeline(document.getElementById("history-list"), data.meals, false, loadHistory, date === today);
  } catch (err) {
    showDbBanner(loadHistory);
  }
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
            ? items.map((it) => `<div class="cal-dish">${escapeHtml(it.name)}</div>`).join("")
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
        <div class="print-cal-meta">Target: ${Math.round(mealPlan.calorie_target)} kcal · ${Math.round(mealPlan.protein_target)}g protein/day</div>
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
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === "plan"));
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-plan"));
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
    <div id="ai-summary-card" class="card ai-summary-card">
      <div class="ai-summary-loading">
        <div class="ai-shimmer ai-shimmer-score"></div>
        <div class="ai-shimmer ai-shimmer-line" style="width:90%"></div>
        <div class="ai-shimmer ai-shimmer-line" style="width:75%"></div>
      </div>
    </div>
    ${metrics.map(chartHtml).join("")}
    ${nutrientsHtml}
  `;

  // Kick off AI summary async — fills in #ai-summary-card when ready.
  // Exclude today (week[0]) so the AI only sees completed days — today's
  // log is likely still in progress and would skew the analysis.
  const weekForAi = week.slice(1); // drop today (index 0)
  const loggedCountForAi = weekForAi.filter((d) => d.hasData).length;
  if (loggedCountForAi > 0) {
    loadProgressAiSummary(weekForAi);
  } else {
    document.getElementById("ai-summary-card").innerHTML =
      `<div class="muted" style="font-size:0.85rem">Log at least one full day of meals to get your AI diet summary.</div>`;
  }
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
