# Calorie Tracker

A personal calorie & macro tracker you can talk to or photograph. Speak or type
what you ate, or snap a photo of your plate — Claude estimates calories,
protein, carbs, and fat, and flags oversized portions of pasta, rice, bread,
and potatoes against standard serving sizes.

## Features

- **Voice logging** — tap the mic, describe your meal, Claude parses it into food items with nutrition estimates.
- **Photo logging** — take a picture of your plate, Claude identifies the food and estimates portions and nutrition.
- **Portion checks** — pasta, rice, bread, and potato portions are compared against standard servings and flagged if oversized.
- **Daily dashboard** — running totals for calories, protein, carbs, fat, plus a history view by date.
- **Web-based** — works from a browser on your PC or phone, no app install.

## 1. Get an Anthropic API key

Create one at **https://console.anthropic.com/settings/keys**. This app uses
it server-side only — it's never exposed to the browser. Usage is billed to
your Anthropic account (typically a fraction of a cent per meal analysis).

## 2. Run it locally (optional, to try it first)

```bash
cd calorie-app
npm install
cp .env.example .env   # then paste your ANTHROPIC_API_KEY into .env
npm start
```

Open `http://localhost:3000` in your browser. To test from your phone on the
same WiFi, find your PC's local IP (`ipconfig` on Windows / `ifconfig` on
Mac) and visit `http://<that-ip>:3000` from your phone.

## 3. Deploy to Render (free, public URL reachable from anywhere)

1. Push this folder to a new GitHub repository.
2. Go to **https://render.com**, sign up/log in, click **New +** → **Blueprint**, and point it at your repo (it will pick up `render.yaml` automatically). Alternatively choose **New +** → **Web Service** and set:
   - Build command: `npm install`
   - Start command: `npm start`
3. When prompted for environment variables, add `ANTHROPIC_API_KEY` with your key.
4. Deploy. Render gives you a public URL like `https://calorie-tracker.onrender.com` — open that on your phone or PC.

**Note on data persistence:** Render's free tier uses ephemeral storage, so
the SQLite database can reset when the service redeploys or restarts after
inactivity. For a personal app this is usually fine for casual use; if you
want your log to persist permanently, upgrade the Render service to a paid
instance with a persistent disk (~$7/mo) and mount it via the `DATA_DIR`
environment variable, or swap in a hosted database like Supabase/Postgres
later.

## 4. Using it

- **Log Meal tab:** tap the mic and speak, or type directly, then "Analyze & Log." Or take/upload a photo and tap "Analyze & Log."
- **Today tab:** see today's running totals and any portion warnings (e.g. "pasta portion looks large").
- **History tab:** pick any date to see past meals and totals.

Voice input uses the browser's built-in Web Speech API, which works best in
Chrome (desktop and Android). If your browser doesn't support it, just type
into the text box instead.

## Project structure

```
calorie-app/
  server.js       # Express app + API routes
  db.js           # SQLite storage
  nutrition.js    # Claude API calls (text + photo analysis)
  portions.js     # Standard portion reference data + flagging logic
  public/         # Frontend (HTML/CSS/JS)
  render.yaml      # Render deployment config
```
