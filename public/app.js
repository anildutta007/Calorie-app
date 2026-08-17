// --- Profiles ---
const PROFILE_KEY = "calorie-app-profile";
let currentProfile = null; // {id, name}
let pendingProfile = null; // {id, name} awaiting PIN entry

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
  loadToday();
}

switchProfileBtn.addEventListener("click", () => {
  localStorage.removeItem(PROFILE_KEY);
  currentProfile = null;
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

analyzePhotoBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  setBusy(analyzePhotoBtn, true, "Analyzing...");
  try {
    const formData = new FormData();
    formData.append("photo", selectedFile);
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
    showError(err.message);
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

// --- Today tab ---
async function loadToday() {
  const res = await fetch("/api/meals", { headers: profileHeaders() });
  const data = await res.json();
  renderTotals(document.getElementById("today-totals"), data.total);
  renderMealList(document.getElementById("today-list"), data.meals);
  renderAllFlags(document.getElementById("today-flags"), data.meals);
}

function renderAllFlags(container, meals) {
  const flags = meals.flatMap((m) => m.portion_flags || []);
  container.innerHTML = flags.length ? renderFlags(flags) : "";
}

function renderTotals(container, total) {
  container.innerHTML = `
    ${statBlock(Math.round(total.calories), "kcal")}
    ${statBlock(round1(total.protein_g), "protein g")}
    ${statBlock(round1(total.carbs_g), "carbs g")}
    ${statBlock(round1(total.fat_g), "fat g")}
  `;
}

function renderMealList(container, meals) {
  if (!meals.length) {
    container.innerHTML = `<div class="empty-state">No meals logged yet.</div>`;
    return;
  }
  container.innerHTML = meals
    .map((m) => {
      const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `
      <div class="meal-card">
        <div class="meal-card-header">
          <h3>${escapeHtml(m.description)}</h3>
          <button class="delete-btn" data-id="${m.id}">Delete</button>
        </div>
        <div class="meal-time">${time} · ${m.source}</div>
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
  renderTotals(document.getElementById("history-totals"), data.total);
  renderMealList(document.getElementById("history-list"), data.meals);
}

// --- Meal Plan tab ---
const planCaloriesInput = document.getElementById("plan-calories");
const planProteinInput = document.getElementById("plan-protein");
const dietButtons = document.querySelectorAll(".diet-btn");
const vegOptions = document.getElementById("veg-options");
const nonvegOptions = document.getElementById("nonveg-options");
const generatePlanBtn = document.getElementById("generate-plan-btn");
const planStatus = document.getElementById("plan-status");
const planResult = document.getElementById("plan-result");
let selectedDiet = "veg";

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

  setBusy(generatePlanBtn, true, "Generating... (can take ~30-60s)");
  try {
    const res = await fetch("/api/meal-plan", {
      method: "POST",
      headers: profileHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ calories, protein_g, diet: selectedDiet, included_proteins: getCheckedProteins() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to generate plan.");
    applyMealPlan(data.mealPlan);
  } catch (err) {
    planStatus.textContent = err.message;
  } finally {
    setBusy(generatePlanBtn, false, "Generate 7-Day Plan");
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

function resetMealPlanUI() {
  planCaloriesInput.value = "";
  planProteinInput.value = "";
  dietButtons.forEach((b) => b.classList.toggle("active", b.dataset.diet === "veg"));
  selectedDiet = "veg";
  showDietOptions(selectedDiet);
  resetProteinPanelsToDefaults();
  planStatus.textContent = "";
  planResult.innerHTML = `<div class="empty-state">No plan yet — set your targets above and generate one.</div>`;
}

function applyMealPlan(mealPlan) {
  planCaloriesInput.value = mealPlan.calorie_target;
  planProteinInput.value = mealPlan.protein_target;
  dietButtons.forEach((b) => b.classList.toggle("active", b.dataset.diet === mealPlan.diet));
  selectedDiet = mealPlan.diet;
  showDietOptions(selectedDiet);
  resetProteinPanelsToDefaults();
  setPanelProteins(activePanel(), mealPlan.included_proteins);
  renderMealPlan(mealPlan);
}

function renderMealPlan(mealPlan) {
  const dietLabel = mealPlan.diet === "veg" ? "Vegetarian" : "Non-Vegetarian";
  const proteins = mealPlan.included_proteins || [];
  const proteinLabel = proteins.length ? ` (+ ${proteins.map(cap).join(", ")})` : mealPlan.diet === "veg" ? " (strict)" : "";
  planResult.innerHTML = `
    <div class="card">
      <div class="muted">Target: ${Math.round(mealPlan.calorie_target)} kcal · ${Math.round(mealPlan.protein_target)}g protein · ${dietLabel}${proteinLabel}</div>
      ${mealPlan.summary ? `<p style="margin-bottom:0">${escapeHtml(mealPlan.summary)}</p>` : ""}
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
      ${renderItems(meal.items)}
    </div>`;
}

// Init
initProfileGate();
