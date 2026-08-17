// Mifflin-St Jeor BMR/TDEE calculation with a general-purpose macro split.
// This is a standard estimate for healthy adults, not medical advice - the
// frontend surfaces that caveat and always lets the person review/edit the
// suggested numbers before saving them as their actual target.

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2, // little/no exercise
  light: 1.375, // light exercise 1-3 days/week
  moderate: 1.55, // moderate exercise 3-5 days/week
  active: 1.725, // hard exercise 6-7 days/week
  very_active: 1.9, // physical job + daily training
};

function calculateTargets({ age, sex, weight_kg, height_cm, activity }) {
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  const bmr = sex === "male" ? base + 5 : base - 161;

  const multiplier = ACTIVITY_MULTIPLIERS[activity] || ACTIVITY_MULTIPLIERS.light;
  const tdee = bmr * multiplier;

  // Protein by body weight (general-purpose default, not athlete-specific);
  // fat as a percentage of total calories; carbs fill the remainder.
  const proteinG = weight_kg * 1.2;
  const proteinKcal = proteinG * 4;
  const fatKcal = tdee * 0.27;
  const fatG = fatKcal / 9;
  const carbsKcal = Math.max(tdee - proteinKcal - fatKcal, 0);
  const carbsG = carbsKcal / 4;

  return {
    calories: Math.round(tdee),
    protein_g: Math.round(proteinG),
    carbs_g: Math.round(carbsG),
    fat_g: Math.round(fatG),
    bmr: Math.round(bmr),
  };
}

module.exports = { calculateTargets, ACTIVITY_MULTIPLIERS };
