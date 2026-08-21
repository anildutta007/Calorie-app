// AI meal suggestion — generates:
//  • single_dish  — one dish that covers ALL remaining daily macro targets
//  • suggestions  — 2-3 individual Indian meals that together fill the gap
// Both come back in one AI call via tool use.
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

// Reusable shape for a dish (single or one of many)
const DISH_SCHEMA = {
  type: "object",
  properties: {
    name:         { type: "string", description: "Dish name, e.g. 'Chicken Khichdi'" },
    description:  { type: "string", description: "1-2 sentences: what the dish is and why it matches the remaining targets" },
    portion_desc: { type: "string", description: "Serving size in natural terms, e.g. '1 large bowl (~350g)'" },
    calories:     { type: "number", description: "Calories for the stated portion" },
    protein_g:    { type: "number" },
    carbs_g:      { type: "number" },
    fat_g:        { type: "number" },
    recipe: {
      type: "object",
      properties: {
        serves:          { type: "number" },
        prep_time_min:   { type: "number" },
        cook_time_min:   { type: "number" },
        ingredients: {
          type: "array", items: { type: "string" },
          description: "Full ingredient list with quantities, e.g. '1 cup moong dal'",
        },
        steps: {
          type: "array", items: { type: "string" },
          description: "Step-by-step cooking instructions",
        },
      },
      required: ["serves", "prep_time_min", "cook_time_min", "ingredients", "steps"],
    },
  },
  required: ["name", "description", "portion_desc", "calories", "protein_g", "carbs_g", "fat_g", "recipe"],
};

const SUGGEST_TOOL = {
  name: "suggest_completion_meals",
  description:
    "Return two kinds of suggestions to help the user hit their remaining daily targets:\n" +
    "1. single_dish — ONE dish that covers ALL remaining calories/protein/carbs/fat on its own.\n" +
    "2. suggestions — 2-3 individual dishes that TOGETHER cover the remaining targets.",
  input_schema: {
    type: "object",
    properties: {
      single_dish: {
        ...DISH_SCHEMA,
        description:
          "A single, complete Indian home-cooked dish that on its own covers all the " +
          "remaining calorie and macro targets for the day. Choose a nourishing, satisfying " +
          "dish that naturally provides this balance (e.g. a one-pot meal like khichdi, " +
          "a complete thali, or a protein-rich curry with rice/roti).",
      },
      suggestions: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        description: "2-3 smaller / lighter individual dishes that TOGETHER cover the remaining targets.",
        items: DISH_SCHEMA,
      },
    },
    required: ["single_dish", "suggestions"],
  },
};

async function suggestCompletionMeals({
  remaining_calories, remaining_protein_g, remaining_carbs_g, remaining_fat_g,
  diet, liked_foods, avoided_foods,
}) {
  const c = getClient();

  const dietLabel = diet === "non-veg"
    ? "non-vegetarian (can include chicken, fish, eggs, mutton, etc.)"
    : "vegetarian (no meat or fish)";
  const likesNote  = liked_foods  ? `\nFoods the person enjoys: ${liked_foods}.`  : "";
  const avoidNote  = avoided_foods ? `\nFoods to avoid: ${avoided_foods}.` : "";

  const prompt =
    `You are a nutrition expert specialising in Indian home cooking.\n\n` +
    `The user has already eaten some meals today and has these remaining macro targets to meet:\n` +
    `• Calories: ${Math.round(remaining_calories)} kcal\n` +
    `• Protein:  ${Math.round(remaining_protein_g)}g\n` +
    `• Carbs:    ${Math.round(remaining_carbs_g)}g\n` +
    `• Fat:      ${Math.round(remaining_fat_g)}g\n\n` +
    `Diet preference: ${dietLabel}${likesNote}${avoidNote}\n\n` +
    `Please provide TWO kinds of suggestions:\n\n` +
    `1. SINGLE DISH: One complete Indian dish that on its own covers all the remaining ` +
    `targets in a single meal. It should be satisfying and realistic for home cooking ` +
    `(e.g. a hearty khichdi, a full thali, or a protein curry with rice/roti).\n\n` +
    `2. MULTI-DISH (2-3 options): Smaller individual dishes that together would cover ` +
    `the remaining targets — could be a light meal + snack combination.\n\n` +
    `Important guidelines for all suggestions:\n` +
    `- Use realistic Indian home-cooking portions (not restaurant portions)\n` +
    `- Choose commonly available Indian ingredients\n` +
    `- Include a complete recipe: full ingredients list with quantities and step-by-step method\n` +
    `- Nutrition should be accurate for home-cooked Indian food (1-2 tsp oil, not deep-fry amounts)\n` +
    `- The single_dish nutrition should roughly match ALL remaining targets on its own`;

  const msg = await c.messages.create({
    model:       "claude-haiku-4-5-20251001",
    max_tokens:  6000,
    tools:       [SUGGEST_TOOL],
    tool_choice: { type: "tool", name: "suggest_completion_meals" },
    messages:    [{ role: "user", content: prompt }],
  });

  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse?.input) {
    throw new Error("AI did not return meal suggestions — please try again.");
  }

  const { single_dish, suggestions } = toolUse.input;

  if (!single_dish || !suggestions?.length) {
    throw new Error("AI returned an incomplete response — please try again.");
  }

  return { single_dish, suggestions };
}

module.exports = { suggestCompletionMeals };
