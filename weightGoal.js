// Weight goal assessment: ideal weight (BMI-based), calorie-deficit targets,
// and a Claude-generated exercise plan for weight loss.
//
// Everything except the exercise plan is pure maths — no API call needed.
// The exercise plan is generated on demand (the user taps a button).

const { getClient, extractToolResult } = require("./nutrition");
const { calculateTargets } = require("./nutritionCalc");

// --- Ideal weight (BMI method) ---

// Returns the ideal weight (BMI = 22), plus the full healthy range (18.5–24.9).
function calcIdealWeight(height_cm) {
  const hSq = (height_cm / 100) ** 2;
  return {
    ideal_kg: Math.round(22 * hSq * 10) / 10,
    lower_kg: Math.round(18.5 * hSq * 10) / 10,
    upper_kg: Math.round(24.9 * hSq * 10) / 10,
  };
}

function calcBmi(weight_kg, height_cm) {
  return Math.round((weight_kg / ((height_cm / 100) ** 2)) * 10) / 10;
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return "Underweight";
  if (bmi < 25)   return "Normal weight";
  if (bmi < 30)   return "Overweight";
  return "Obese";
}

// --- Weight-loss calorie targets ---

// Returns daily calorie / macro targets for a safe 0.5 kg/week deficit.
// Uses TDEE from the profile's bio, then:
//   • Cuts 500 kcal/day (= ~0.5 kg/week fat loss)
//   • Bumps protein to 1.6 g/kg (lean-mass preservation during a cut)
//   • Sets fat at 25% of target calories (slightly leaner than maintenance)
//   • Fills remaining calories with carbs (minimum 50 g for brain function)
function calcWeightLossTargets(bio) {
  const maintenance = calculateTargets(bio);

  // Never drop below safe minimums regardless of deficit
  const minCal = bio.sex === "female" ? 1200 : 1500;
  const calories = Math.max(Math.round(maintenance.calories - 500), minCal);

  const protein_g = Math.round(bio.weight_kg * 1.6);
  const proteinKcal = protein_g * 4;
  const fat_g = Math.round((calories * 0.25) / 9);
  const fatKcal = fat_g * 9;
  const carbs_g = Math.max(Math.round((calories - proteinKcal - fatKcal) / 4), 50);

  return {
    calories,
    protein_g,
    carbs_g,
    fat_g,
    maintenance_calories: maintenance.calories,
    daily_deficit: maintenance.calories - calories,
  };
}

// --- Claude exercise plan ---

const EXERCISE_TOOL = {
  name: "create_exercise_plan",
  description: "Create a structured weekly exercise plan personalised for weight loss.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "2-3 sentence motivating overview of the plan, tailored to this person.",
      },
      cardio: {
        type: "array",
        description: "3-4 cardio activities recommended for the week.",
        items: {
          type: "object",
          properties: {
            activity:      { type: "string" },
            duration_min:  { type: "number" },
            days_per_week: { type: "number" },
            intensity:     { type: "string", enum: ["low", "moderate", "vigorous"] },
            tip:           { type: "string", description: "One short practical tip for this activity." },
          },
          required: ["activity", "duration_min", "days_per_week", "intensity"],
        },
      },
      strength: {
        type: "array",
        description: "3-5 strength / resistance exercises (bodyweight-first unless they already exercise regularly).",
        items: {
          type: "object",
          properties: {
            exercise:      { type: "string" },
            sets:          { type: "number" },
            reps:          { type: "string", description: "e.g. '12-15' or '30 seconds'." },
            days_per_week: { type: "number" },
          },
          required: ["exercise", "sets", "reps", "days_per_week"],
        },
      },
      tips: {
        type: "array",
        description: "4-5 practical weight-loss tips specific to this person's situation (age, BMI, activity level).",
        items: { type: "string" },
      },
      est_weekly_calories_burned: {
        type: "number",
        description: "Rough estimate of extra calories burned per week from the cardio + strength plan.",
      },
    },
    required: ["summary", "cardio", "strength", "tips", "est_weekly_calories_burned"],
  },
};

async function generateExercisePlan({ weightToLose_kg, age, activity, sex, bmi }) {
  const anthropic = getClient();

  const activityLabel = {
    sedentary:   "sedentary (little to no regular exercise)",
    light:       "lightly active (exercises 1-3 days/week)",
    moderate:    "moderately active (exercises 3-5 days/week)",
    active:      "very active (exercises 6-7 days/week)",
    very_active: "extremely active (physical job + daily training)",
  }[activity] || "moderately active";

  const lossDesc = weightToLose_kg > 0
    ? `needs to lose ${weightToLose_kg} kg`
    : "is already at their ideal weight but wants to stay fit";

  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    max_tokens: 2000,
    tools: [EXERCISE_TOOL],
    tool_choice: { type: "tool", name: "create_exercise_plan" },
    messages: [{
      role: "user",
      content: `Create a practical, achievable weekly exercise plan for weight loss.

Person profile:
- Sex: ${sex}
- Age: ${age} years old
- BMI: ${bmi} (${bmiCategory(bmi)})
- Weight goal: ${lossDesc}
- Current activity: ${activityLabel}

Guidelines:
- Prioritise walking, home bodyweight exercises, and activities that don't require a gym unless the activity level suggests they already have a routine.
- Be realistic — a sedentary person should start gently; an already-active person can handle more intensity.
- Indian context: include yoga or dance as options if appropriate.
- Keep the tone encouraging and practical.`,
    }],
  });

  return extractToolResult(msg, "create_exercise_plan");
}

module.exports = { calcIdealWeight, calcBmi, bmiCategory, calcWeightLossTargets, generateExercisePlan };
