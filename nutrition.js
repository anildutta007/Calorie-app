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
          },
          required: ["name", "portion_desc", "grams", "calories", "protein_g", "carbs_g", "fat_g"],
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
and estimate calories, protein, carbohydrates, and fat for each item using standard nutrition knowledge (USDA-style values).
Always call the log_nutrition tool with your answer. Be a reasonable, realistic estimator - don't refuse due to uncertainty,
just give your best estimate and keep portions realistic. Sum item values into an accurate total.`;

async function analyzeMealText(text) {
  const anthropic = getClient();
  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
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
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
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
          },
          required: ["name", "calories", "protein_g", "carbs_g", "fat_g"],
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
and fat using standard nutrition knowledge (USDA-style values per 100g scaled to the given weight). Always call the
estimate_macros tool with exactly one entry per item, in the SAME ORDER as given (item 1 first, item 2 second, etc.) -
do not skip, merge, or reorder any. Be a reasonable, realistic estimator - don't refuse due to uncertainty.`;

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
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
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
    };
  });
}

module.exports = { analyzeMealText, analyzeMealPhoto, getClient, extractToolResult, estimateItemMacros };
