#!/usr/bin/env node
/**
 * Cleanup script: Find and delete profiles with no meal data in the last 3 weeks
 * Run with: node cleanup-inactive-profiles.js
 */

require("dotenv").config();
const { findInactiveProfiles, deleteProfile } = require("./db");

async function main() {
  try {
    console.log("🔍 Finding inactive profiles (no meal data in last 21 days)...\n");
    const inactiveProfiles = await findInactiveProfiles(21);

    if (inactiveProfiles.length === 0) {
      console.log("✅ No inactive profiles found. All profiles have recent meal data!");
      return;
    }

    console.log(`Found ${inactiveProfiles.length} inactive profile(s):\n`);
    console.log("ID | Name | Created | Last Meal | Meal Count");
    console.log("---+------+---------+----------+------------");

    inactiveProfiles.forEach((p) => {
      const createdDate = new Date(p.created_at).toLocaleDateString();
      const lastMealDate = p.last_meal_date
        ? new Date(p.last_meal_date).toLocaleDateString()
        : "Never";
      const mealCount = p.meal_count || 0;
      console.log(
        `${String(p.id).padEnd(3)}| ${p.name.padEnd(6)}| ${createdDate} | ${lastMealDate.padEnd(8)} | ${mealCount}`
      );
    });

    console.log("\n⚠️  IMPORTANT: These profiles and ALL their data will be permanently deleted.");
    console.log(
      "This includes: meals, weight logs, exercise logs, meal plans, and health sync tokens.\n"
    );

    // In a real scenario, we'd prompt for confirmation here
    // For safety, this script requires manual confirmation
    const confirmDelete = process.argv.includes("--confirm");

    if (!confirmDelete) {
      console.log("To proceed with deletion, run:");
      console.log("  node cleanup-inactive-profiles.js --confirm\n");
      console.log("Or manually delete profiles by running:");
      inactiveProfiles.forEach((p) => {
        console.log(`  node -e "require('./db').deleteProfile(${p.id})"`);
      });
      return;
    }

    console.log("🗑️  Deleting inactive profiles...\n");

    for (const profile of inactiveProfiles) {
      try {
        await deleteProfile(profile.id);
        console.log(`✅ Deleted: ${profile.name} (ID: ${profile.id})`);
      } catch (err) {
        console.error(`❌ Failed to delete ${profile.name} (ID: ${profile.id}):`, err.message);
      }
    }

    console.log(`\n✅ Cleanup complete! Deleted ${inactiveProfiles.length} profile(s).`);
  } catch (err) {
    console.error("❌ Error during cleanup:", err);
    process.exit(1);
  }
}

main();
