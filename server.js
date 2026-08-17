require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");

const { insertMeal, listMealsForDate, listDates, deleteMeal } = require("./db");
const { analyzeMealText, analyzeMealPhoto } = require("./nutrition");
const { flagPortion } = require("./portions");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function todayDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (server local/UTC date)
}

function buildFlags(items) {
  return items
    .map((it) => flagPortion(it.name, it.grams))
    .filter(Boolean);
}

function sumTotals(items) {
  return items.reduce(
    (acc, it) => ({
      calories: acc.calories + (it.calories || 0),
      protein_g: acc.protein_g + (it.protein_g || 0),
      carbs_g: acc.carbs_g + (it.carbs_g || 0),
      fat_g: acc.fat_g + (it.fat_g || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

function saveMealFromAnalysis(analysis, source, rawInput) {
  const items = analysis.items || [];
  const total = analysis.total || sumTotals(items);
  const flags = buildFlags(items);
  const date = todayDate();

  return insertMeal({
    created_at: new Date().toISOString(),
    date,
    source,
    raw_input: rawInput || null,
    description: analysis.description || "Meal",
    items_json: JSON.stringify(items),
    calories: total.calories,
    protein_g: total.protein_g,
    carbs_g: total.carbs_g,
    fat_g: total.fat_g,
    portion_flags_json: JSON.stringify(flags),
  });
}

// --- API routes ---

app.post("/api/meals/text", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Missing 'text'." });
    const analysis = await analyzeMealText(text.trim());
    const meal = saveMealFromAnalysis(analysis, "voice", text.trim());
    res.json(meal);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Failed to analyze meal." });
  }
});

app.post("/api/meals/photo", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing 'photo' file." });
    const caption = (req.body.caption || "").trim();
    const base64 = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype || "image/jpeg";

    const analysis = await analyzeMealPhoto(base64, mediaType, caption || null);
    const meal = saveMealFromAnalysis(analysis, "photo", caption || null);
    res.json(meal);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Failed to analyze photo." });
  }
});

app.get("/api/meals", (req, res) => {
  const date = req.query.date || todayDate();
  const meals = listMealsForDate(date);
  const total = sumTotals(meals);
  res.json({ date, meals, total });
});

app.get("/api/dates", (req, res) => {
  res.json({ dates: listDates() });
});

app.delete("/api/meals/:id", (req, res) => {
  deleteMeal(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.listen(PORT, () => {
  console.log(`Calorie tracker listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("WARNING: ANTHROPIC_API_KEY is not set. Meal analysis endpoints will fail until it is configured.");
  }
});
