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

const SYSTEM_PROMPT = `You are a careful nutrition estimation assistant embedded in a personal calorie tracking app.
Given a description of a meal (from speech or typed text) or a photo of a plate, identify each distinct food item,
estimate its portion size in grams as best you can (use visual cues like plate size, utensils, or stated quantities),
and estimate calories, protein, carbohydrates, fat, dietary fiber, total sugars, sodium (in mg), and saturated fat
for each item using standard nutrition knowledge (USDA-style values).
Always call the log_nutrition tool with your answer. Be a reasonable, realistic estimator - don't refuse due to uncertainty,
just give your best estimate and keep portions realistic. Sum item values into an accurate total.`;

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
    ? `This is a photo of my plate. Additional context from me: "${captionText}". Identify each food item, estimate portions, and estimate nutrition.`
    : `This is a photo of my plate. Identify each food item, estimate portions (use the plate/utensils for scale), and estimate nutrition.`;

  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
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
      content: `Review the last 7 days of diet data for ${name}.\n\n${targetLine}\nDays logged: ${loggedCount}/7\n\n${dayLines}`
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
