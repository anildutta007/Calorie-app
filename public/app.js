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
      headers: { "Content-Type": "application/json" },
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
    const res = await fetch("/api/meals/photo", { method: "POST", body: formData });
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
  const res = await fetch("/api/meals");
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
      await fetch(`/api/meals/${btn.dataset.id}`, { method: "DELETE" });
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
  const res = await fetch(`/api/meals?date=${date}`);
  const data = await res.json();
  renderTotals(document.getElementById("history-totals"), data.total);
  renderMealList(document.getElementById("history-list"), data.meals);
}

// Init
loadToday();
