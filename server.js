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
  updateMeal,
  createProfile,
  listProfiles,
  verifyProfilePin,
  saveMealPlan,
  getLatestMealPlan,
  saveMealPlanRecipes,
  getProfileTargets,
  setProfileTargets,
  getProfileBio,
  setProfileBio,
  getProgressSummary,
  getAdminDailyUsage,
} = require("./db");
const { analyzeMealText, analyzeMealPhoto, estimateItemMacros, generateDailyQuote, generateProgressSummary } = require("./nutrition");
const { generateMealPlan, ALL_NONVEG_PROTEINS, ALL_VEG_ADDONS } = require("./mealplan");
const { buildRecipePack } = require("./recipes");
const { calculateTargets, ACTIVITY_MULTIPLIERS } = require("./nutritionCalc");
const { flagPortion } = require("./portions");
const { calcIdealWeight, calcBmi, bmiCategory, calcWeightLossTargets, generateExercisePlan } = require("./weightGoal");
const { buildMealPlanEmail, buildSuggestionEmail } = require("./emailTemplate");
const { suggestCompletionMeals } = require("./mealSuggestion");
const { Resend } = require("resend");

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
app.use("/api/progress", requireProfile);
app.use("/api/weight-goal", requireProfile);

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
      fiber_g: acc.fiber_g + (it.fiber_g || 0),
      sugar_g: acc.sugar_g + (it.sugar_g || 0),
      sodium_mg: acc.sodium_mg + (it.sodium_mg || 0),
      saturated_fat_g: acc.saturated_fat_g + (it.saturated_fat_g || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, saturated_fat_g: 0 }
  );
}

// Validate an ISO timestamp sent from the client for use as meal_time_iso.
// Returns the cleaned ISO string, or null if invalid / too far in the future.
function parseMealTimeIso(raw) {
  if (!raw) return null;
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return null;
  // Reject timestamps more than 2 minutes in the future (clock skew tolerance)
  if (d.getTime() > Date.now() + 2 * 60 * 1000) return null;
  return d.toISOString();
}

async function saveMealFromAnalysis(analysis, source, rawInput, profileId, mealTimeIso) {
  const items = analysis.items || [];
  // Always compute totals from items so nutrient fields are included (Claude's
  // tool response "total" only covers the 4 main macros, not fiber/sugar/etc).
  const total = sumTotals(items);
  const flags = buildFlags(items);
  const created_at = parseMealTimeIso(mealTimeIso) || new Date().toISOString();
  const date = created_at.slice(0, 10);

  return insertMeal({
    created_at,
    date,
    source,
    raw_input: rawInput || null,
    description: analysis.description || "Meal",
    items_json: JSON.stringify(items),
    calories: total.calories,
    protein_g: total.protein_g,
    carbs_g: total.carbs_g,
    fat_g: total.fat_g,
    fiber_g: total.fiber_g,
    sugar_g: total.sugar_g,
    sodium_mg: total.sodium_mg,
    saturated_fat_g: total.saturated_fat_g,
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

app.get("/api/profile/bio", async (req, res) => {
  try {
    res.json({ bio: await getProfileBio(req.profileId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load details." });
  }
});

// Calculates a suggested target from biometrics (Mifflin-St Jeor BMR/TDEE)
// and saves the biometrics for next time. Does NOT save the target itself -
// the frontend fills the target form with the suggestion so it can still be
// reviewed/edited before the person hits Save Target.
app.post("/api/profile/targets/calculate", async (req, res) => {
  try {
    const age = Number(req.body.age);
    const weight_kg = Number(req.body.weight_kg);
    const height_cm = Number(req.body.height_cm);
    const sex = req.body.sex;
    const activity = req.body.activity;

    if (!Number.isFinite(age) || age < 2 || age > 120) {
      return res.status(400).json({ error: "Enter a valid age (2-120)." });
    }
    if (sex !== "male" && sex !== "female") {
      return res.status(400).json({ error: "Select a sex." });
    }
    if (!Number.isFinite(weight_kg) || weight_kg < 10 || weight_kg > 300) {
      return res.status(400).json({ error: "Enter a valid weight in kg (10-300)." });
    }
    if (!Number.isFinite(height_cm) || height_cm < 50 || height_cm > 250) {
      return res.status(400).json({ error: "Enter a valid height in cm (50-250)." });
    }
    if (!ACTIVITY_MULTIPLIERS[activity]) {
      return res.status(400).json({ error: "Select an activity level." });
    }

    await setProfileBio(req.profileId, { age, sex, weight_kg, height_cm, activity });
    const suggested = calculateTargets({ age, sex, weight_kg, height_cm, activity });
    res.json({ suggested });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Failed to calculate target." });
  }
});

// --- Meal routes (require X-Profile-Id, see requireProfile above) ---

app.post("/api/meals/text", async (req, res) => {
  try {
    const { text, meal_time_iso } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Missing 'text'." });
    const analysis = await analyzeMealText(text.trim());
    const meal = await saveMealFromAnalysis(analysis, "voice", text.trim(), req.profileId, meal_time_iso);
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
    const meal_time_iso = req.body.meal_time_iso || null;
    const base64 = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype || "image/jpeg";

    const analysis = await analyzeMealPhoto(base64, mediaType, caption || null);
    const meal = await saveMealFromAnalysis(analysis, "photo", caption || null, req.profileId, meal_time_iso);
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

// Users can only edit name/portion/grams per item - calories/protein/carbs/fat
// are always recalculated here from those, never taken from the client.
app.put("/api/meals/:id", async (req, res) => {
  try {
    const description = String(req.body.description || "").trim();
    if (!description) return res.status(400).json({ error: "Description is required." });

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "A meal needs at least one item." });

    const cleanItems = items.map((it, i) => {
      const name = String(it.name || "").trim();
      if (!name) {
        const err = new Error(`Item ${i + 1} needs a name.`);
        err.status = 400;
        throw err;
      }
      const grams = Number(it.grams);
      if (!Number.isFinite(grams) || grams <= 0) {
        const err = new Error(`Item ${i + 1} (${name}) needs a weight in grams greater than 0.`);
        err.status = 400;
        throw err;
      }
      return {
        name,
        portion_desc: String(it.portion_desc || "").trim() || "1 serving",
        grams,
      };
    });

    const estimatedItems = await estimateItemMacros(cleanItems);
    const total = sumTotals(estimatedItems);
    const flags = buildFlags(estimatedItems);

    // Allow editing the logged time (fixes bug where edit appeared to reset
    // the time, and adds feature for retrospective time correction).
    const meal_time_iso = parseMealTimeIso(req.body.meal_time_iso);

    const updated = await updateMeal(Number(req.params.id), req.profileId, {
      description,
      items_json: JSON.stringify(estimatedItems),
      calories: total.calories,
      protein_g: total.protein_g,
      carbs_g: total.carbs_g,
      fat_g: total.fat_g,
      fiber_g: total.fiber_g,
      sugar_g: total.sugar_g,
      sodium_mg: total.sodium_mg,
      saturated_fat_g: total.saturated_fat_g,
      portion_flags_json: JSON.stringify(flags),
      ...(meal_time_iso ? { created_at: meal_time_iso, date: meal_time_iso.slice(0, 10) } : {}),
    });
    if (!updated) return res.status(404).json({ error: "Meal not found." });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Failed to update meal." });
  }
});

// --- Meal plan routes (require X-Profile-Id) ---

app.post("/api/meal-plan", async (req, res) => {
  try {
    const calorieTarget = Number(req.body.calories);
    const proteinTarget = Number(req.body.protein_g);
    const diet = req.body.diet;
    const days = Number(req.body.days) || 7;

    if (!Number.isFinite(calorieTarget) || calorieTarget < 800 || calorieTarget > 6000) {
      return res.status(400).json({ error: "Enter a calorie target between 800 and 6000." });
    }
    if (!Number.isFinite(proteinTarget) || proteinTarget < 10 || proteinTarget > 400) {
      return res.status(400).json({ error: "Enter a protein target between 10 and 400 grams." });
    }
    if (diet !== "veg" && diet !== "non-veg") {
      return res.status(400).json({ error: "Diet must be 'veg' or 'non-veg'." });
    }
    if (!Number.isInteger(days) || days < 1 || days > 7) {
      return res.status(400).json({ error: "Number of days must be between 1 and 7." });
    }

    const allowedProteins = diet === "veg" ? ALL_VEG_ADDONS : ALL_NONVEG_PROTEINS;
    const includedProteins = Array.isArray(req.body.included_proteins)
      ? req.body.included_proteins.filter((p) => allowedProteins.includes(p))
      : [];

    // Free-text preferences (capped to prevent prompt-injection abuse)
    const preferences = String(req.body.preferences || "").trim().slice(0, 500);
    const avoid       = String(req.body.avoid       || "").trim().slice(0, 500);

    const plan = await generateMealPlan(calorieTarget, proteinTarget, diet, includedProteins, days, preferences, avoid);
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

// Send the current meal plan (+ selected recipes) to an email address via Resend.
// Body: { email: string, selectedRecipeNames: string[] }
app.post("/api/meal-plan/email", async (req, res) => {
  try {
    const { email, selectedRecipeNames } = req.body;

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    // Check Resend is configured
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: "Email is not configured on the server yet. Please ask the admin to add RESEND_API_KEY." });
    }

    // Load the meal plan
    const mealPlan = await getLatestMealPlan(req.profileId);
    if (!mealPlan) {
      return res.status(404).json({ error: "No meal plan found. Please generate one first." });
    }

    // Load recipes if the user requested any
    let recipes = {};
    const recipeNames = Array.isArray(selectedRecipeNames) ? selectedRecipeNames.filter(Boolean) : [];
    if (recipeNames.length > 0) {
      // Use cached recipes from the plan if available, otherwise generate fresh
      recipes = mealPlan.recipes || {};
      const missing = recipeNames.filter((n) => !recipes[n]);
      if (missing.length > 0) {
        const { buildRecipePack } = require("./recipes");
        const freshPack = await buildRecipePack(missing);
        recipes = { ...recipes, ...freshPack };
      }
    }

    // Build the HTML email
    const html = buildMealPlanEmail(mealPlan, recipeNames, recipes);

    // Send via Resend
    const resend = new Resend(process.env.RESEND_API_KEY);
    const days = mealPlan.days ? mealPlan.days.length : 7;
    const { error: sendError } = await resend.emails.send({
      from: "Dutta Food Planner <noreply@duttagroup.uk>",
      to: [email],
      subject: `Your ${days}-Day Indian Meal Plan 🍽️`,
      html,
    });

    if (sendError) {
      console.error("Resend error:", sendError);
      return res.status(502).json({ error: sendError.message || "Failed to send email." });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("meal-plan/email error:", err);
    res.status(err.status || 500).json({ error: err.message || "Failed to send email." });
  }
});

// --- Weight goal (ideal weight, deficit targets, exercise plan) ---

// Calculate ideal weight and weight-loss targets from the profile's saved bio.
// Responds with the full assessment so the client can render it without extra
// round-trips; the exercise plan is fetched separately (it's slow, on demand).
app.get("/api/weight-goal", async (req, res) => {
  try {
    const bio = await getProfileBio(req.profileId);
    if (!bio || !bio.weight_kg || !bio.height_cm || !bio.age || !bio.sex) {
      return res.status(400).json({ needsBio: true, error: "Please fill in your age, sex, weight and height on the 🎯 Target tab first." });
    }

    const bmi     = calcBmi(bio.weight_kg, bio.height_cm);
    const ideal   = calcIdealWeight(bio.height_cm);
    const category = bmiCategory(bmi);

    // "Overweight" starts at BMI 25; use the upper healthy boundary (BMI 24.9)
    // as the threshold — if current weight ≤ upper_kg the person is in range.
    const weightToLose = Math.max(0, Math.round((bio.weight_kg - ideal.upper_kg) * 10) / 10);
    const isUnderweight = bio.weight_kg < ideal.lower_kg;
    const atIdeal       = !isUnderweight && weightToLose === 0;

    const result = {
      bmi,
      bmi_category:    category,
      current_weight_kg: bio.weight_kg,
      height_cm:       bio.height_cm,
      age:             bio.age,
      sex:             bio.sex,
      activity:        bio.activity,
      ideal_weight_kg: ideal.ideal_kg,
      ideal_range:     { lower: ideal.lower_kg, upper: ideal.upper_kg },
      weight_to_lose_kg: weightToLose,
      at_ideal_weight: atIdeal,
      is_underweight:  isUnderweight,
      // Weeks at 0.5 kg/week (safe, sustainable rate)
      estimated_weeks: weightToLose > 0 ? Math.ceil(weightToLose / 0.5) : 0,
    };

    if (weightToLose > 0) {
      result.loss_targets = calcWeightLossTargets(bio);
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Failed to calculate weight goal." });
  }
});

// Generate a personalised exercise plan via Claude (slow — client calls on demand).
app.post("/api/weight-goal/exercises", async (req, res) => {
  try {
    const { weight_to_lose_kg, age, activity, sex, bmi } = req.body;
    if (!age || !activity || !sex || bmi == null) {
      return res.status(400).json({ error: "Missing required details." });
    }
    const plan = await generateExercisePlan({
      weightToLose_kg: Number(weight_to_lose_kg) || 0,
      age:    Number(age),
      activity,
      sex,
      bmi:    Number(bmi),
    });
    res.json({ plan });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Failed to generate exercise plan." });
  }
});

// --- Progress (7-day summary, requires X-Profile-Id) ---

app.get("/api/progress", async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
    const rows = await getProgressSummary(req.profileId, days);
    res.json({ days: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load progress." });
  }
});

// 7-day AI progress summary — score, narrative, food suggestions
app.post("/api/progress/ai-summary", requireProfile, async (req, res) => {
  const { name, targets, week } = req.body;
  if (!Array.isArray(week) || week.length === 0) {
    return res.status(400).json({ error: "No week data provided." });
  }
  try {
    const result = await generateProgressSummary(
      (name || "").slice(0, 50) || "there",
      targets || null,
      week
    );
    res.json(result);
  } catch (err) {
    console.error("progress/ai-summary error:", err.message);
    res.status(500).json({ error: "Could not generate summary." });
  }
});

// Daily motivational quote — generated once per day per profile, cached client-side
app.get("/api/daily-quote", requireProfile, async (req, res) => {
  const name = (req.query.name || "").trim().slice(0, 50) || "there";
  try {
    const quote = await generateDailyQuote(name);
    res.json({ quote });
  } catch (err) {
    console.error("daily-quote error:", err.message);
    res.status(500).json({ error: "Could not generate quote." });
  }
});

// --- Suggest meals to complete daily targets ---

// POST /api/meals/suggest-completion
// Body: { remaining_calories, remaining_protein_g, remaining_carbs_g, remaining_fat_g, diet?, liked_foods?, avoided_foods? }
// Protected by the app.use("/api/meals", requireProfile) middleware defined above.
app.post("/api/meals/suggest-completion", async (req, res) => {
  try {
    const {
      remaining_calories, remaining_protein_g, remaining_carbs_g, remaining_fat_g,
      diet, liked_foods, avoided_foods,
    } = req.body;
    const result = await suggestCompletionMeals({
      remaining_calories:  Math.max(0, Number(remaining_calories)  || 0),
      remaining_protein_g: Math.max(0, Number(remaining_protein_g) || 0),
      remaining_carbs_g:   Math.max(0, Number(remaining_carbs_g)   || 0),
      remaining_fat_g:     Math.max(0, Number(remaining_fat_g)     || 0),
      diet:         diet || "veg",
      liked_foods:  liked_foods  || null,
      avoided_foods: avoided_foods || null,
    });
    // result = { single_dish, suggestions }
    res.json(result);
  } catch (err) {
    console.error("suggest-completion error:", err);
    res.status(err.status || 500).json({ error: err.message || "Failed to generate suggestions." });
  }
});

// POST /api/meals/suggest-completion/email
// Body: { email: string, suggestions: Suggestion[], remaining: {calories, protein_g, carbs_g, fat_g} }
app.post("/api/meals/suggest-completion/email", async (req, res) => {
  try {
    const { email, single_dish, suggestions, remaining } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (!single_dish && (!Array.isArray(suggestions) || !suggestions.length)) {
      return res.status(400).json({ error: "No suggestions to send." });
    }
    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({ error: "Email service is not configured on the server." });
    }
    const html = buildSuggestionEmail(single_dish || null, suggestions || [], remaining || null);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: sendError } = await resend.emails.send({
      from:    "Dutta Food Planner <noreply@duttagroup.uk>",
      to:      [email],
      subject: "Your meal suggestions to complete today 🍽️",
      html,
    });
    if (sendError) {
      console.error("Resend error (suggest email):", sendError);
      return res.status(502).json({ error: sendError.message || "Failed to send email." });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("suggest-completion/email error:", err);
    res.status(err.status || 500).json({ error: err.message || "Failed to send email." });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.get("/api/version", (req, res) => {
  res.json({ version: require("./package.json").version });
});

// ── Admin: daily usage report (called by Vercel Cron at 00:30 UTC = 06:00 IST) ──
// Secured with the CRON_SECRET env var — Vercel sends it automatically as
// "Authorization: Bearer <CRON_SECRET>" on every cron invocation.

app.get("/api/admin/daily-report", async (req, res) => {
  // Verify the caller is the Vercel cron scheduler (or an authorised manual trigger)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: "Unauthorised." });
    }
  }

  try {
    // Report covers yesterday in UTC (cron fires at 00:30 UTC, so yesterday = the
    // just-completed Indian calendar day)
    const now = new Date();
    const yest = new Date(now);
    yest.setUTCDate(yest.getUTCDate() - 1);
    const reportDate = yest.toISOString().slice(0, 10);

    const profiles = await getAdminDailyUsage(reportDate);
    const activeCount = profiles.filter((p) => p.meal_count > 0).length;

    // ── Build HTML email ────────────────────────────────────────────────────
    function pct(val, tgt) {
      if (!tgt || !val) return "—";
      return `${Math.round((val / tgt) * 100)}%`;
    }
    function fmt(n, dp = 0) {
      if (!n) return "0";
      return dp ? Number(n).toFixed(dp) : Math.round(n);
    }
    function bar(val, tgt) {
      if (!tgt || !val) return "";
      const p = Math.min(Math.round((val / tgt) * 100), 100);
      const color = p >= 80 ? "#16a34a" : p >= 60 ? "#d97706" : "#dc2626";
      return `<div style="background:#e5e7eb;border-radius:4px;height:6px;width:80px;display:inline-block;vertical-align:middle;margin-left:6px">
                <div style="background:${color};border-radius:4px;height:6px;width:${p}%"></div>
              </div>`;
    }

    const rowsHtml = profiles.map((p) => {
      const active = p.meal_count > 0;
      const rowBg  = active ? "#f0fdf4" : "#fef2f2";
      const badge  = active
        ? `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">✓ Logged</span>`
        : `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">✗ No data</span>`;

      const calLine = active
        ? `${fmt(p.calories)} kcal ${bar(p.calories, p.target_calories)} ${pct(p.calories, p.target_calories)} of ${fmt(p.target_calories)} target`
        : "—";

      const macroLine = active
        ? `P: ${fmt(p.protein_g, 1)}g&nbsp;&nbsp;C: ${fmt(p.carbs_g, 1)}g&nbsp;&nbsp;F: ${fmt(p.fat_g, 1)}g`
        : "—";

      const lastActive = p.last_active_date
        ? (p.last_active_date === reportDate ? "Yesterday" : p.last_active_date)
        : "Never";

      const engageBadge = `${p.active_days_7}/7 days active`;

      return `
        <tr style="background:${rowBg};border-bottom:1px solid #e5e7eb">
          <td style="padding:12px 14px;font-weight:700;font-size:14px;color:#111">${p.name}</td>
          <td style="padding:12px 14px;text-align:center">${badge}</td>
          <td style="padding:12px 14px;font-size:13px;color:#374151">${calLine}</td>
          <td style="padding:12px 14px;font-size:13px;color:#374151;white-space:nowrap">${macroLine}</td>
          <td style="padding:12px 14px;font-size:12px;color:#6b7280;text-align:center">${p.meal_count} meal${p.meal_count !== 1 ? "s" : ""}</td>
          <td style="padding:12px 14px;font-size:12px;color:#6b7280;text-align:center">${lastActive}</td>
          <td style="padding:12px 14px;font-size:12px;color:#6b7280;text-align:center">${engageBadge}</td>
        </tr>`;
    }).join("");

    const displayDate = new Date(reportDate).toLocaleDateString("en-IN", {
      weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Kolkata",
    });

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,sans-serif">
<div style="max-width:780px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">

  <!-- Header -->
  <div style="background:#2f6f4f;padding:28px 32px">
    <div style="font-size:22px;font-weight:700;color:#fff">📊 Daily Usage Report</div>
    <div style="font-size:14px;color:#a7f3d0;margin-top:4px">${displayDate} &nbsp;·&nbsp; Calorie Tracker Admin</div>
  </div>

  <!-- Summary banner -->
  <div style="padding:16px 32px;background:#f0fdf4;border-bottom:1px solid #d1fae5;display:flex;gap:32px">
    <div>
      <div style="font-size:28px;font-weight:800;color:#15803d">${activeCount}</div>
      <div style="font-size:12px;color:#374151">Profiles active</div>
    </div>
    <div>
      <div style="font-size:28px;font-weight:800;color:#374151">${profiles.length}</div>
      <div style="font-size:12px;color:#374151">Total profiles</div>
    </div>
    <div>
      <div style="font-size:28px;font-weight:800;color:#b91c1c">${profiles.length - activeCount}</div>
      <div style="font-size:12px;color:#374151">No activity yesterday</div>
    </div>
  </div>

  <!-- Profile table -->
  <div style="padding:24px 32px 8px">
    <table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif">
      <thead>
        <tr style="border-bottom:2px solid #e5e7eb">
          <th style="padding:8px 14px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Profile</th>
          <th style="padding:8px 14px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Status</th>
          <th style="padding:8px 14px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Calories</th>
          <th style="padding:8px 14px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Macros (P/C/F)</th>
          <th style="padding:8px 14px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Meals</th>
          <th style="padding:8px 14px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Last Active</th>
          <th style="padding:8px 14px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em">7-Day</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>

  <!-- Footer -->
  <div style="padding:20px 32px 28px;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;margin-top:16px">
    Sent automatically at 06:00 IST · Calorie Tracker · <a href="mailto:noreply@duttagroup.uk" style="color:#9ca3af">noreply@duttagroup.uk</a>
  </div>
</div>
</body></html>`;

    // ── Send via Resend ─────────────────────────────────────────────────────
    if (!process.env.RESEND_API_KEY) {
      console.error("[daily-report] RESEND_API_KEY not set — email not sent.");
      return res.json({ ok: true, profiles: profiles.length, active: activeCount, emailSent: false, note: "RESEND_API_KEY missing" });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "Calorie Tracker <noreply@duttagroup.uk>",
      to: "anildutta007@gmail.com",
      subject: `📊 Daily Report ${reportDate} — ${activeCount}/${profiles.length} active`,
      html,
    });

    console.log(`[daily-report] Sent for ${reportDate}: ${activeCount}/${profiles.length} active`);
    res.json({ ok: true, reportDate, profiles: profiles.length, active: activeCount, emailSent: true });

  } catch (err) {
    console.error("[daily-report] Error:", err);
    res.status(500).json({ error: err.message });
  }
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
