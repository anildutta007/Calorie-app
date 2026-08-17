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
    initialized = sql`
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
        portion_flags_json TEXT         -- JSON array of portion flags
      );
    `;
  }
  return initialized;
}

async function insertMeal(meal) {
  await init();
  const rows = await sql`
    INSERT INTO meals (created_at, date, source, raw_input, description, items_json, calories, protein_g, carbs_g, fat_g, portion_flags_json)
    VALUES (${meal.created_at}, ${meal.date}, ${meal.source}, ${meal.raw_input}, ${meal.description}, ${meal.items_json}, ${meal.calories}, ${meal.protein_g}, ${meal.carbs_g}, ${meal.fat_g}, ${meal.portion_flags_json})
    RETURNING *
  `;
  return formatRow(rows[0]);
}

async function getMeal(id) {
  await init();
  const rows = await sql`SELECT * FROM meals WHERE id = ${id}`;
  return rows[0] ? formatRow(rows[0]) : null;
}

async function listMealsForDate(date) {
  await init();
  const rows = await sql`SELECT * FROM meals WHERE date = ${date} ORDER BY created_at ASC`;
  return rows.map(formatRow);
}

async function listDates() {
  await init();
  const rows = await sql`SELECT DISTINCT date FROM meals ORDER BY date DESC`;
  return rows.map((r) => r.date);
}

async function deleteMeal(id) {
  await init();
  await sql`DELETE FROM meals WHERE id = ${id}`;
}

function formatRow(row) {
  return {
    ...row,
    items: JSON.parse(row.items_json || "[]"),
    portion_flags: JSON.parse(row.portion_flags_json || "[]"),
  };
}

module.exports = { insertMeal, getMeal, listMealsForDate, listDates, deleteMeal };
