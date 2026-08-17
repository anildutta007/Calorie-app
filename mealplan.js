const { getClient, extractToolResult } = require("./nutrition");

const MEAL_ITEM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    portion_desc: { type: "string", description: "Portion in natural terms, e.g. '1 bowl' or '2 rotis'." },
    grams: { type: "number" },
    calories: { type: "number" },
    protein_g: { type: "number" },
    carbs_g: { type: "number" },
    fat_g: { type: "number" },
  },
  required: ["name", "portion_desc", "grams", "calories", "protein_g", "carbs_g", "fat_g"],
};

const MEAL_PLAN_TOOL = {
  name: "generate_meal_plan",
  description: "Record a structured 7-day Indian meal plan.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "1-2 sentence summary of the overall approach, e.g. which protein sources are emphasized.",
      },
      days: {
        type: "array",
        minItems: 7,
        maxItems: 7,
        items: {
          type: "object",
          properties: {
            day_number: { type: "integer", description: "1 through 7" },
            day_label: { type: "string", description: "e.g. 'Day 1' or 'Monday'" },
            meals: {
              type: "array",
              description: "breakfast, lunch, dinner, and optionally a snack",
              items: {
                type: "object",
                properties: {
                  meal_type: { type: "string", description: "breakfast | lunch | dinner | snack" },
                  items: { type: "array", items: MEAL_ITEM_SCHEMA },
                },
                required: ["meal_type", "items"],
              },
            },
            day_totals: {
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
          required: ["day_number", "meals", "day_totals"],
        },
      },
    },
    required: ["days"],
  },
};

const SYSTEM_PROMPT = `You are a nutrition planning assistant specialized in Indian cuisine, embedded in a personal
calorie tracking app. Given a daily calorie target, a daily protein target (grams), and a dietary preference, design
a realistic, varied 7-day Indian meal plan (breakfast, lunch, dinner, and an optional snack) using authentic, common
Indian dishes and realistic home-cook portion sizes.

Vary the dishes across the week rather than repeating the same meals every day. For a vegetarian plan, use no meat,
fish, or egg (dairy, paneer, and legumes are fine) - this follows the common Indian convention where "vegetarian"
excludes eggs. For a non-vegetarian plan, include chicken, egg, fish, or mutton dishes on several days alongside
vegetarian staples like dal, sabzi, and roti/rice.

Get each day's total calories and protein as close as possible to the targets (within roughly 10%), using standard
nutrition knowledge (USDA / Indian food composition style values) for your estimates. Always call the
generate_meal_plan tool with your answer. Be a reasonable, realistic estimator - don't refuse due to uncertainty.`;

async function generateMealPlan(calorieTarget, proteinTarget, diet) {
  const anthropic = getClient();
  const dietLabel =
    diet === "veg"
      ? "vegetarian (no meat, fish, or egg)"
      : "non-vegetarian (include chicken, egg, fish, or mutton on several days alongside vegetarian dishes)";

  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [MEAL_PLAN_TOOL],
    tool_choice: { type: "tool", name: "generate_meal_plan" },
    messages: [
      {
        role: "user",
        content: `Create a 7-day Indian meal plan. Daily calorie target: ${calorieTarget} kcal. Daily protein target: ${proteinTarget}g. Diet: ${dietLabel}.`,
      },
    ],
  });
  return extractToolResult(msg, "generate_meal_plan");
}

module.exports = { generateMealPlan };
