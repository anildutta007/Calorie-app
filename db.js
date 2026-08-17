const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "calories.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
`);

function insertMeal(meal) {
  const stmt = db.prepare(`
    INSERT INTO meals (created_at, date, source, raw_input, description, items_json, calories, protein_g, carbs_g, fat_g, portion_flags_json)
    VALUES (@created_at, @date, @source, @raw_input, @description, @items_json, @calories, @protein_g, @carbs_g, @fat_g, @portion_flags_json)
  `);
  const info = stmt.run(meal);
  return getMeal(info.lastInsertRowid);
}

function getMeal(id) {
  const row = db.prepare("SELECT * FROM meals WHERE id = ?").get(id);
  return row ? formatRow(row) : null;
}

function listMealsForDate(date) {
  const rows = db.prepare("SELECT * FROM meals WHERE date = ? ORDER BY created_at ASC").all(date);
  return rows.map(formatRow);
}

function listDates() {
  return db.prepare("SELECT DISTINCT date FROM meals ORDER BY date DESC").all().map((r) => r.date);
}

function deleteMeal(id) {
  db.prepare("DELETE FROM meals WHERE id = ?").run(id);
}

function formatRow(row) {
  return {
    ...row,
    items: JSON.parse(row.items_json || "[]"),
    portion_flags: JSON.parse(row.portion_flags_json || "[]"),
  };
}

module.exports = { db, insertMeal, getMeal, listMealsForDate, listDates, deleteMeal };
