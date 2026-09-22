const Anthropic = require("@anthropic-ai/sdk");

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error("ANTHROPIC_API_KEY is not set on the server.");
    err.status = 500;
    throw err;
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const NUTRITION_TOOL = {
  name: "log_nutrition",
  description: "Record the structured nutrition estimate for a meal.",
  input_schema: {
    type: "object",
    properties: {
      description: { type: "string", description: "Short human-readable summary of the meal, e.g. 'Grilled chicken with rice and broccoli'." },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            portion_desc: { type: "string", description: "Portion in natural terms, e.g. '1.5 cups' or '2 slices'." },
            grams: { type: "number", description: "Best estimate of the portion weight in grams." },
            calories: { type: "number" },
            protein_g: { type: "number" },
            carbs_g: { type: "number" },
            fat_g: { type: "number" },
            fiber_g: { type: "number", description: "Dietary fiber in grams." },
            sugar_g: { type: "number", description: "Total sugars in grams." },
            sodium_mg: { type: "number", description: "Sodium in milligrams." },
            saturated_fat_g: { type: "number", description: "Saturated fat in grams." },
          },
          required: ["name", "portion_desc", "grams", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg", "saturated_fat_g"],
        },
      },
      total: {
        type: "object",
        properties: {
          calories: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
        },
        required: ["calories", "protein_g", "carbs_g", "fat_g"],
      },
    },
    required: ["description", "items", "total"],
  },
};

// Used for text / voice meal logging
const SYSTEM_PROMPT = `You are a careful nutrition estimation assistant embedded in a personal calorie tracking app.
Given a description of a meal (from speech or typed text), identify each distinct food item,
estimate its portion size in grams as best you can using the quantities the user mentions,
and estimate calories, protein, carbohydrates, fat, dietary fiber, total sugars, sodium (in mg), and saturated fat
for each item using standard nutrition knowledge (USDA-style values).
Always call the log_nutrition tool with your answer. Be a reasonable, realistic estimator - don't refuse due to uncertainty,
just give your best estimate and keep portions realistic. Sum item values into an accurate total.`;

// Used for photo meal logging — separately calibrated to avoid over-estimation
// from camera perspective and restaurant-vs-home cooking differences.
const PHOTO_SYSTEM_PROMPT = `You are a careful nutrition estimation assistant embedded in a personal calorie tracking app
used primarily for tracking home-cooked Indian meals.

## FOOD IDENTIFICATION — Be specific and precise

IDENTIFY EACH COMPONENT SEPARATELY:
- Split mixed dishes into individual items (e.g., rice + dal + sabzi + curry, not "dal makhani plate")
- Name each item distinctly to enable edits

COMMON INDIAN ITEMS & HOW TO IDENTIFY:
- Roti/Chapati: Thin, flat, unleavened; typically tan/white
- Paratha: Thicker, flaky, often has ghee sheen or visible oil layers
- Rice: Grain-based; basmati (long) vs regular (rounder)
- Dal: Lentil stew, typically orange/yellow (masoor), pale (moong), brown (chana), or split peas
- Sabzi (vegetable curry): Chunky vegetables in spiced sauce (aloo, bhindi, beans, spinach, etc.)
- Curry (meat/gravy-based): Chicken/fish/paneer in thick sauce; identify the protein and if visible
- Paneer: White cubes, firm; often in creamy curries (butter paneer, paneer makhani)
- Plain yogurt: White, smooth, creamy base; ~1 tbsp = ~7 kcal

DISTINGUISH SAUCE BASES:
- Tomato-based: Red/orange color; lighter, broth-like (< 100 kcal/serving)
- Cream-based: Pale, thick; makhani/butter curries (150–250 kcal/serving oil/cream)
- Coconut-based: White/pale; curries like korma (150–200 kcal/serving coconut milk)
- Oil-based: Dark, glossy; stir-fried or tempering oil visible (80–150 kcal/serving)

## PORTION SIZE — Photos systematically make food look larger

PLATE & BOWL ANCHORS:
- Standard 9–10" dinner plate: 350–450g total food (not stacked)
- Indian katori (small bowl): ~150ml capacity = 150–180g for watery curries, 120–150g for thick
- Soup bowl: ~250ml = 200–250g for soupy dal
- Cup (tea/coffee mug equivalent): ~240ml, use for rice measurement

SPECIFIC ITEM WEIGHTS (cooked, as served):
- 1 medium roti/chapati: 25–35g, ~85–110 kcal (depends on oil used)
- 1 paratha (stuffed): 50–70g, ~150–200 kcal; (plain): 40–50g, ~120–160 kcal
- 1 serving cooked basmati rice: 150–180g, ~190–230 kcal
- 1 serving regular rice: 140–170g, ~200–240 kcal
- 1 katori dal (medium thickness): 150–180g, ~80–120 kcal (plain) to 180–250 kcal (with ghee/oil)
- 1 piece paneer (curry): ~30–50g piece, ~60–100 kcal depending on sauce
- 1 chicken piece (thigh/breast in curry): ~80–120g total with gravy, ~120–200 kcal

USE VISUAL SCALE CUES:
- Spoon/fork width as reference (standard fork tine width ~4mm)
- Finger width (adult index finger width ~17mm) for thin roti/paratha
- Plate rim diameter (9–10" standard) to judge total portion
- Hand placement: palm width ~8cm, used for rice/dal mounding

## MACRO CALCULATIONS — Get ratios right for Indian foods

MACROS FOR COMMON ITEMS (per 100g cooked, raw weights scaled appropriately):
- Dal (plain): 9 kcal, 9% protein, 20% carbs, 0.3% fat per 100g cooked → scale to actual weight
- Rice (cooked): 130 kcal, 2.7g protein, 28g carbs, 0.3g fat per 100g
- Roti (oil-free): 250 kcal, 9g protein, 43g carbs, 1.5g fat per 100g
- Paneer: 265 kcal, 28g protein, 3.6g carbs, 17g fat per 100g
- Chicken (in curry with sauce): 70–100 kcal/100g (lean breast) or 120–150 kcal/100g (thighs)
- Yogurt (plain): 60 kcal, 3.5g protein, 4.7g carbs, 0.4g fat per 100g

OIL & GHEE — Assume home-cooked unless clearly restaurant/fried:
- Home dal/sabzi: 1–2 tsp (5–10ml) oil per serving = 45–90 kcal per serving, 5g fat
- Home roti (with ghee): 0–½ tsp (0–2.5ml) = 0–25 kcal, visible shine means ghee was used
- Paratha (with ghee inside): typically 1 tsp (5ml) = 45 kcal, 5g fat built-in; may have surface oil too
- Restaurant/takeout food (biryani, fried items, pizza): use full commercial high-oil values (1.5–2 tbsp oil per serving)
- Curry sauce: Add 15–30 kcal for visible oil/butter pool at bottom

CREAM & COCONUT:
- 1 tbsp heavy cream (~15ml): 45–50 kcal, 4.5g fat, 0.4g carbs
- 1 tbsp coconut milk or cream: 40–50 kcal, 4–5g fat, 1g carbs
- 1 tsp cream/yogurt dollop (5ml): 15–20 kcal, 1–1.5g fat
- If "creamy" appearance but no visible chunks, estimate 1–2 tbsp cream total, not per serving

UNCERTAINTY & DEFAULTS:
- When unsure between estimates, favour the LOWER reasonable estimate; don't add safety buffers
- If sauce base is ambiguous, assume tomato-based (lighter) unless it looks visibly creamy or oily
- If portion size unclear, ask user to specify or use plate/bowl rim as anchor
- For unidentifiable items, describe what you see (e.g., "beige stew-like preparation") so user can correct

MACRO TOTALS — Verify they're sensible:
- Protein should usually be 10–40g per meal (unless meat-heavy)
- Carbs should usually be 20–60g per meal (rice/roti are high-carb)
- Fat should usually be 5–25g per meal (oils/curries add up)
- Typical Indian home meal: 400–600 kcal, 15–30g protein, 40–70g carbs, 10–20g fat

Always call the log_nutrition tool with your answer. Be a realistic estimator — don't refuse.
Sum item values into an accurate total that makes nutritional sense for the meal shown.`;

async function analyzeMealText(text) {
  const anthropic = getClient();
  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [NUTRITION_TOOL],
    tool_choice: { type: "tool", name: "log_nutrition" },
    messages: [
      {
        role: "user",
        content: `Here is what I ate, described in my own words: "${text}". Estimate portions and nutrition.`,
      },
    ],
  });
  return extractNutritionResult(msg);
}

async function analyzeMealPhoto(base64Image, mediaType, captionText) {
  const anthropic = getClient();
  const userText = captionText
    ? `This is a photo of my meal. User notes: "${captionText}".
INSTRUCTIONS:
1. Identify EACH distinct food item separately (don't combine into one description)
2. Use visible scale references (plate size, utensil, hand) to estimate portion sizes accurately
3. For Indian meals, identify the specific type (roti/paratha/rice, dal type, sabzi type, curry base)
4. Estimate oil/ghee used based on appearance and whether it's clearly home-cooked or restaurant
5. Calculate macros carefully, especially protein and fat from oil/curry bases
6. Include all items: grain/bread, protein, vegetables, dairy, garnishes, liquids separately`
    : `This is a photo of my meal.
INSTRUCTIONS:
1. Identify EACH distinct food item separately (don't combine into one description)
2. Use visible scale references (plate size, utensil, hand) to estimate portion sizes accurately
3. For Indian meals, identify the specific type (roti/paratha/rice, dal type, sabzi type, curry base)
4. Estimate oil/ghee used based on appearance and whether it's clearly home-cooked or restaurant
5. Calculate macros carefully, especially protein and fat from oil/curry bases
6. Include all items: grain/bread, protein, vegetables, dairy, garnishes, liquids separately`;

  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: PHOTO_SYSTEM_PROMPT,
    tools: [NUTRITION_TOOL],
    tool_choice: { type: "tool", name: "log_nutrition" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
          { type: "text", text: userText },
        ],
      },
    ],
  });
  return extractNutritionResult(msg);
}

function extractToolResult(msg, toolName) {
  const toolUse = msg.content.find((b) => b.type === "tool_use" && b.name === toolName);
  if (!toolUse) {
    throw new Error("Model did not return a structured result. Try again.");
  }
  return toolUse.input;
}

function extractNutritionResult(msg) {
  return extractToolResult(msg, "log_nutrition");
}

const ESTIMATE_MACROS_TOOL = {
  name: "estimate_macros",
  description: "Record estimated nutrition for a list of food items given their name, portion, and weight.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Exact item name, copied verbatim from the input list." },
            calories: { type: "number" },
            protein_g: { type: "number" },
            carbs_g: { type: "number" },
            fat_g: { type: "number" },
            fiber_g: { type: "number", description: "Dietary fiber in grams." },
            sugar_g: { type: "number", description: "Total sugars in grams." },
            sodium_mg: { type: "number", description: "Sodium in milligrams." },
            saturated_fat_g: { type: "number", description: "Saturated fat in grams." },
          },
          required: ["name", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg", "saturated_fat_g"],
        },
      },
    },
    required: ["items"],
  },
};

const ESTIMATE_MACROS_SYSTEM_PROMPT = `You are a careful nutrition estimation assistant embedded in a personal
calorie tracking app. You will be given a numbered list of food items, each with a name, a portion description, and a
weight in grams that the person has already decided on. Trust the given grams as the exact portion size - do not
reinterpret or second-guess it from the portion description. For each item, estimate calories, protein, carbohydrates,
fat, dietary fiber, total sugars, sodium (in mg), and saturated fat using standard nutrition knowledge (USDA-style
values per 100g scaled to the given weight). Always call the estimate_macros tool with exactly one entry per item, in
the SAME ORDER as given (item 1 first, item 2 second, etc.) - do not skip, merge, or reorder any. Be a reasonable,
realistic estimator - don't refuse due to uncertainty.`;

// Recomputes calories/protein/carbs/fat for a list of {name, portion_desc, grams}
// items - used when a person edits a logged meal's name/portion/grams and the
// macros need to be recalculated rather than hand-entered.
//
// Matches results back to inputs by POSITION, not by re-parsing the "name"
// Claude echoes back: it sometimes folds the portion into that field (e.g.
// "Grilled chicken breast, 1 piece" instead of "Grilled chicken breast"),
// which silently broke exact-string matching and produced all-zero macros.
async function estimateItemMacros(items) {
  const anthropic = getClient();
  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    system: ESTIMATE_MACROS_SYSTEM_PROMPT,
    tools: [ESTIMATE_MACROS_TOOL],
    tool_choice: { type: "tool", name: "estimate_macros" },
    messages: [
      {
        role: "user",
        content: `Estimate nutrition for these ${items.length} item(s), in this exact order:\n${items
          .map((it, i) => `${i + 1}. ${it.name} - portion: ${it.portion_desc || "1 serving"} - weight: ${it.grams}g`)
          .join("\n")}`,
      },
    ],
  });
  const result = extractToolResult(msg, "estimate_macros").items || [];

  if (result.length !== items.length) {
    const err = new Error("Nutrition estimate didn't match the item list. Please try saving again.");
    err.status = 502;
    throw err;
  }

  return items.map((it, i) => {
    const est = result[i];
    return {
      name: it.name,
      portion_desc: it.portion_desc,
      grams: it.grams,
      calories: est?.calories ?? 0,
      protein_g: est?.protein_g ?? 0,
      carbs_g: est?.carbs_g ?? 0,
      fat_g: est?.fat_g ?? 0,
      fiber_g: est?.fiber_g ?? 0,
      sugar_g: est?.sugar_g ?? 0,
      sodium_mg: est?.sodium_mg ?? 0,
      saturated_fat_g: est?.saturated_fat_g ?? 0,
    };
  });
}

// ── 7-day progress AI summary ─────────────────────────────────────────────────
// Returns { score (1-10), summary (string), include (string[]), exclude (string[]) }
async function generateProgressSummary(name, targets, week) {
  const client = getClient();

  const hasTargets = targets && targets.calories;
  const loggedCount = week.filter((d) => d.hasData).length;

  const targetLine = hasTargets
    ? `Daily targets: ${targets.calories} kcal | protein ${targets.protein_g}g | carbs ${targets.carbs_g}g | fat ${targets.fat_g}g`
    : "No daily targets set — scoring based on logging consistency and macro balance only.";

  const dayLines = week
    .map((d) => {
      if (!d.hasData) return `  ${d.date} (${d.dayLabel}): no meals logged`;
      const diff = hasTargets ? ` | cal diff vs target: ${d.calories - targets.calories > 0 ? "+" : ""}${Math.round(d.calories - targets.calories)}` : "";
      return `  ${d.date} (${d.dayLabel}): ${Math.round(d.calories)} kcal${diff} | protein ${Math.round(d.protein_g)}g | carbs ${Math.round(d.carbs_g)}g | fat ${Math.round(d.fat_g)}g | fiber ${Math.round(d.fiber_g)}g | sugar ${Math.round(d.sugar_g)}g | sodium ${Math.round(d.sodium_mg)}mg | sat-fat ${Math.round(d.saturated_fat_g)}g`;
    })
    .join("\n");

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    tools: [{
      name: "diet_review",
      description: "Submit a structured 7-day diet adherence review",
      input_schema: {
        type: "object",
        properties: {
          score: {
            type: "integer",
            description: "Diet adherence score 1–10. Weight: logging consistency (days logged out of 7) 40%, calorie accuracy (avg deviation from target) 40%, macro balance 20%. Be honest but encouraging.",
            minimum: 1, maximum: 10
          },
          summary: {
            type: "string",
            description: "Exactly 2 sentences. Sentence 1: what went well, using the user's name. Sentence 2: the single most important thing to improve. Be warm, specific, no generic filler."
          },
          include: {
            type: "array",
            items: { type: "string" },
            description: "2–3 specific foods or food types to eat MORE of based on nutritional gaps in the data. Prefer Indian foods where appropriate. Format each as: 'Food name — short reason tied to their data'. E.g. 'Masoor dal — high protein and fiber, addresses your low protein days'.",
            minItems: 2, maxItems: 3
          },
          exclude: {
            type: "array",
            items: { type: "string" },
            description: "2–3 specific foods or patterns to REDUCE based on the data (excess sugar, sodium, saturated fat, or calorie spikes). Format each as: 'Food/pattern — short reason'. E.g. 'Fried snacks in the evening — likely driving your fat overage on Tue and Thu'.",
            minItems: 2, maxItems: 3
          }
        },
        required: ["score", "summary", "include", "exclude"]
      }
    }],
    tool_choice: { type: "tool", name: "diet_review" },
    messages: [{
      role: "user",
      content: `Review the following completed days of diet data for ${name}. Today is excluded because it is still in progress — base your analysis only on the days listed below.\n\n${targetLine}\nCompleted days logged: ${loggedCount}/${week.length}\n\n${dayLines}`
    }]
  });

  return extractToolResult(msg, "diet_review");
}

// ── Daily motivational greeting ───────────────────────────────────────────────
async function generateDailyQuote(name) {
  const client = getClient();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [{
      role: "user",
      content: `Write one short, warm motivational sentence (max 25 words) to encourage ${name} to eat healthily today. Use their name naturally. Be specific and uplifting, not generic. Return ONLY the sentence — no quotes, no explanation.`
    }]
  });
  return message.content[0].text.trim();
}

module.exports = { analyzeMealText, analyzeMealPhoto, getClient, extractToolResult, estimateItemMacros, generateDailyQuote, generateProgressSummary };
