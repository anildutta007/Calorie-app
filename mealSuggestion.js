// AI meal suggestion — generates 2-3 Indian home-cooked meals to fill the
// user's remaining daily macro targets, complete with full recipes.
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

const SUGGEST_TOOL = {
  name: "suggest_completion_meals",
  description:
    "Suggest 2-3 Indian home-cooked meals that together would fill the user's " +
    "remaining daily nutrition targets, with full recipes.",
  input_schema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            name:         { type: "string", description: "Dish name, e.g. 'Moong Dal Khichdi'" },
            description:  { type: "string", description: "1-2 sentences: what the dish is and why it suits the remaining targets" },
            portion_desc: { type: "string", description: "Serving size in natural terms, e.g. '1 bowl (~250g)'" },
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
                ingredients:     { type: "array", items: { type: "string" },
                  description: "Full ingredient list with quantities, e.g. '1 cup moong dal'" },
                steps:           { type: "array", items: { type: "string" },
                  description: "Step-by-step cooking instructions" },
              },
              required: ["serves", "prep_time_min", "cook_time_min", "ingredients", "steps"],
            },
          },
          required: ["name", "description", "portion_desc", "calories", "protein_g", "carbs_g", "fat_g", "recipe"],
        },
      },
    },
    required: ["suggestions"],
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
    `Suggest 2–3 simple Indian home-cooked meals for the rest of the day that together ` +
    `would roughly fill these remaining targets.\n\n` +
    `Important guidelines:\n` +
    `- Use realistic Indian home-cooking portions (not restaurant portions)\n` +
    `- Choose commonly available Indian ingredients\n` +
    `- Include a complete recipe for each: full ingredients list with quantities and step-by-step cooking method\n` +
    `- Nutrition should be accurate for home-cooked Indian food (1–2 tsp oil per dish, not deep-fry amounts)\n` +
    `- Suggestions can be a main meal, a snack, or a combination — whatever fits the remaining targets best`;

  const msg = await c.messages.create({
    model:       "claude-haiku-4-5-20251001",
    max_tokens:  4096,
    tools:       [SUGGEST_TOOL],
    tool_choice: { type: "tool", name: "suggest_completion_meals" },
    messages:    [{ role: "user", content: prompt }],
  });

  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse?.input?.suggestions?.length) {
    throw new Error("AI did not return meal suggestions — please try again.");
  }
  return toolUse.input.suggestions;
}

module.exports = { suggestCompletionMeals };
