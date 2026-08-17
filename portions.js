// Reference portion sizes for common carb-heavy foods people tend to over-serve.
// Grams are for the COOKED food. Used to flag when an estimated portion is
// meaningfully above or below a standard single serving.
const REFERENCE_PORTIONS = [
  { keywords: ["pasta", "spaghetti", "noodle", "penne", "macaroni", "fettuccine", "linguine"], label: "pasta", standard_grams: 140, note: "~140g cooked (about 3/4 to 1 cup) is a standard serving" },
  { keywords: ["rice", "biryani", "pulao", "fried rice"], label: "rice", standard_grams: 150, note: "~150g cooked (about 3/4 cup) is a standard serving" },
  { keywords: ["bread", "toast", "roti", "chapati", "naan", "paratha"], label: "bread/flatbread", standard_grams: 60, note: "~1-2 slices of bread or 1 medium roti/naan" },
  { keywords: ["potato", "fries", "mash"], label: "potato", standard_grams: 150, note: "~150g (1 medium potato) is a standard serving" },
  { keywords: ["quinoa", "couscous", "barley", "oats", "oatmeal"], label: "grain", standard_grams: 150, note: "~150g cooked is a standard serving" },
];

// Given a food item name and its estimated grams, return a portion flag if it
// matches a tracked carb food and deviates from the standard serving.
function flagPortion(name, grams) {
  if (!name || !grams) return null;
  const lower = name.toLowerCase();
  const ref = REFERENCE_PORTIONS.find((r) => r.keywords.some((k) => lower.includes(k)));
  if (!ref) return null;

  const ratio = grams / ref.standard_grams;
  let status = "on_target";
  if (ratio >= 1.5) status = "over";
  else if (ratio <= 0.6) status = "under";

  return {
    food: ref.label,
    estimated_grams: grams,
    standard_grams: ref.standard_grams,
    ratio: Math.round(ratio * 100) / 100,
    status,
    note: ref.note,
  };
}

module.exports = { REFERENCE_PORTIONS, flagPortion };
