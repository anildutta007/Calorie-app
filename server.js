require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");

const {
  insertMeal,
  listMealsForDate,
  listDates,
  deleteMeal,
  createProfile,
  listProfiles,
  verifyProfilePin,
  saveMealPlan,
  getLatestMealPlan,
  saveMealPlanRecipes,
  getProfileTargets,
  setProfileTargets,
} = require("./db");
const { analyzeMealText, analyzeMealPhoto } = require("./nutrition");
const { generateMealPlan, ALL_NONVEG_PROTEINS, ALL_VEG_ADDONS } = require("./mealplan");
const { buildRecipePack } = require("./recipes");
const { flagPortion } = require("./portions");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// Meal/date routes are per-profile: every request must identify which
// profile it's acting as via the X-Profile-Id header (set by the frontend
// once the user has picked a profile and entered its PIN).
function requireProfile(req, res, next) {
  const id = Number(req.header("X-Profile-Id"));
  if (!id || Number.isNaN(id)) {
    return res.status(401).json({ error: "No profile selected." });
  }
  req.profileId = id;
  next();
}
app.use("/api/meals", requireProfile);
app.use("/api/dates", requireProfile);
app.use("/api/meal-plan", requireProfile);
app.use("/api/profile", requireProfile);

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

async function saveMealFromAnalysis(analysis, source, rawInput, profileId) {
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
    profile_id: profileId,
  });
}

// --- Profile routes ---

app.post("/api/profiles", async (req, res) => {
  try {
    const { name, pin } = req.body;
    const profile = await createProfile(name, pin);
    res.json({ id: profile.id, name: profile.name });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Failed to create profile." });
  }
});

app.get("/api/profiles", async (req, res) => {
  try {
    res.json({ profiles: await listProfiles() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load profiles." });
  }
});

app.post("/api/profiles/:id/verify", async (req, res) => {
  try {
    const { pin } = req.body;
    const profile = await verifyProfilePin(Number(req.params.id), pin);
    if (!profile) return res.status(401).json({ error: "Incorrect PIN." });
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to verify PIN." });
  }
});

// --- Daily nutrition targets (require X-Profile-Id) ---

app.get("/api/profile/targets", async (req, res) => {
  try {
    res.json({ targets: await getProfileTargets(req.profileId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load target." });
  }
});

app.put("/api/profile/targets", async (req, res) => {
  try {
    function cleanNum(v, max, label) {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > max) {
        const err = new Error(`Enter a valid ${label} between 0 and ${max}, or leave it blank.`);
        err.status = 400;
        throw err;
      }
      return n;
    }
    const targets = {
      calories: cleanNum(req.body.calories, 10000, "calorie target"),
      protein_g: cleanNum(req.body.protein_g, 600, "protein target"),
      carbs_g: cleanNum(req.body.carbs_g, 1200, "carbs target"),
      fat_g: cleanNum(req.body.fat_g, 400, "fat target"),
    };
    res.json({ targets: await setProfileTargets(req.profileId, targets) });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Failed to save target." });
  }
});

// --- Meal routes (require X-Profile-Id, see requireProfile above) ---

app.post("/api/meals/text", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Missing 'text'." });
    const analysis = await analyzeMealText(text.trim());
    const meal = await saveMealFromAnalysis(analysis, "voice", text.trim(), req.profileId);
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
    const meal = await saveMealFromAnalysis(analysis, "photo", caption || null, req.profileId);
    res.json(meal);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Failed to analyze photo." });
  }
});

app.get("/api/meals", async (req, res) => {
  try {
    const date = req.query.date || todayDate();
    const meals = await listMealsForDate(date, req.profileId);
    const total = sumTotals(meals);
    res.json({ date, meals, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load meals." });
  }
});

app.get("/api/dates", async (req, res) => {
  try {
    res.json({ dates: await listDates(req.profileId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load dates." });
  }
});

app.delete("/api/meals/:id", async (req, res) => {
  try {
    await deleteMeal(Number(req.params.id), req.profileId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to delete meal." });
  }
});

// --- Meal plan routes (require X-Profile-Id) ---

app.post("/api/meal-plan", async (req, res) => {
  try {
    const calorieTarget = Number(req.body.calories);
    const proteinTarget = Number(req.body.protein_g);
    const diet = req.body.diet;

    if (!Number.isFinite(calorieTarget) || calorieTarget < 800 || calorieTarget > 6000) {
      return res.status(400).json({ error: "Enter a calorie target between 800 and 6000." });
    }
    if (!Number.isFinite(proteinTarget) || proteinTarget < 10 || proteinTarget > 400) {
      return res.status(400).json({ error: "Enter a protein target between 10 and 400 grams." });
    }
    if (diet !== "veg" && diet !== "non-veg") {
      return res.status(400).json({ error: "Diet must be 'veg' or 'non-veg'." });
    }

    const allowedProteins = diet === "veg" ? ALL_VEG_ADDONS : ALL_NONVEG_PROTEINS;
    const includedProteins = Array.isArray(req.body.included_proteins)
      ? req.body.included_proteins.filter((p) => allowedProteins.includes(p))
      : [];

    const plan = await generateMealPlan(calorieTarget, proteinTarget, diet, includedProteins);
    const mealPlan = await saveMealPlan(req.profileId, calorieTarget, proteinTarget, diet, includedProteins, plan);
    res.json({ mealPlan });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Failed to generate meal plan." });
  }
});

app.get("/api/meal-plan", async (req, res) => {
  try {
    const mealPlan = await getLatestMealPlan(req.profileId);
    res.json({ mealPlan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load meal plan." });
  }
});

// Generates (or returns cached) cooking instructions + best-effort photos for
// every dish in the profile's current meal plan.
app.post("/api/meal-plan/recipes", async (req, res) => {
  try {
    const mealPlan = await getLatestMealPlan(req.profileId);
    if (!mealPlan) return res.status(404).json({ error: "No meal plan found. Generate one first." });

    if (mealPlan.recipes) {
      return res.json({ recipes: mealPlan.recipes });
    }

    const dishNames = mealPlan.days.flatMap((day) => day.meals.flatMap((meal) => meal.items.map((item) => item.name)));
    const recipes = await buildRecipePack(dishNames);
    await saveMealPlanRecipes(mealPlan.id, req.profileId, recipes);
    res.json({ recipes });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Failed to generate recipes." });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

// When run directly (npm start, or Render), start a normal listening server.
// When imported by Vercel's serverless runtime, just export the app instead.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Calorie tracker listening on http://localhost:${PORT}`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn("WARNING: ANTHROPIC_API_KEY is not set. Meal analysis endpoints will fail until it is configured.");
    }
  });
}

module.exports = app;
