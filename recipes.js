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
calorie tracking app. You will be given a list of dish names pulled from a meal plan. For EACH dish, write a simple,
realistic recipe a home cook could actually follow: ingredients with practical quantities (sized for the given
"serves" count, default 2), and clear numbered steps. Keep it practical for a typical Indian home kitchen (stovetop,
pressure cooker, kadai/tawa) - no professional techniques or hard-to-find ingredients. Use the exact dish name given,
copied verbatim, for each recipe's "name" field so it can be matched back up. Always call the generate_recipes tool
with one entry per dish name given - do not skip any.`;

async function generateRecipesBatch(dishNames) {
  const anthropic = getClient();
  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [RECIPE_TOOL],
    tool_choice: { type: "tool", name: "generate_recipes" },
    messages: [
      {
        role: "user",
        content: `Write recipes for these dishes:\n${dishNames.map((n) => `- ${n}`).join("\n")}`,
      },
    ],
  });
  return extractToolResult(msg, "generate_recipes").recipes || [];
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
  return results.flat();
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

function normalize(name) {
  return String(name || "").trim().toLowerCase();
}

// Builds { [originalDishName]: { serves, prep_time_min, cook_time_min, ingredients, steps, image_url } }
// keyed by the *exact* names passed in, regardless of casing Claude echoes back.
async function buildRecipePack(dishNames) {
  const uniqueNames = [...new Set(dishNames.map((n) => n.trim()).filter(Boolean))];
  if (uniqueNames.length === 0) return {};

  const [recipeList, images] = await Promise.all([
    generateRecipes(uniqueNames),
    Promise.all(uniqueNames.map((n) => fetchDishImage(n))),
  ]);

  const byNormalizedName = new Map(recipeList.map((r) => [normalize(r.name), r]));
  const imageByName = new Map(uniqueNames.map((n, i) => [n, images[i]]));

  const pack = {};
  for (const name of uniqueNames) {
    const recipe = byNormalizedName.get(normalize(name));
    pack[name] = {
      serves: recipe?.serves || null,
      prep_time_min: recipe?.prep_time_min || null,
      cook_time_min: recipe?.cook_time_min || null,
      ingredients: recipe?.ingredients || [],
      steps: recipe?.steps || [],
      image_url: imageByName.get(name) || null,
      available: Boolean(recipe),
    };
  }
  return pack;
}

module.exports = { buildRecipePack };
