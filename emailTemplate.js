// HTML email builder for the meal plan.
// Uses inline styles throughout — email clients strip <style> blocks.

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Canonical meal-type sort order (mirrors app.js)
const MEAL_TYPE_ORDER = [
  "breakfast", "morning snack", "mid-morning snack",
  "snack", "pre-workout", "lunch",
  "afternoon snack", "evening snack", "dinner", "post-dinner",
];
function mealTypeSortKey(type) {
  const lower = type.toLowerCase();
  const idx = MEAL_TYPE_ORDER.findIndex(
    (t) => lower.includes(t) || t.includes(lower)
  );
  return idx === -1 ? 99 : idx;
}

function buildMealPlanEmail(mealPlan, selectedRecipeNames, recipes) {
  const dietLabel = mealPlan.diet === "veg" ? "Vegetarian" : "Non-Vegetarian";
  const proteins   = mealPlan.included_proteins || [];
  const proteinLabel = proteins.length
    ? ` + ${proteins.map(cap).join(", ")}`
    : mealPlan.diet === "veg" ? " (strict)" : "";
  const days = mealPlan.days;

  // ── Calendar table ────────────────────────────────────────────────────
  // Collect unique meal types in order
  const mealTypeSet = new Set();
  days.forEach((d) => d.meals.forEach((m) => mealTypeSet.add(m.meal_type)));
  const mealTypes = [...mealTypeSet].sort(
    (a, b) => mealTypeSortKey(a) - mealTypeSortKey(b)
  );

  // day index → mealType → items[]
  const mealMap = days.map((day) => {
    const m = {};
    day.meals.forEach((meal) => { m[meal.meal_type] = meal.items; });
    return m;
  });

  // Colours
  const GREEN      = "#2f6f4f";
  const GREEN_DARK = "#1a4a2e";
  const GREEN_LIGHT= "#e6f2ec";
  const BORDER     = "#b0cbb8";

  const tdBase = `border:1px solid ${BORDER};padding:7px 9px;vertical-align:top;font-size:12px;font-family:Arial,sans-serif;`;
  const thMealType = `${tdBase}background:${GREEN_LIGHT};font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${GREEN_DARK};width:90px;`;
  const thDay = `${tdBase}background:${GREEN};color:white;text-align:center;font-weight:700;font-size:12px;`;

  // Header row
  const headerCells = days.map(
    (d) => `<th style="${thDay}">${d.day_label || `Day ${d.day_number}`}</th>`
  ).join("");

  // Body rows
  const bodyRows = mealTypes.map((mealType) => {
    const cells = days.map((_, di) => {
      const items = mealMap[di][mealType] || [];
      const content = items.length
        ? items.map((it) => `<div style="margin-bottom:2px">${it.name}</div>`).join("")
        : `<span style="color:#bbb">—</span>`;
      return `<td style="${tdBase}">${content}</td>`;
    }).join("");
    return `<tr>
      <th style="${thMealType}">${cap(mealType)}</th>
      ${cells}
    </tr>`;
  }).join("");

  // Totals row
  const totalCells = days.map((d) => {
    const t = d.day_totals;
    const p = Math.round(t.protein_g);
    const c = Math.round(t.carbs_g);
    const f = Math.round(t.fat_g);
    return `<td style="${tdBase}font-size:11px;color:#444;background:#f9f9f9">
      <strong>${Math.round(t.calories)} kcal</strong><br>${p}g P · ${c}g C · ${f}g F
    </td>`;
  }).join("");

  const tableHtml = `
    <table cellpadding="0" cellspacing="0" width="100%"
           style="border-collapse:collapse;table-layout:fixed;font-family:Arial,sans-serif;">
      <thead>
        <tr>
          <th style="${thMealType}background:${GREEN_DARK};color:white;">Meal</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr>
          <th style="${thMealType}">Daily totals</th>
          ${totalCells}
        </tr>
      </tbody>
    </table>`;

  // ── Recipes ───────────────────────────────────────────────────────────
  const recipesHtml = selectedRecipeNames
    .filter((name) => recipes[name])
    .map((name) => {
      const r = recipes[name];
      const meta = [
        r.serves        ? `Serves ${r.serves}` : "",
        r.prep_time_min ? `Prep ${r.prep_time_min} min` : "",
        r.cook_time_min ? `Cook ${r.cook_time_min} min` : "",
      ].filter(Boolean).join(" · ");
      const ingredients = r.ingredients?.length
        ? `<p style="margin:8px 0 4px;font-weight:700;font-size:13px">Ingredients</p>
           <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6">
             ${r.ingredients.map((i) => `<li>${i}</li>`).join("")}
           </ul>`
        : "";
      const steps = r.steps?.length
        ? `<p style="margin:10px 0 4px;font-weight:700;font-size:13px">Method</p>
           <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.6">
             ${r.steps.map((s) => `<li style="margin-bottom:4px">${s}</li>`).join("")}
           </ol>`
        : "";
      return `
        <div style="margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #ddd">
          <h3 style="margin:0 0 4px;font-size:15px;color:${GREEN_DARK}">${name}</h3>
          ${meta ? `<p style="margin:0 0 8px;font-size:12px;color:#777">${meta}</p>` : ""}
          ${ingredients}
          ${steps}
        </div>`;
    }).join("");

  // ── Full email HTML ───────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:Arial,sans-serif">
  <div style="max-width:700px;margin:24px auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

    <!-- Header banner -->
    <div style="background:${GREEN};padding:20px 24px">
      <div style="font-size:20px;font-weight:700;color:white">🍽️ Dutta Food Planner</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:3px">Your personalised meal plan</div>
    </div>

    <!-- Plan meta -->
    <div style="padding:16px 24px;border-bottom:1px solid #eee;background:#f9fdf9">
      <div style="font-size:16px;font-weight:700;color:${GREEN_DARK}">
        ${days.length}-Day Indian Meal Plan · ${dietLabel}${proteinLabel}
      </div>
      <div style="font-size:12px;color:#666;margin-top:4px">
        Target: ${Math.round(mealPlan.calorie_target)} kcal/day · ${Math.round(mealPlan.protein_target)}g protein/day
      </div>
      ${mealPlan.summary ? `<p style="margin:8px 0 0;font-size:13px;color:#444;font-style:italic">${mealPlan.summary}</p>` : ""}
    </div>

    <!-- Calendar table -->
    <div style="padding:20px 24px;overflow-x:auto">
      ${tableHtml}
    </div>

    ${recipesHtml ? `
    <!-- Recipes -->
    <div style="padding:4px 24px 20px">
      <h2 style="font-size:17px;color:${GREEN_DARK};border-bottom:2px solid ${GREEN};padding-bottom:6px;margin-bottom:16px">Recipes</h2>
      ${recipesHtml}
    </div>` : ""}

    <!-- Footer -->
    <div style="background:#f0f4f1;padding:14px 24px;text-align:center;font-size:11px;color:#888">
      Sent from Dutta Food Planner &amp; Calorie Counter ·
      <a href="https://calorie-app-sweg.vercel.app" style="color:${GREEN}">Open app</a>
    </div>
  </div>
</body>
</html>`;
}

// ── Meal-completion suggestion email ─────────────────────────────────────────
function buildSuggestionEmail(single_dish, suggestions, remaining) {
  const GREEN       = "#2f6f4f";
  const GREEN_DARK  = "#1a4a2e";
  const GREEN_LIGHT = "#e6f2ec";
  const BORDER      = "#b0cbb8";

  const remainHtml = remaining
    ? `<div style="font-size:12px;color:#666;margin-top:4px">
        Remaining when generated:
        ${Math.round(remaining.calories  || 0)} kcal ·
        ${Math.round(remaining.protein_g || 0)}g protein ·
        ${Math.round(remaining.carbs_g   || 0)}g carbs ·
        ${Math.round(remaining.fat_g     || 0)}g fat
       </div>`
    : "";

  const tdChip = `display:inline-block;background:${GREEN_LIGHT};color:${GREEN_DARK};border-radius:4px;padding:3px 8px;font-size:12px;margin:2px 4px 2px 0;font-family:Arial,sans-serif;`;

  // Helper to render one dish card (used for both single_dish and suggestions)
  function dishBlock(s, tagLabel, highlight) {
    const recipe = s.recipe || {};
    const meta = [
      recipe.serves        ? `Serves ${recipe.serves}`            : "",
      recipe.prep_time_min ? `Prep ${recipe.prep_time_min} min`   : "",
      recipe.cook_time_min ? `Cook ${recipe.cook_time_min} min`   : "",
    ].filter(Boolean).join(" · ");
    const ingHtml = recipe.ingredients?.length
      ? `<p style="margin:10px 0 4px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">Ingredients</p>
         <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;font-family:Arial,sans-serif">
           ${recipe.ingredients.map((x) => `<li>${x}</li>`).join("")}
         </ul>`
      : "";
    const stepsHtml = recipe.steps?.length
      ? `<p style="margin:10px 0 4px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">Method</p>
         <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;font-family:Arial,sans-serif">
           ${recipe.steps.map((x) => `<li style="margin-bottom:4px">${x}</li>`).join("")}
         </ol>`
      : "";
    const bg     = highlight ? "#f0faf4" : "#f9fdf9";
    const border = highlight ? GREEN     : BORDER;
    return `
      <div style="margin-bottom:20px;padding:16px;background:${bg};border:2px solid ${border};border-radius:8px">
        <div style="font-size:11px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;font-family:Arial,sans-serif">
          ${tagLabel}
        </div>
        <h3 style="margin:0 0 4px;font-size:16px;color:${GREEN_DARK};font-family:Arial,sans-serif">${s.name}</h3>
        <p style="margin:0 0 8px;font-size:13px;color:#555;font-style:italic;font-family:Arial,sans-serif">${s.description}</p>
        ${meta ? `<div style="font-size:12px;color:#777;margin-bottom:10px;font-family:Arial,sans-serif">${meta}</div>` : ""}
        <div style="margin-bottom:10px">
          <span style="${tdChip}"><strong>${Math.round(s.calories)}</strong> kcal</span>
          <span style="${tdChip}"><strong>${Math.round(s.protein_g)}g</strong> protein</span>
          <span style="${tdChip}"><strong>${Math.round(s.carbs_g)}g</strong> carbs</span>
          <span style="${tdChip}"><strong>${Math.round(s.fat_g)}g</strong> fat</span>
        </div>
        <div style="font-size:12px;color:#888;margin-bottom:12px;font-family:Arial,sans-serif">${s.portion_desc}</div>
        ${ingHtml}
        ${stepsHtml}
      </div>`;
  }

  // Single-dish section
  const singleHtml = single_dish
    ? `<h2 style="margin:0 0 10px;font-size:14px;color:${GREEN_DARK};font-family:Arial,sans-serif">
         ⭐ All-in-one option
       </h2>
       ${dishBlock(single_dish, "⭐ Covers everything", true)}`
    : "";

  // Divider
  const dividerHtml = (single_dish && suggestions.length)
    ? `<div style="text-align:center;font-size:12px;color:#999;margin:16px 0;font-family:Arial,sans-serif">— or spread it across —</div>`
    : "";

  // Multi-dish section
  const multiHtml = suggestions.length
    ? `<h2 style="margin:0 0 10px;font-size:14px;color:${GREEN_DARK};font-family:Arial,sans-serif">
         🍽️ Multiple dishes
       </h2>
       ${suggestions.map((s, i) => dishBlock(s, `Option ${i + 1}`, false)).join("")}`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:Arial,sans-serif">
  <div style="max-width:640px;margin:24px auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

    <div style="background:${GREEN};padding:20px 24px">
      <div style="font-size:20px;font-weight:700;color:white;font-family:Arial,sans-serif">🍽️ Complete My Day</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:3px;font-family:Arial,sans-serif">
        Dutta Food Planner · Meal suggestions for your remaining targets
      </div>
    </div>

    <div style="padding:16px 24px;border-bottom:1px solid #eee;background:#f9fdf9">
      <div style="font-size:15px;font-weight:700;color:${GREEN_DARK};font-family:Arial,sans-serif">
        Your personalised meal suggestions
      </div>
      ${remainHtml}
    </div>

    <div style="padding:20px 24px">
      ${singleHtml}
      ${dividerHtml}
      ${multiHtml}
    </div>

    <div style="background:#f0f4f1;padding:14px 24px;text-align:center;font-size:11px;color:#888;font-family:Arial,sans-serif">
      Sent from Dutta Food Planner &amp; Calorie Counter ·
      <a href="https://calorie-app-sweg.vercel.app" style="color:${GREEN}">Open app</a>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { buildMealPlanEmail, buildSuggestionEmail };
