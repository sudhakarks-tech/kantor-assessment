# Behavioral Propensity Assessment

A web application that conducts adaptive behavioral assessments inspired by structural dynamics theory, generating personalized PDF reports and an organizational team dashboard.

## What It Does

- **25–30 adaptive questions** driven by Claude — dynamically branches based on each response
- **Three dimensions assessed**: Action Mode, Operating Style, Communication Focus
- **Dual-context profiling**: work and personal/home settings analyzed separately
- **Calculated vs. self-reported comparison**: surfaces blind spots and gaps
- **Auto-generated PDF report** with propensity charts, profile name, talents/traps/tips, and development zones
- **Team dashboard** for org administrators to view all completions

## Setup

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd kantor-assessment
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...your-key-here...
PORT=3000
DASHBOARD_PASSWORD=choose-a-password
```

Get your API key at: https://console.anthropic.com

### 3. Run Locally

```bash
npm start
```

Or with auto-reload during development:
```bash
npm run dev
```

Open:
- **Assessment**: http://localhost:3000
- **Dashboard**: http://localhost:3000/dashboard.html

---

## Deployment (GitHub + Render)

This is a Node.js app — it cannot run on GitHub Pages (which is static-only). Use **Render** (free tier) or **Railway** instead.

### Deploy to Render (Recommended)

1. Push your code to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Add `ANTHROPIC_API_KEY` and `PORT=10000`
5. Click Deploy

Your app will be live at `https://your-app.onrender.com`

### Deploy to Railway

1. Install Railway CLI: `npm install -g @railway/cli`
2. `railway login`
3. `railway init` in the project folder
4. `railway up`
5. Add `ANTHROPIC_API_KEY` in the Railway dashboard under Variables

---

## File Structure

```
kantor-assessment/
├── server.js              # Express server, Claude system prompt, PDF generation
├── package.json
├── .env.example
├── data/
│   └── sessions.json      # Assessment results (persisted)
└── public/
    ├── index.html         # Assessment interface
    ├── dashboard.html     # Admin team view
    ├── css/
    │   └── style.css
    └── js/
        └── app.js         # Frontend logic
```

---

## The System Prompt

The Claude system prompt lives in `server.js` (the `SYSTEM_PROMPT` constant). It defines:

- The three behavioral dimensions and their sub-propensities
- Assessment methodology (phases, question count, context split)
- Conduct rules (one question at a time, no labeling options, warm tone)
- Internal scoring logic Claude tracks throughout
- Dynamic branching rules
- Exact JSON output format with zone classification

To tune the assessment:
- Adjust question count: change the branching rules and the total count guidance in the prompt
- Change zone thresholds: edit the zone classification comment at the bottom of the prompt
- Modify output fields: update both the JSON schema in the prompt and `buildPDF()` in server.js

---

## Data & Privacy

Assessment results are stored in `data/sessions.json`. In production:
- Replace with a proper database (PostgreSQL, MongoDB, etc.) for scale
- Add authentication to the dashboard route
- Consider GDPR/data retention policies for employee assessments

---

## Customization

**Branding**: Update colors in `public/css/style.css` (look for `#1E40AF` — the primary blue)

**Organization name**: Edit the header in `public/index.html` and `public/dashboard.html`

**Question count**: Change `const TOTAL_QUESTIONS = 28` in `public/js/app.js` (just affects the progress bar)

**Dimension names**: The app uses Initiate/Support/Challenge/Observe terminology. These can be changed in the system prompt and PDF generator if you prefer different labels.
