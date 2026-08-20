const { getClient, extractToolResult } = require("./nutrition");

const RECIPE_TOOL = {
  name: "generate_recipes",
  description: "Record simple home-cook recipes for a list of Indian dishes.",
  input_schema: {
    type: "object",
    properties: {
      recipes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Exact dish name, copied verbatim from the input list." },
            serves: { type: "integer" },
            prep_time_min: { type: "integer" },
            cook_time_min: { type: "integer" },
            ingredients: {
              type: "array",
              items: { type: "string" },
              description: "Each entry includes a quantity, e.g. '1 cup basmati rice, rinsed'.",
            },
            steps: {
              type: "array",
              items: { type: "string" },
              description: "Numbered cooking steps, one clear action per entry, beginner-friendly.",
            },
          },
          required: ["name", "ingredients", "steps"],
        },
      },
    },
    required: ["recipes"],
  },
};

const SYSTEM_PROMPT = `You are a home cooking assistant specialized in Indian cuisine, embedded in a personal
calorie tracking app. You will be given a numbered list of dish names pulled from a meal plan. For EACH dish, write a
simple, realistic recipe a home cook could actually follow: ingredients with practical quantities (sized for the
given "serves" count, default 2), and clear numbered steps. Keep it practical for a typical Indian home kitchen
(stovetop, pressure cooker, kadai/tawa) - no professional techniques or hard-to-find ingredients. Always call the
generate_recipes tool with exactly one entry per dish, in the SAME ORDER as given (dish 1 first, dish 2 second, etc.)
- do not skip, merge, or reorder any.`;

// Matches recipes back to dish names by POSITION within the batch, not by
// re-parsing the "name" Claude echoes back: it sometimes folds extra text
// into that field, which silently broke exact-string matching and made
// dishes show up as "recipe not available" even though Claude wrote one.
async function generateRecipesBatch(dishNames) {
  const anthropic = getClient();
  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [RECIPE_TOOL],
    tool_choice: { type: "tool", name: "generate_recipes" },
    messages: [
      {
        role: "user",
        content: `Write recipes for these ${dishNames.length} dish(es), in this exact order:\n${dishNames
          .map((n, i) => `${i + 1}. ${n}`)
          .join("\n")}`,
      },
    ],
  });
  const recipes = extractToolResult(msg, "generate_recipes").recipes || [];
  if (recipes.length !== dishNames.length) {
    const err = new Error("Recipe list didn't match the requested dishes. Please try again.");
    err.status = 502;
    throw err;
  }
  return dishNames.map((name, i) => ({ name, recipe: recipes[i] }));
}

// A full 7-day plan can easily have 30-40+ unique dishes, which risks
// truncating (and silently losing) a single big tool-call response before it
// finishes. Batching into smaller chunks run in parallel avoids that ceiling
// and is also faster wall-clock time than one huge sequential call.
const RECIPE_BATCH_SIZE = 10;

async function generateRecipes(dishNames) {
  const batches = [];
  for (let i = 0; i < dishNames.length; i += RECIPE_BATCH_SIZE) {
    batches.push(dishNames.slice(i, i + RECIPE_BATCH_SIZE));
  }
  const results = await Promise.all(batches.map(generateRecipesBatch));
  return results.flat(); // [{name, recipe}, ...] in original order
}

// Best-effort dish photo via Wikipedia's free public API - no API key required.
// Coverage is good for well-known dishes (e.g. "Palak Paneer") and patchy for
// generic combos (e.g. "Cucumber Onion Salad"), which is fine: callers should
// fall back to a food emoji when this returns null.
async function fetchDishImage(name) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      name + " Indian dish"
    )}&format=json&srlimit=1&origin=*`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const title = searchData?.query?.search?.[0]?.title;
    if (!title) return null;

    const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (!summaryRes.ok) return null;
    const summaryData = await summaryRes.json();
    return summaryData?.thumbnail?.source || null;
  } catch {
    return null;
  }
}

// Builds { [originalDishName]: { serves, prep_time_min, cook_time_min, ingredients, steps, image_url } }
// keyed by the *exact* names passed in - see generateRecipesBatch for why
// this is positional rather than name-string matching.
async function buildRecipePack(dishNames) {
  const uniqueNames = [...new Set(dishNames.map((n) => n.trim()).filter(Boolean))];
  if (uniqueNames.length === 0) return {};

  const [paired, images] = await Promise.all([
    generateRecipes(uniqueNames),
    Promise.all(uniqueNames.map((n) => fetchDishImage(n))),
  ]);

  const pack = {};
  paired.forEach(({ name, recipe }, i) => {
    pack[name] = {
      serves: recipe?.serves || null,
      prep_time_min: recipe?.prep_time_min || null,
      cook_time_min: recipe?.cook_time_min || null,
      ingredients: recipe?.ingredients || [],
      steps: recipe?.steps || [],
      image_url: images[i] || null,
      available: Boolean(recipe),
    };
  });
  return pack;
}

module.exports = { buildRecipePack };
