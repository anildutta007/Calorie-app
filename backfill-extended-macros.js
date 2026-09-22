#!/usr/bin/env node
/**
 * Backfill script: Calculate extended macros (fiber, sugar, sodium, saturated fat)
 * for meals that have 0 values (created before this feature was added)
 */

require("dotenv").config();
const { estimateItemMacros } = require("./nutrition");
const { neon } = require("@neondatabase/serverless");

async function init() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    throw new Error("No database connection string found (DATABASE_URL / POSTGRES_URL)");
  }
  return neon(connectionString);
}

async function backfillMealMacros() {
  try {
    console.log("🔍 Finding meals with missing extended macros...\n");
    const rawSql = await init();
    const sql = rawSql;

    // Find meals where fiber_g is 0 (proxy for "extended macros not calculated")
    const mealsNeedingBackfill = await sql`
      SELECT id, items_json, calories, protein_g, carbs_g, fat_g
      FROM meals
      WHERE fiber_g = 0
      ORDER BY created_at DESC
      LIMIT 100
    `;

    if (mealsNeedingBackfill.length === 0) {
      console.log("✅ All meals have extended macro data!");
      return;
    }

    console.log(`Found ${mealsNeedingBackfill.length} meal(s) needing backfill\n`);

    let updated = 0;
    let errors = 0;

    for (const meal of mealsNeedingBackfill) {
      try {
        const items = JSON.parse(meal.items_json || "[]");

        if (items.length === 0) {
          console.log(`⏭️  Meal ${meal.id}: no items to estimate`);
          continue;
        }

        console.log(`📊 Estimating macros for meal ${meal.id} (${items.length} item(s))...`);

        // Use the AI to estimate extended macros
        const estimatedItems = await estimateItemMacros(items);

        // Calculate totals
        const fiber_g = estimatedItems.reduce((sum, it) => sum + (it.fiber_g || 0), 0);
        const sugar_g = estimatedItems.reduce((sum, it) => sum + (it.sugar_g || 0), 0);
        const sodium_mg = estimatedItems.reduce((sum, it) => sum + (it.sodium_mg || 0), 0);
        const saturated_fat_g = estimatedItems.reduce((sum, it) => sum + (it.saturated_fat_g || 0), 0);

        // Update the meal
        await sql`
          UPDATE meals
          SET items_json = ${JSON.stringify(estimatedItems)},
              fiber_g = ${fiber_g},
              sugar_g = ${sugar_g},
              sodium_mg = ${sodium_mg},
              saturated_fat_g = ${saturated_fat_g}
          WHERE id = ${meal.id}
        `;

        console.log(`   ✅ Updated: fiber=${fiber_g.toFixed(1)}g, sugar=${sugar_g.toFixed(1)}g, sodium=${sodium_mg.toFixed(0)}mg, sat fat=${saturated_fat_g.toFixed(1)}g`);
        updated++;
      } catch (err) {
        console.error(`   ❌ Error: ${err.message}`);
        errors++;
      }
    }

    console.log(`\n✅ Backfill complete: ${updated} meals updated, ${errors} errors`);
  } catch (err) {
    console.error("❌ Backfill failed:", err.message);
    process.exit(1);
  }
}

backfillMealMacros();
