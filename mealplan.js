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

function buildMealPlanTool(days) {
  return {
    name: "generate_meal_plan",
    description: `Record a structured ${days}-day Indian meal plan.`,
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "1-2 sentence summary of the overall approach, e.g. which protein sources are emphasized.",
        },
        days: {
          type: "array",
          minItems: days,
          maxItems: days,
          items: {
            type: "object",
            properties: {
              day_number: { type: "integer", description: `1 through ${days}` },
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
}

const SYSTEM_PROMPT = `You are a nutrition planning assistant specialized in Indian cuisine, embedded in a personal
calorie tracking app. Given a number of days, a daily calorie target, a daily protein target (grams), and a dietary
description, design a realistic, varied Indian meal plan for exactly that many days (breakfast, lunch, dinner, and an
optional snack per day) using authentic, common Indian dishes and realistic home-cook portion sizes.

Vary the dishes across the days rather than repeating the same meals every day. Follow the dietary description
exactly, including any explicit exclusions - never use an excluded ingredient even once across the whole plan, in any
dish, garnish, or stock. Dairy, paneer, and legumes are always acceptable regardless of diet.

Get each day's total calories and protein as close as possible to the targets (within roughly 10%), using standard
nutrition knowledge (USDA / Indian food composition style values) for your estimates. Always call the
generate_meal_plan tool with your answer, with exactly the requested number of days. Be a reasonable, realistic
estimator - don't refuse due to uncertainty.`;

const ALL_NONVEG_PROTEINS = ["chicken", "fish", "egg", "mutton", "pork", "beef"];
const ALL_VEG_ADDONS = ["egg", "fish"];

function buildDietDescription(diet, includedProteins) {
  const included = new Set(includedProteins || []);

  if (diet === "veg") {
    const addons = ALL_VEG_ADDONS.filter((p) => included.has(p));
    if (addons.length === 0) {
      return "strict vegetarian: no meat, fish, or egg anywhere in the plan";
    }
    return `vegetarian, but also open to including ${addons.join(" and ")} alongside standard vegetarian dishes. Do NOT include any other meat or fish.`;
  }

  // non-veg
  const includedMeats = ALL_NONVEG_PROTEINS.filter((p) => included.has(p));
  const excludedMeats = ALL_NONVEG_PROTEINS.filter((p) => !included.has(p));

  let desc = includedMeats.length
    ? `non-vegetarian; may include ${includedMeats.join(", ")} on various days alongside vegetarian dishes like dal, sabzi, and roti/rice`
    : "no specific meats were approved, so treat this as vegetarian for protein sources (dal, paneer, legumes) despite the non-vegetarian category";

  if (excludedMeats.length) {
    desc += `. Do NOT include ${excludedMeats.join(", ")} anywhere in the plan under any circumstance.`;
  }
  return desc;
}

async function generateMealPlan(calorieTarget, proteinTarget, diet, includedProteins, days) {
  const anthropic = getClient();
  const dietLabel = buildDietDescription(diet, includedProteins);
  const dayCount = Math.min(Math.max(Math.round(days) || 7, 1), 7);

  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [buildMealPlanTool(dayCount)],
    tool_choice: { type: "tool", name: "generate_meal_plan" },
    messages: [
      {
        role: "user",
        content: `Create a ${dayCount}-day Indian meal plan. Daily calorie target: ${calorieTarget} kcal. Daily protein target: ${proteinTarget}g. Diet: ${dietLabel}.`,
      },
    ],
  });
  return extractToolResult(msg, "generate_meal_plan");
}

module.exports = { generateMealPlan, ALL_NONVEG_PROTEINS, ALL_VEG_ADDONS };
