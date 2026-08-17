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
  return extractToolResult(msg);
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
  return extractToolResult(msg);
}

function extractToolResult(msg) {
  const toolUse = msg.content.find((b) => b.type === "tool_use" && b.name === "log_nutrition");
  if (!toolUse) {
    throw new Error("Model did not return a structured nutrition estimate. Try again.");
  }
  return toolUse.input;
}

module.exports = { analyzeMealText, analyzeMealPhoto };
