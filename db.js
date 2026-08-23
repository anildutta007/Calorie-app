const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

// Vercel's Postgres/Neon integration auto-injects one of these depending on
// setup; fall back across the common names so this works regardless.
const connectionString =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.warn(
    "WARNING: No Postgres connection string found (DATABASE_URL / POSTGRES_URL). Database calls will fail until it is configured."
  );
}

const rawSql = neon(connectionString);

// Retry wrapper: Neon's control plane can have transient blips flagged with
// neon:retryable === true.  Retry up to 3 times with linear back-off before
// giving up and letting the error surface to the caller.
async function withRetry(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err["neon:retryable"] !== true || attempt >= maxAttempts) throw err;
      const delayMs = 800 * attempt; // 800 ms, 1 600 ms
      console.log(
        `[db] Neon transient error (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs} ms…`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// Wrap the tagged-template sql function so every query auto-retries.
const sql = (strings, ...values) => withRetry(() => rawSql(strings, ...values));

let initialized = null;

async function init() {
  if (!initialized) {
    initialized = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS profiles (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          pin_salt TEXT NOT NULL,
          pin_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS meals (
          id SERIAL PRIMARY KEY,
          created_at TEXT NOT NULL,
          date TEXT NOT NULL,
          source TEXT NOT NULL,           -- 'voice' | 'photo' | 'text'
          raw_input TEXT,                 -- transcript or caption
          description TEXT NOT NULL,      -- short summary of the meal
          items_json TEXT NOT NULL,       -- JSON array of {name, portion_desc, grams, calories, protein_g, carbs_g, fat_g}
          calories REAL NOT NULL,
          protein_g REAL NOT NULL,
          carbs_g REAL NOT NULL,
          fat_g REAL NOT NULL,
          portion_flags_json TEXT,        -- JSON array of portion flags
          profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE
        );
      `;

      // Migration for deployments that had the meals table before profiles existed.
      await sql`ALTER TABLE meals ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE`;

      // One-time backfill: any meal logged before profiles existed gets parked
      // under a "Legacy" profile (PIN 0000) instead of being lost/orphaned.
      const orphans = await sql`SELECT COUNT(*)::int AS n FROM meals WHERE profile_id IS NULL`;
      if (orphans[0].n > 0) {
        const legacy = await rawCreateProfile("Legacy", "0000");
        await sql`UPDATE meals SET profile_id = ${legacy.id} WHERE profile_id IS NULL`;
      }

      await sql`
        CREATE TABLE IF NOT EXISTS meal_plans (
          id SERIAL PRIMARY KEY,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          calorie_target REAL NOT NULL,
          protein_target REAL NOT NULL,
          diet TEXT NOT NULL,             -- 'veg' | 'non-veg'
          included_proteins TEXT,         -- JSON array, e.g. '["chicken","fish","egg","mutton"]'
          plan_json TEXT NOT NULL,        -- {summary, days: [...]}
          recipes_json TEXT,              -- {[dishName]: {serves, prep_time_min, cook_time_min, ingredients, steps, image_url}}, generated lazily
          created_at TEXT NOT NULL
        );
      `;

      // Migration for deployments created before included_proteins/recipes_json existed.
      await sql`ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS included_proteins TEXT`;
      await sql`ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS recipes_json TEXT`;

      // Daily nutrition targets, one ongoing set per profile (not per-day).
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS target_calories REAL`;
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS target_protein_g REAL`;
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS target_carbs_g REAL`;
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS target_fat_g REAL`;

      // Biometrics used only to auto-calculate a suggested target (BMR/TDEE).
      // Saved so a returning profile doesn't have to re-enter them every time.
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio_age INTEGER`;
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio_sex TEXT`; // 'male' | 'female'
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio_weight_kg REAL`;
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio_height_cm REAL`;
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio_activity TEXT`; // sedentary|light|moderate|active|very_active

      // Extended nutrient tracking: fiber, sugar, sodium, saturated fat.
      // Added after initial launch - existing meals default to 0 for these columns.
      await sql`ALTER TABLE meals ADD COLUMN IF NOT EXISTS fiber_g REAL DEFAULT 0`;
      await sql`ALTER TABLE meals ADD COLUMN IF NOT EXISTS sugar_g REAL DEFAULT 0`;
      await sql`ALTER TABLE meals ADD COLUMN IF NOT EXISTS sodium_mg REAL DEFAULT 0`;
      await sql`ALTER TABLE meals ADD COLUMN IF NOT EXISTS saturated_fat_g REAL DEFAULT 0`;

      // Weight log: manual weigh-ins recorded with date + time.
      await sql`
        CREATE TABLE IF NOT EXISTS weight_log (
          id         SERIAL PRIMARY KEY,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          weight_kg  REAL NOT NULL,
          logged_at  TEXT NOT NULL,   -- ISO timestamp (preserves local date + time via UTC)
          note       TEXT
        )
      `;

      // Apple Health sync: per-profile token used as a secret webhook URL segment.
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS health_sync_token TEXT UNIQUE`;

      // Exercise data pushed from Apple Health via the "Health Auto Export" iOS app.
      await sql`
        CREATE TABLE IF NOT EXISTS exercise_log (
          id               SERIAL PRIMARY KEY,
          profile_id       INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          date             TEXT NOT NULL,
          steps            INTEGER DEFAULT 0,
          active_calories  REAL DEFAULT 0,
          resting_calories REAL DEFAULT 0,
          exercise_minutes INTEGER DEFAULT 0,
          source           TEXT DEFAULT 'apple_health',
          synced_at        TEXT NOT NULL,
          UNIQUE(profile_id, date)
        )
      `;
    })();
    // If init fails (e.g. all retries exhausted), reset so the next call can
    // retry from scratch rather than re-throwing the stale rejection forever.
    initialized.catch(() => { initialized = null; });
  }
  return initialized;
}

// --- PIN hashing (salted PBKDF2, no extra native dependency) ---

function makeSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(String(pin), salt, 100000, 32, "sha256").toString("hex");
}

// Insert a profile without going through init() — used both by the public
// createProfile() and by the one-time legacy-data migration inside init()
// itself (which must not re-enter init()).
async function rawCreateProfile(name, pin) {
  const salt = makeSalt();
  const hash = hashPin(pin, salt);
  const rows = await sql`
    INSERT INTO profiles (name, pin_salt, pin_hash, created_at)
    VALUES (${name}, ${salt}, ${hash}, ${new Date().toISOString()})
    ON CONFLICT (name) DO NOTHING
    RETURNING id, name, created_at
  `;
  if (rows[0]) return rows[0];
  const existing = await sql`SELECT id, name, created_at FROM profiles WHERE name = ${name}`;
  return existing[0];
}

async function createProfile(name, pin) {
  await init();
  const trimmed = (name || "").trim();
  if (!trimmed) badRequest("Name is required.");
  if (trimmed.length > 40) badRequest("Name is too long.");
  if (!/^\d{4}$/.test(pin || "")) badRequest("PIN must be exactly 4 digits.");

  const existing = await sql`SELECT id FROM profiles WHERE name = ${trimmed}`;
  if (existing[0]) {
    const err = new Error("That name is already taken. Pick another.");
    err.status = 409;
    throw err;
  }
  return rawCreateProfile(trimmed, pin);
}

async function listProfiles() {
  await init();
  return sql`SELECT id, name FROM profiles ORDER BY name ASC`;
}

async function verifyProfilePin(id, pin) {
  await init();
  const rows = await sql`SELECT id, name, pin_salt, pin_hash FROM profiles WHERE id = ${id}`;
  const profile = rows[0];
  if (!profile) return null;

  const candidate = Buffer.from(hashPin(pin, profile.pin_salt), "hex");
  const actual = Buffer.from(profile.pin_hash, "hex");
  if (candidate.length !== actual.length || !crypto.timingSafeEqual(candidate, actual)) return null;

  return { id: profile.id, name: profile.name };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

// --- Meals (all scoped to a profile) ---

async function insertMeal(meal) {
  await init();
  const rows = await sql`
    INSERT INTO meals (created_at, date, source, raw_input, description, items_json, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, saturated_fat_g, portion_flags_json, profile_id)
    VALUES (${meal.created_at}, ${meal.date}, ${meal.source}, ${meal.raw_input}, ${meal.description}, ${meal.items_json}, ${meal.calories}, ${meal.protein_g}, ${meal.carbs_g}, ${meal.fat_g}, ${meal.fiber_g || 0}, ${meal.sugar_g || 0}, ${meal.sodium_mg || 0}, ${meal.saturated_fat_g || 0}, ${meal.portion_flags_json}, ${meal.profile_id})
    RETURNING *
  `;
  return formatRow(rows[0]);
}

async function getMeal(id, profileId) {
  await init();
  const rows = await sql`SELECT * FROM meals WHERE id = ${id} AND profile_id = ${profileId}`;
  return rows[0] ? formatRow(rows[0]) : null;
}

async function listMealsForDate(date, profileId) {
  await init();
  const rows = await sql`SELECT * FROM meals WHERE date = ${date} AND profile_id = ${profileId} ORDER BY created_at ASC`;
  return rows.map(formatRow);
}

async function listDates(profileId) {
  await init();
  const rows = await sql`SELECT DISTINCT date FROM meals WHERE profile_id = ${profileId} ORDER BY date DESC`;
  return rows.map((r) => r.date);
}

async function deleteMeal(id, profileId) {
  await init();
  await sql`DELETE FROM meals WHERE id = ${id} AND profile_id = ${profileId}`;
}

async function updateMeal(id, profileId, meal) {
  await init();
  // created_at and date: use COALESCE so that when the caller provides a value
  // (time-edit feature) it is stored, and when it doesn't the existing DB value
  // is preserved (prevents the edit-resets-time bug).
  const rows = await sql`
    UPDATE meals
    SET description = ${meal.description}, items_json = ${meal.items_json},
        calories = ${meal.calories}, protein_g = ${meal.protein_g}, carbs_g = ${meal.carbs_g}, fat_g = ${meal.fat_g},
        fiber_g = ${meal.fiber_g || 0}, sugar_g = ${meal.sugar_g || 0}, sodium_mg = ${meal.sodium_mg || 0}, saturated_fat_g = ${meal.saturated_fat_g || 0},
        portion_flags_json = ${meal.portion_flags_json},
        created_at = COALESCE(${meal.created_at || null}, created_at),
        date       = COALESCE(${meal.date       || null}, date)
    WHERE id = ${id} AND profile_id = ${profileId}
    RETURNING *
  `;
  return rows[0] ? formatRow(rows[0]) : null;
}

function formatRow(row) {
  return {
    ...row,
    items: JSON.parse(row.items_json || "[]"),
    portion_flags: JSON.parse(row.portion_flags_json || "[]"),
  };
}

// --- Meal plans (one saved 7-day plan per profile; regenerating replaces it) ---

async function saveMealPlan(profileId, calorieTarget, proteinTarget, diet, includedProteins, plan) {
  await init();
  const rows = await sql`
    INSERT INTO meal_plans (profile_id, calorie_target, protein_target, diet, included_proteins, plan_json, created_at)
    VALUES (${profileId}, ${calorieTarget}, ${proteinTarget}, ${diet}, ${JSON.stringify(includedProteins || [])}, ${JSON.stringify(plan)}, ${new Date().toISOString()})
    RETURNING *
  `;
  return formatMealPlanRow(rows[0]);
}

async function getLatestMealPlan(profileId) {
  await init();
  const rows = await sql`
    SELECT * FROM meal_plans WHERE profile_id = ${profileId} ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0] ? formatMealPlanRow(rows[0]) : null;
}

// Saves the generated recipe pack onto a plan so it isn't regenerated on
// every visit; scoped to profileId so one profile can't write another's plan.
async function saveMealPlanRecipes(mealPlanId, profileId, recipes) {
  await init();
  const rows = await sql`
    UPDATE meal_plans SET recipes_json = ${JSON.stringify(recipes)}
    WHERE id = ${mealPlanId} AND profile_id = ${profileId}
    RETURNING *
  `;
  return rows[0] ? formatMealPlanRow(rows[0]) : null;
}

function formatMealPlanRow(row) {
  const plan = JSON.parse(row.plan_json || "{}");
  return {
    id: row.id,
    calorie_target: row.calorie_target,
    protein_target: row.protein_target,
    diet: row.diet,
    included_proteins: JSON.parse(row.included_proteins || "[]"),
    created_at: row.created_at,
    summary: plan.summary || null,
    days: plan.days || [],
    recipes: row.recipes_json ? JSON.parse(row.recipes_json) : null,
  };
}

// --- Daily nutrition targets (one ongoing set per profile) ---

function formatTargets(row) {
  if (!row) return null;
  return {
    calories: row.target_calories,
    protein_g: row.target_protein_g,
    carbs_g: row.target_carbs_g,
    fat_g: row.target_fat_g,
  };
}

async function getProfileTargets(profileId) {
  await init();
  const rows = await sql`
    SELECT target_calories, target_protein_g, target_carbs_g, target_fat_g FROM profiles WHERE id = ${profileId}
  `;
  return formatTargets(rows[0]);
}

async function setProfileTargets(profileId, targets) {
  await init();
  const rows = await sql`
    UPDATE profiles
    SET target_calories = ${targets.calories}, target_protein_g = ${targets.protein_g},
        target_carbs_g = ${targets.carbs_g}, target_fat_g = ${targets.fat_g}
    WHERE id = ${profileId}
    RETURNING target_calories, target_protein_g, target_carbs_g, target_fat_g
  `;
  return formatTargets(rows[0]);
}

// --- Biometrics (used only to auto-calculate a suggested target) ---

function formatBio(row) {
  if (!row) return null;
  return {
    age: row.bio_age,
    sex: row.bio_sex,
    weight_kg: row.bio_weight_kg,
    height_cm: row.bio_height_cm,
    activity: row.bio_activity,
  };
}

async function getProfileBio(profileId) {
  await init();
  const rows = await sql`
    SELECT bio_age, bio_sex, bio_weight_kg, bio_height_cm, bio_activity FROM profiles WHERE id = ${profileId}
  `;
  return formatBio(rows[0]);
}

async function setProfileBio(profileId, bio) {
  await init();
  const rows = await sql`
    UPDATE profiles
    SET bio_age = ${bio.age}, bio_sex = ${bio.sex}, bio_weight_kg = ${bio.weight_kg},
        bio_height_cm = ${bio.height_cm}, bio_activity = ${bio.activity}
    WHERE id = ${profileId}
    RETURNING bio_age, bio_sex, bio_weight_kg, bio_height_cm, bio_activity
  `;
  return formatBio(rows[0]);
}

// --- Progress summary (last N days of aggregated totals per day) ---

async function getProgressSummary(profileId, days) {
  await init();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const rows = await sql`
    SELECT
      date,
      SUM(calories)::real            AS calories,
      SUM(protein_g)::real           AS protein_g,
      SUM(carbs_g)::real             AS carbs_g,
      SUM(fat_g)::real               AS fat_g,
      SUM(fiber_g)::real             AS fiber_g,
      SUM(sugar_g)::real             AS sugar_g,
      SUM(sodium_mg)::real           AS sodium_mg,
      SUM(saturated_fat_g)::real     AS saturated_fat_g
    FROM meals
    WHERE profile_id = ${profileId} AND date >= ${cutoffDate}
    GROUP BY date
    ORDER BY date ASC
  `;
  return rows;
}

// --- Admin: daily usage report across all profiles for a given date ---
// Returns one row per profile with that day's meal totals and their targets.

async function getAdminDailyUsage(date) {
  await init();

  // Date 7 days prior, for the "active last 7 days" engagement metric
  const d7 = new Date(date);
  d7.setDate(d7.getDate() - 6);
  const weekStart = d7.toISOString().slice(0, 10);

  const rows = await sql`
    SELECT
      p.id,
      p.name,
      p.target_calories,
      p.target_protein_g,
      p.target_carbs_g,
      p.target_fat_g,
      /* yesterday's totals */
      COALESCE(SUM(m.calories)::real,   0)  AS calories,
      COALESCE(SUM(m.protein_g)::real,  0)  AS protein_g,
      COALESCE(SUM(m.carbs_g)::real,    0)  AS carbs_g,
      COALESCE(SUM(m.fat_g)::real,      0)  AS fat_g,
      COUNT(m.id)::int                      AS meal_count,
      /* last date the profile logged anything */
      (SELECT MAX(m2.date) FROM meals m2 WHERE m2.profile_id = p.id)  AS last_active_date,
      /* number of distinct days logged in the last 7 days */
      (SELECT COUNT(DISTINCT m3.date)::int FROM meals m3
         WHERE m3.profile_id = p.id AND m3.date >= ${weekStart})       AS active_days_7
    FROM profiles p
    LEFT JOIN meals m ON m.profile_id = p.id AND m.date = ${date}
    GROUP BY p.id, p.name, p.target_calories, p.target_protein_g, p.target_carbs_g, p.target_fat_g
    ORDER BY p.name ASC
  `;
  return rows;
}

// --- Weight log ---

async function insertWeightLog(profileId, weight_kg, logged_at, note) {
  await init();
  const rows = await sql`
    INSERT INTO weight_log (profile_id, weight_kg, logged_at, note)
    VALUES (${profileId}, ${weight_kg}, ${logged_at}, ${note || null})
    RETURNING *
  `;
  return rows[0];
}

// Returns all entries from fromDate (ISO string) onwards, oldest first.
async function listWeightLog(profileId, fromDate) {
  await init();
  const rows = await sql`
    SELECT * FROM weight_log
    WHERE profile_id = ${profileId} AND logged_at >= ${fromDate}
    ORDER BY logged_at ASC
  `;
  return rows;
}

async function deleteWeightLog(id, profileId) {
  await init();
  await sql`DELETE FROM weight_log WHERE id = ${id} AND profile_id = ${profileId}`;
}

// --- Apple Health sync (via "Health Auto Export" iOS app webhook) ---

async function generateHealthSyncToken(profileId) {
  await init();
  const token = crypto.randomBytes(24).toString("hex");
  const rows = await sql`
    UPDATE profiles SET health_sync_token = ${token} WHERE id = ${profileId}
    RETURNING health_sync_token
  `;
  return rows[0]?.health_sync_token || null;
}

async function getHealthSyncToken(profileId) {
  await init();
  const rows = await sql`SELECT health_sync_token FROM profiles WHERE id = ${profileId}`;
  return rows[0]?.health_sync_token || null;
}

async function revokeHealthSyncToken(profileId) {
  await init();
  await sql`UPDATE profiles SET health_sync_token = NULL WHERE id = ${profileId}`;
}

// Look up a profile by its health sync token (used in the public webhook handler).
async function getProfileByHealthToken(token) {
  await init();
  if (!token) return null;
  const rows = await sql`SELECT id, name FROM profiles WHERE health_sync_token = ${token}`;
  return rows[0] || null;
}

// Upsert one day of exercise data for a profile.
async function upsertExercise(profileId, date, data) {
  await init();
  const rows = await sql`
    INSERT INTO exercise_log
      (profile_id, date, steps, active_calories, resting_calories, exercise_minutes, source, synced_at)
    VALUES (
      ${profileId}, ${date},
      ${data.steps || 0}, ${data.active_calories || 0},
      ${data.resting_calories || 0}, ${data.exercise_minutes || 0},
      ${data.source || "apple_health"}, ${new Date().toISOString()}
    )
    ON CONFLICT (profile_id, date) DO UPDATE SET
      steps            = EXCLUDED.steps,
      active_calories  = EXCLUDED.active_calories,
      resting_calories = EXCLUDED.resting_calories,
      exercise_minutes = EXCLUDED.exercise_minutes,
      synced_at        = EXCLUDED.synced_at
    RETURNING *
  `;
  return rows[0] || null;
}

async function getExerciseByDate(profileId, date) {
  await init();
  const rows = await sql`
    SELECT * FROM exercise_log WHERE profile_id = ${profileId} AND date = ${date}
  `;
  return rows[0] || null;
}

// Returns the last N days of exercise rows, newest first.
async function getExerciseRecent(profileId, days) {
  await init();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const rows = await sql`
    SELECT * FROM exercise_log
    WHERE profile_id = ${profileId} AND date >= ${cutoffDate}
    ORDER BY date DESC
  `;
  return rows;
}

module.exports = {
  insertMeal,
  getMeal,
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
  insertWeightLog,
  listWeightLog,
  deleteWeightLog,
  generateHealthSyncToken,
  getHealthSyncToken,
  revokeHealthSyncToken,
  getProfileByHealthToken,
  upsertExercise,
  getExerciseByDate,
  getExerciseRecent,
};
