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

const sql = neon(connectionString);

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
          plan_json TEXT NOT NULL,        -- {summary, days: [...]}
          created_at TEXT NOT NULL
        );
      `;
    })();
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
    INSERT INTO meals (created_at, date, source, raw_input, description, items_json, calories, protein_g, carbs_g, fat_g, portion_flags_json, profile_id)
    VALUES (${meal.created_at}, ${meal.date}, ${meal.source}, ${meal.raw_input}, ${meal.description}, ${meal.items_json}, ${meal.calories}, ${meal.protein_g}, ${meal.carbs_g}, ${meal.fat_g}, ${meal.portion_flags_json}, ${meal.profile_id})
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

function formatRow(row) {
  return {
    ...row,
    items: JSON.parse(row.items_json || "[]"),
    portion_flags: JSON.parse(row.portion_flags_json || "[]"),
  };
}

// --- Meal plans (one saved 7-day plan per profile; regenerating replaces it) ---

async function saveMealPlan(profileId, calorieTarget, proteinTarget, diet, plan) {
  await init();
  const rows = await sql`
    INSERT INTO meal_plans (profile_id, calorie_target, protein_target, diet, plan_json, created_at)
    VALUES (${profileId}, ${calorieTarget}, ${proteinTarget}, ${diet}, ${JSON.stringify(plan)}, ${new Date().toISOString()})
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

function formatMealPlanRow(row) {
  const plan = JSON.parse(row.plan_json || "{}");
  return {
    id: row.id,
    calorie_target: row.calorie_target,
    protein_target: row.protein_target,
    diet: row.diet,
    created_at: row.created_at,
    summary: plan.summary || null,
    days: plan.days || [],
  };
}

module.exports = {
  insertMeal,
  getMeal,
  listMealsForDate,
  listDates,
  deleteMeal,
  createProfile,
  listProfiles,
  verifyProfilePin,
  saveMealPlan,
  getLatestMealPlan,
};
