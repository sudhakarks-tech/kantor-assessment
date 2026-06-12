require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Data Layer ───────────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data', 'sessions.json');

function loadSessions() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSession(session) {
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === session.id);
  if (idx >= 0) sessions[idx] = session;
  else sessions.push(session);
  fs.writeFileSync(DATA_FILE, JSON.stringify(sessions, null, 2));
}

// ─── Active session store (conversation history in memory) ────────────────────
const activeSessions = new Map();

// ─── System Prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert behavioral assessment facilitator specializing in structural dynamics. Your task is to conduct a rigorous, adaptive behavioral propensity assessment. You will surface a person's natural behavioral tendencies across three dimensions through carefully designed scenario-based questions.

═══════════════════════════════════════════════════════════
THE THREE DIMENSIONS
═══════════════════════════════════════════════════════════

DIMENSION 1 — ACTION MODE
How a person typically engages in group conversations. Every person has a natural default:

• INITIATE — Proposes new directions; is often first to suggest an idea or course of action; starts things in motion. The initiator sets the agenda.
• SUPPORT — Gets behind others' ideas; helps carry proposals forward to completion; enables others to succeed. The supporter finishes things.
• CHALLENGE — Questions assumptions; pushes back on proposals; identifies weaknesses and offers alternatives. The challenger corrects direction.
• OBSERVE — Steps back to watch the dynamics; synthesizes disparate views; offers neutral perspective; helps connect ideas. The observer bridges gaps.

DIMENSION 2 — OPERATING STYLE
The implicit rules a person follows when engaging with others:

• STRUCTURED — Values hierarchy, clear roles, defined processes, rules, and tradition. Provides clarity about responsibilities. Expects everyone to follow the agreed system.
• COLLABORATIVE — Values consensus, participation, and inclusion. Looks for ways to involve others. Believes every voice has a contribution. Drives toward shared agreement.
• CREATIVE — Values autonomy, experimentation, and individuality. Operates with minimal rules. Wants freedom to act in unique, unconventional ways.

DIMENSION 3 — COMMUNICATION FOCUS
What a person naturally attends to in conversations:

• RELATIONAL — Focuses on emotional connection, trust, wellbeing, and the relationships between people. Speaks the language of feelings and human impact.
• CONCEPTUAL — Focuses on ideas, logic, meaning, and purpose. Loves understanding how things work at a deep level. Speaks the language of thinking.
• RESULTS-DRIVEN — Focuses on outcomes, accountability, timelines, and completion. Speaks the language of goals and doing.

═══════════════════════════════════════════════════════════
ASSESSMENT METHODOLOGY
═══════════════════════════════════════════════════════════

You will conduct a 25–30 question adaptive assessment across three phases:

PHASE 1 — WORK CONTEXT (~14 questions)
Scenario-based questions set in professional/team situations. Each question presents a realistic scenario with 3–4 behaviorally distinct response options. Cover: team meetings, conflict, decision-making, project planning, receiving feedback, high-stakes moments, and leadership situations.

PHASE 2 — PERSONAL CONTEXT (~10 questions)
Same approach but in family/personal life settings. Cover: relationship conflict, family planning, social gatherings, personal decisions under pressure, and close relationships.

PHASE 3 — SELF-REPORT (~5–6 questions)
Ask the person to directly estimate the percentage of time they spend in each mode. These become the "self-reported" scores, which you compare against the "calculated" scores from Phases 1 & 2. Ask these after approximately Q18, never at the start.

═══════════════════════════════════════════════════════════
CONDUCT RULES
═══════════════════════════════════════════════════════════

1. Ask ONE question at a time. Never combine two questions in one message.
2. Label each question clearly: Q1, Q2, Q3, etc.
3. Briefly acknowledge the user's response in ONE sentence before moving to the next question. Make the acknowledgement neutral and non-revealing (never say "great answer" or hint at what their choice signals).
4. NEVER label options with dimension names (never say "this is an Initiate response").
5. Options should be labeled A, B, C, D. They should never have an obviously "right" answer.
6. Maintain a warm, curious, professional tone throughout.
7. When asking about percentages in self-report questions, remind them the numbers must add up to 100%.

═══════════════════════════════════════════════════════════
INTERNAL SCORING (track this privately — never reveal scores mid-assessment)
═══════════════════════════════════════════════════════════

As you go, assign points to propensities based on which option is chosen. Use this mapping per question:

For ACTION MODE questions:
- The option that best reflects Initiate gets 3 points to Initiate
- The option that best reflects Support gets 3 points to Support
- The option that best reflects Challenge gets 3 points to Challenge
- The option that best reflects Observe gets 3 points to Observe
(Some responses may split points e.g. 2+1 across two propensities if the option is genuinely ambiguous)

For OPERATING STYLE questions:
- Structured option → 3 points to Structured
- Collaborative option → 3 points to Collaborative
- Creative option → 3 points to Creative

For COMMUNICATION FOCUS questions:
- Relational option → 3 points to Relational
- Conceptual option → 3 points to Conceptual
- Results-Driven option → 3 points to Results-Driven

Track separately:
- Work-context scores (from Phase 1 questions only)
- Personal-context scores (from Phase 2 questions only)
- Overall calculated scores (all scenario questions combined)
- Self-reported scores (from Phase 3 direct ratings)

At the end, normalize each dimension to percentages summing to 100.

═══════════════════════════════════════════════════════════
DYNAMIC BRANCHING RULES
═══════════════════════════════════════════════════════════

After Q6–8 (work context), review your running scores:

- If one ACTION MODE propensity is already >40% of your running total, ask a HIGH-STAKES variation of a scenario to confirm whether this holds under pressure (e.g., a crisis situation, a major disagreement with a superior).
- If OPERATING STYLE is tightly split between Structured and Creative, ask a conflict scenario where these two styles would clash head-on.
- If work and personal Operating Styles appear to diverge significantly, explicitly probe this: ask how the person explains the difference between how they operate at work versus at home.
- If any propensity appears near zero across 5+ questions, include a question designed to test whether it's truly absent, or just situationally suppressed.
- If responses seem contradictory, ask a clarifying scenario before drawing conclusions.

═══════════════════════════════════════════════════════════
EXAMPLE QUESTION STYLES (use as calibration — generate your own, do not copy verbatim)
═══════════════════════════════════════════════════════════

Work / Action Mode example:
"Q3. Your team has been debating a decision for over an hour without resolution. What do you most naturally find yourself doing?
A. Stepping in to name a direction and push the group to commit to it
B. Identifying which option has the most support and helping the group get behind it
C. Laying out clearly why the options on the table won't work and what's being missed
D. Observing what's really going on beneath the surface and helping the group see its own dynamic"

Work / Operating Style example:
"Q7. A new team member keeps bypassing the agreed process and improvising their own approach. How do you respond?
A. Address it directly — you believe agreed processes exist for good reasons and need to be followed
B. Have a conversation to understand their perspective and find common ground
C. Appreciate the creative energy, even if it creates some friction"

Personal / Communication Focus example:
"Q19. After a difficult conversation with someone close to you, what tends to stay with you longest?
A. Whether they're okay and whether the relationship is intact
B. Whether you really understood each other and what it all means
C. Whether anything was actually decided or resolved"

Self-Report example:
"Q24. Now I'd like you to step back and estimate your own behavior. In your work conversations, roughly what percentage of the time do you think you spend in each of these modes? Please give me four numbers that add up to 100:
- Starting/proposing directions: ___%
- Supporting and advancing others' ideas: ___%
- Questioning and challenging proposals: ___%
- Observing and synthesizing: ___%"

═══════════════════════════════════════════════════════════
COMPLETION
═══════════════════════════════════════════════════════════

After approximately 25–30 questions, write a brief warm closing statement (2–3 sentences), then on a new line write exactly:

ASSESSMENT COMPLETE

Then immediately output a JSON block with no additional text after it:

\`\`\`json
{
  "name": "[user's name from their introduction]",
  "scores": {
    "action": {
      "calculated": { "initiate": 0, "support": 0, "challenge": 0, "observe": 0 },
      "selfReported": { "initiate": 0, "support": 0, "challenge": 0, "observe": 0 }
    },
    "operating": {
      "calculated": { "structured": 0, "collaborative": 0, "creative": 0 },
      "selfReported": { "structured": 0, "collaborative": 0, "creative": 0 }
    },
    "communication": {
      "calculated": { "relational": 0, "conceptual": 0, "results": 0 },
      "selfReported": { "relational": 0, "conceptual": 0, "results": 0 }
    }
  },
  "workProfile": {
    "action": { "initiate": 0, "support": 0, "challenge": 0, "observe": 0 },
    "operating": { "structured": 0, "collaborative": 0, "creative": 0 },
    "communication": { "relational": 0, "conceptual": 0, "results": 0 }
  },
  "personalProfile": {
    "action": { "initiate": 0, "support": 0, "challenge": 0, "observe": 0 },
    "operating": { "structured": 0, "collaborative": 0, "creative": 0 },
    "communication": { "relational": 0, "conceptual": 0, "results": 0 }
  },
  "dominantProfile": {
    "action": "",
    "operating": "",
    "communication": ""
  },
  "profileName": "",
  "insights": {
    "talents": ["", "", ""],
    "traps": ["", "", ""],
    "tips": ["", "", ""]
  },
  "gapAnalysis": {
    "action": "",
    "operating": "",
    "communication": ""
  },
  "unstuckZones": {
    "action": { "initiate": "", "support": "", "challenge": "", "observe": "" },
    "operating": { "structured": "", "collaborative": "", "creative": "" },
    "communication": { "relational": "", "conceptual": "", "results": "" }
  }
}
\`\`\`

SCORING REQUIREMENTS:
- All percentages within each sub-dimension must sum to exactly 100
- dominantProfile fields = the highest-scoring key in each calculated dimension
- profileName format: "[Action] in [Operating] [Communication]" e.g. "Challenge in Collaborative Conceptual"
- Zone classification rules: weak = <20%, strong = 20–39%, overuse = 40–50%, stuck = >50%
- insights.talents: 3 genuine strengths of this specific profile combination
- insights.traps: 3 real behavioral pitfalls this combination tends to fall into
- insights.tips: 3 specific, actionable development suggestions for this profile
- gapAnalysis: for each dimension, one sentence describing the gap between self-reported and calculated scores and what it might indicate
- If self-report questions were not asked or answered clearly, set selfReported to match calculated`;

// ─── Routes ───────────────────────────────────────────────────────────────────

// Start new assessment session
app.post('/api/start', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const sessionId = uuidv4();
    const userMessage = `My name is ${name}. I'm ready to begin the behavioral assessment.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    const assistantText = response.content[0].text;

    activeSessions.set(sessionId, {
      id: sessionId,
      name,
      email,
      startedAt: new Date().toISOString(),
      questionCount: 0,
      messages: [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: assistantText }
      ]
    });

    res.json({ sessionId, message: assistantText });
  } catch (err) {
    console.error('Error starting session:', err);
    res.status(500).json({ error: 'Failed to start assessment. Check your API key.' });
  }
});

// Send user response, get next question
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    const session = activeSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found or expired.' });
    }

    session.messages.push({ role: 'user', content: message });
    session.questionCount += 1;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: session.messages
    });

    const assistantText = response.content[0].text;
    session.messages.push({ role: 'assistant', content: assistantText });

    // Detect completion
    const isComplete = assistantText.includes('ASSESSMENT COMPLETE');
    let scores = null;

    if (isComplete) {
      const jsonMatch = assistantText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          scores = JSON.parse(jsonMatch[1]);
          const completedSession = {
            id: sessionId,
            name: session.name,
            email: session.email,
            startedAt: session.startedAt,
            completedAt: new Date().toISOString(),
            questionCount: session.questionCount,
            scores
          };
          saveSession(completedSession);
          activeSessions.delete(sessionId);
        } catch (parseErr) {
          console.error('Failed to parse assessment JSON:', parseErr);
        }
      }
    }

    // Extract clean message (without JSON block for display)
    const displayMessage = assistantText
      .replace(/ASSESSMENT COMPLETE[\s\S]*/, '')
      .trim();

    res.json({
      message: isComplete ? displayMessage || 'Your assessment is complete! Generating your report...' : assistantText,
      isComplete,
      scores,
      sessionId,
      questionCount: session.questionCount
    });
  } catch (err) {
    console.error('Error in chat:', err);
    res.status(500).json({ error: 'Failed to process your response.' });
  }
});

// ─── PDF Report Generation ────────────────────────────────────────────────────

app.get('/api/report/:sessionId', (req, res) => {
  const sessions = loadSessions();
  const session = sessions.find(s => s.id === req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Assessment not found.' });
  }

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const filename = `behavioral-profile-${session.name.replace(/\s+/g, '-')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  buildPDF(doc, session);
  doc.end();
});

function buildPDF(doc, session) {
  const s = session.scores;
  const C = {
    blue: '#1E40AF',
    lightBlue: '#3B82F6',
    red: '#DC2626',
    dark: '#111827',
    mid: '#374151',
    gray: '#6B7280',
    lightGray: '#F9FAFB',
    initiate: '#3B82F6',
    support: '#10B981',
    challenge: '#EF4444',
    observe: '#8B5CF6',
    structured: '#6B7280',
    collaborative: '#3B82F6',
    creative: '#F59E0B',
    relational: '#EC4899',
    conceptual: '#6366F1',
    results: '#F97316'
  };

  const PAGE_W = doc.page.width;
  const MARGIN = 50;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  // ── Helper: stacked horizontal bar ──────────────────────────────────────────
  function stackedBar(x, y, dataObj, colorMap, barH = 26) {
    const total = Object.values(dataObj).reduce((a, b) => a + b, 0) || 100;
    let xPos = x;
    Object.entries(dataObj).forEach(([key, val]) => {
      const w = Math.max((val / total) * CONTENT_W, val > 0 ? 1 : 0);
      doc.rect(xPos, y, w, barH).fill(colorMap[key] || '#999');
      if (w > 28) {
        doc.fontSize(9).fillColor('white')
          .text(`${val}%`, xPos + 4, y + (barH - 9) / 2, { width: w - 8, align: 'left' });
      }
      xPos += w;
    });
    return y + barH;
  }

  // ── Helper: legend ───────────────────────────────────────────────────────────
  function legend(x, y, dataObj, colorMap) {
    const keys = Object.keys(dataObj);
    const cols = Math.min(keys.length, 4);
    const colW = CONTENT_W / cols;
    keys.forEach((key, i) => {
      const lx = x + (i % cols) * colW;
      const ly = y + Math.floor(i / cols) * 16;
      doc.rect(lx, ly + 2, 10, 10).fill(colorMap[key] || '#999');
      doc.fontSize(9).fillColor(C.mid)
        .text(`${cap(key)}: ${dataObj[key]}%`, lx + 14, ly, { width: colW - 16 });
    });
    return y + Math.ceil(keys.length / cols) * 16 + 6;
  }

  function cap(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  function sectionHeader(title, color = C.blue) {
    doc.rect(MARGIN, doc.y, CONTENT_W, 2).fill(color);
    doc.moveDown(0.4);
    doc.fontSize(18).fillColor(color).text(title, MARGIN);
    doc.moveDown(0.3);
  }

  function zoneColor(zone) {
    const map = { weak: '#9CA3AF', strong: '#3B82F6', overuse: '#F59E0B', stuck: '#EF4444' };
    return map[zone] || '#3B82F6';
  }

  // ════════════════════════════════════════════════════════════
  // PAGE 1: Cover
  // ════════════════════════════════════════════════════════════
  doc.rect(0, 0, PAGE_W, 220).fill(C.blue);

  doc.fontSize(32).fillColor('white')
    .text('Behavioral Propensity', MARGIN, 55, { width: CONTENT_W });
  doc.fontSize(32).fillColor('white')
    .text('Profile', MARGIN, 93, { width: CONTENT_W });

  doc.fontSize(13).fillColor('rgba(255,255,255,0.8)')
    .text('Structural Dynamics Assessment', MARGIN, 140);

  doc.rect(MARGIN, 165, 200, 1).fill('rgba(255,255,255,0.4)');

  doc.fontSize(12).fillColor('white')
    .text(`Name: ${session.name}`, MARGIN, 178);
  doc.fontSize(12).fillColor('white')
    .text(`Date: ${new Date(session.completedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, MARGIN, 196);

  // Profile name badge
  const pName = s.profileName || 'Unknown Profile';
  doc.rect(MARGIN, 240, CONTENT_W, 60).fill('#F1F5F9').stroke('#E2E8F0');
  doc.fontSize(11).fillColor(C.gray).text('YOUR BASELINE PROFILE', MARGIN + 16, 252);
  doc.fontSize(20).fillColor(C.red).text(pName.toUpperCase(), MARGIN + 16, 266, { width: CONTENT_W - 32 });

  doc.moveDown(4);

  // Intro text
  doc.fontSize(11).fillColor(C.mid).text(
    'This report surfaces your natural behavioral tendencies across three dimensions: how you engage in group conversations (Action Mode), the implicit rules you follow when interacting with others (Operating Style), and what you naturally focus on in conversation (Communication Focus). These patterns were shaped over time and represent your most comfortable default ways of engaging with others — both at work and in personal life.',
    MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 }
  );

  doc.moveDown(1.2);
  doc.fontSize(11).fillColor(C.mid).text(
    'Understanding your profile helps you expand your behavioral range — engaging more effectively with people who differ from you, and choosing your approach deliberately rather than by default.',
    MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 }
  );

  // ════════════════════════════════════════════════════════════
  // PAGE 2: Action Mode
  // ════════════════════════════════════════════════════════════
  doc.addPage();
  sectionHeader('ACTION MODE');

  const actionDom = s.dominantProfile?.action || 'unknown';
  doc.fontSize(13).fillColor(C.dark)
    .text(`Strongest Propensity: ${cap(actionDom)}`, MARGIN);
  doc.moveDown(0.4);

  const actionDesc = {
    initiate: 'You are often the first to propose a direction or introduce a new idea. You set conversations in motion and push for forward momentum. Others rely on you to break deadlocks and open new possibilities.',
    support: 'You excel at getting behind others\' ideas and ensuring they succeed. You listen for what has potential and then help carry it to completion. Teams feel supported and heard when you are in the room.',
    challenge: 'You push back on proposals, surface weaknesses, and offer alternatives. You are relentless in your search for the best answer, and others value your willingness to say what no one else will.',
    observe: 'You watch, synthesize, and help others see what they are missing. You notice the dynamics beneath the surface and offer perspective that bridges seemingly incompatible views.'
  };

  doc.fontSize(11).fillColor(C.gray)
    .text(actionDesc[actionDom] || '', MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 });
  doc.moveDown(1.2);

  doc.fontSize(12).fillColor(C.dark).text('Center of Gravity', MARGIN);
  doc.moveDown(0.4);

  const actionColorMap = { initiate: C.initiate, support: C.support, challenge: C.challenge, observe: C.observe };
  const aCalc = s.scores?.action?.calculated || {};
  const aSelf = s.scores?.action?.selfReported || {};

  doc.fontSize(10).fillColor(C.gray).text('Calculated from your responses:', MARGIN);
  doc.moveDown(0.3);
  let y = stackedBar(MARGIN, doc.y, aCalc, actionColorMap);
  doc.y = y + 4;
  y = legend(MARGIN, doc.y, aCalc, actionColorMap);
  doc.y = y + 12;

  doc.fontSize(10).fillColor(C.gray).text('Self-reported (how you estimated your own behavior):', MARGIN);
  doc.moveDown(0.3);
  y = stackedBar(MARGIN, doc.y, aSelf, actionColorMap);
  doc.y = y + 4;
  y = legend(MARGIN, doc.y, aSelf, actionColorMap);
  doc.y = y + 14;

  if (s.gapAnalysis?.action) {
    doc.rect(MARGIN, doc.y, CONTENT_W, 0.5).fill('#E5E7EB');
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor(C.blue).text('To consider:', MARGIN);
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor(C.mid)
      .text(s.gapAnalysis.action, MARGIN, doc.y, { width: CONTENT_W, lineGap: 3 });
  }

  // ════════════════════════════════════════════════════════════
  // PAGE 3: Operating Style
  // ════════════════════════════════════════════════════════════
  doc.addPage();
  sectionHeader('OPERATING STYLE');

  const opDom = s.dominantProfile?.operating || 'unknown';
  doc.fontSize(13).fillColor(C.dark)
    .text(`Strongest Propensity: ${cap(opDom)}`, MARGIN);
  doc.moveDown(0.4);

  const opDesc = {
    structured: 'You emphasize structure, planning, and clarity. You provide others with clear roles and responsibilities and work best within defined systems. You expect everyone to follow agreed processes.',
    collaborative: 'You emphasize process, participation, and inclusion. You look for ways to involve everyone and place a high value on consensus. You believe the best decisions are made together.',
    creative: 'You operate with flexibility and minimal rules. You emphasize autonomy, creative expression, and individuality. You want the freedom to work in your own way and resist rigid conventions.'
  };

  doc.fontSize(11).fillColor(C.gray)
    .text(opDesc[opDom] || '', MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 });
  doc.moveDown(1.2);

  doc.fontSize(12).fillColor(C.dark).text('Center of Gravity', MARGIN);
  doc.moveDown(0.4);

  const opColorMap = { structured: C.structured, collaborative: C.collaborative, creative: C.creative };
  const oCalc = s.scores?.operating?.calculated || {};
  const oSelf = s.scores?.operating?.selfReported || {};

  doc.fontSize(10).fillColor(C.gray).text('Calculated from your responses:', MARGIN);
  doc.moveDown(0.3);
  y = stackedBar(MARGIN, doc.y, oCalc, opColorMap);
  doc.y = y + 4;
  y = legend(MARGIN, doc.y, oCalc, opColorMap);
  doc.y = y + 12;

  doc.fontSize(10).fillColor(C.gray).text('Self-reported:', MARGIN);
  doc.moveDown(0.3);
  y = stackedBar(MARGIN, doc.y, oSelf, opColorMap);
  doc.y = y + 4;
  y = legend(MARGIN, doc.y, oSelf, opColorMap);
  doc.y = y + 14;

  doc.fontSize(11).fillColor(C.gray).text(
    'Operating Style is typically the strongest and most consistent propensity. Most people have one dominant style, a secondary, and one they actively resist. Teams experience the most friction when leaders impose their Operating Style on others whose preference differs.',
    MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 }
  );

  if (s.gapAnalysis?.operating) {
    doc.moveDown(0.8);
    doc.rect(MARGIN, doc.y, CONTENT_W, 0.5).fill('#E5E7EB');
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor(C.blue).text('To consider:', MARGIN);
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor(C.mid)
      .text(s.gapAnalysis.operating, MARGIN, doc.y, { width: CONTENT_W, lineGap: 3 });
  }

  // ════════════════════════════════════════════════════════════
  // PAGE 4: Communication Focus
  // ════════════════════════════════════════════════════════════
  doc.addPage();
  sectionHeader('COMMUNICATION FOCUS');

  const commDom = s.dominantProfile?.communication || 'unknown';
  doc.fontSize(13).fillColor(C.dark)
    .text(`Strongest Propensity: ${cap(commDom)}`, MARGIN);
  doc.moveDown(0.4);

  const commDesc = {
    relational: 'You focus on emotional connection, trust, and the wellbeing of others. You take special note of how people are feeling and how they are reacting. You speak the language of relationship and care.',
    conceptual: 'You focus on ideas, logic, meaning, and purpose. You love exploring theoretical depth and understanding how things work. You speak the language of thinking and reasoning.',
    results: 'You focus on outcomes, accountability, and completion. You are oriented toward goals, timelines, and crossing things off the list. You speak the language of action and accomplishment.'
  };

  doc.fontSize(11).fillColor(C.gray)
    .text(commDesc[commDom] || '', MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 });
  doc.moveDown(1.2);

  doc.fontSize(12).fillColor(C.dark).text('Center of Gravity', MARGIN);
  doc.moveDown(0.4);

  const commColorMap = { relational: C.relational, conceptual: C.conceptual, results: C.results };
  const cCalc = s.scores?.communication?.calculated || {};
  const cSelf = s.scores?.communication?.selfReported || {};

  doc.fontSize(10).fillColor(C.gray).text('Calculated from your responses:', MARGIN);
  doc.moveDown(0.3);
  y = stackedBar(MARGIN, doc.y, cCalc, commColorMap);
  doc.y = y + 4;
  y = legend(MARGIN, doc.y, cCalc, commColorMap);
  doc.y = y + 12;

  doc.fontSize(10).fillColor(C.gray).text('Self-reported:', MARGIN);
  doc.moveDown(0.3);
  y = stackedBar(MARGIN, doc.y, cSelf, commColorMap);
  doc.y = y + 4;
  y = legend(MARGIN, doc.y, cSelf, commColorMap);
  doc.y = y + 14;

  doc.fontSize(11).fillColor(C.gray).text(
    'Expanding your range in Communication Focus is one of the fastest ways to increase your effectiveness. When you recognize that a colleague is speaking a different language — relational while you are results-focused, for example — you can consciously shift to meet them where they are.',
    MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 }
  );

  if (s.gapAnalysis?.communication) {
    doc.moveDown(0.8);
    doc.rect(MARGIN, doc.y, CONTENT_W, 0.5).fill('#E5E7EB');
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor(C.blue).text('To consider:', MARGIN);
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor(C.mid)
      .text(s.gapAnalysis.communication, MARGIN, doc.y, { width: CONTENT_W, lineGap: 3 });
  }

  // ════════════════════════════════════════════════════════════
  // PAGE 5: Profile + Insights
  // ════════════════════════════════════════════════════════════
  doc.addPage();
  sectionHeader('YOUR BEHAVIORAL PROFILE');

  doc.fontSize(22).fillColor(C.red).text((s.profileName || '').toUpperCase(), MARGIN);
  doc.moveDown(0.5);

  doc.fontSize(11).fillColor(C.mid).text(
    'The combination of your strongest Action, Operating, and Communication propensities creates your baseline Behavioral Profile. This profile describes how you tend to behave when you are free to act as yourself — both at work and at home. Each profile has characteristic strengths, recurring pitfalls, and specific opportunities for growth.',
    MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 }
  );

  doc.moveDown(1);

  // Three columns: Talents / Traps / Tips
  const colW3 = (CONTENT_W - 20) / 3;
  const col1 = MARGIN;
  const col2 = MARGIN + colW3 + 10;
  const col3 = MARGIN + colW3 * 2 + 20;
  const topY = doc.y;

  const talentColor = '#059669';
  const trapColor = '#DC2626';
  const tipColor = '#2563EB';

  doc.fontSize(12).fillColor(talentColor).text('Talents', col1, topY, { width: colW3 });
  doc.fontSize(12).fillColor(trapColor).text('Traps', col2, topY, { width: colW3 });
  doc.fontSize(12).fillColor(tipColor).text('Tips for Growth', col3, topY, { width: colW3 });

  const rowStart = topY + 20;
  const talents = s.insights?.talents || [];
  const traps = s.insights?.traps || [];
  const tips = s.insights?.tips || [];
  const maxItems = Math.max(talents.length, traps.length, tips.length);

  let rowY = rowStart;
  for (let i = 0; i < maxItems; i++) {
    const t1 = talents[i] ? `• ${talents[i]}` : '';
    const t2 = traps[i] ? `• ${traps[i]}` : '';
    const t3 = tips[i] ? `• ${tips[i]}` : '';

    const h1 = t1 ? doc.heightOfString(t1, { width: colW3 - 4 }) + 8 : 0;
    const h2 = t2 ? doc.heightOfString(t2, { width: colW3 - 4 }) + 8 : 0;
    const h3 = t3 ? doc.heightOfString(t3, { width: colW3 - 4 }) + 8 : 0;
    const rowH = Math.max(h1, h2, h3);

    if (t1) doc.fontSize(10).fillColor(C.mid).text(t1, col1, rowY, { width: colW3 - 4, lineGap: 3 });
    if (t2) doc.fontSize(10).fillColor(C.mid).text(t2, col2, rowY, { width: colW3 - 4, lineGap: 3 });
    if (t3) doc.fontSize(10).fillColor(C.mid).text(t3, col3, rowY, { width: colW3 - 4, lineGap: 3 });

    rowY += rowH;
  }

  doc.y = rowY + 10;

  // ════════════════════════════════════════════════════════════
  // PAGE 6: Getting Unstuck
  // ════════════════════════════════════════════════════════════
  doc.addPage();
  sectionHeader('GETTING UNSTUCK');

  doc.fontSize(11).fillColor(C.mid).text(
    'The zones below map your propensities into four categories. Propensities in the Stuck zone are so dominant that others can predict and may discount them. Propensities in the Weak zone are rarely used and can represent a significant opportunity for growth.',
    MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 }
  );
  doc.moveDown(0.6);

  // Zone legend
  const zones = [
    { label: 'Weak (<20%)', color: '#9CA3AF' },
    { label: 'Strong (20–39%)', color: '#3B82F6' },
    { label: 'Overuse (40–50%)', color: '#F59E0B' },
    { label: 'Stuck (>50%)', color: '#EF4444' }
  ];
  zones.forEach((z, i) => {
    doc.rect(MARGIN + i * 130, doc.y, 12, 12).fill(z.color);
    doc.fontSize(9).fillColor(C.mid).text(z.label, MARGIN + i * 130 + 16, doc.y, { width: 110 });
  });
  doc.moveDown(1.2);

  function drawUnstuckSection(title, dataObj, zonesObj, colorMap) {
    doc.fontSize(12).fillColor(C.dark).text(title, MARGIN);
    doc.moveDown(0.3);
    const keys = Object.keys(dataObj);
    const barW = CONTENT_W / keys.length - 8;
    const maxBarH = 80;
    const baseY = doc.y;
    const chartH = maxBarH + 35;

    keys.forEach((key, i) => {
      const val = dataObj[key] || 0;
      const bh = Math.max((val / 100) * maxBarH, 2);
      const zone = zonesObj?.[key] || 'strong';
      const bx = MARGIN + i * (barW + 8);
      const by = baseY + (maxBarH - bh);

      doc.rect(bx, by, barW, bh).fill(zoneColor(zone));

      // Zone label at top
      doc.fontSize(7).fillColor(zoneColor(zone))
        .text(zone, bx, by - 12, { width: barW, align: 'center' });

      // Key label at bottom
      doc.fontSize(9).fillColor(C.mid)
        .text(cap(key), bx, baseY + maxBarH + 4, { width: barW, align: 'center' });

      // Percentage
      doc.fontSize(9).fillColor(C.gray)
        .text(`${val}%`, bx, baseY + maxBarH + 17, { width: barW, align: 'center' });
    });

    doc.y = baseY + chartH + 8;
    doc.moveDown(0.5);
  }

  const uz = s.unstuckZones || {};
  drawUnstuckSection('Action Mode', aCalc, uz.action, actionColorMap);
  drawUnstuckSection('Operating Style', oCalc, uz.operating, opColorMap);
  drawUnstuckSection('Communication Focus', cCalc, uz.communication, commColorMap);

  // ════════════════════════════════════════════════════════════
  // PAGE 7: Work vs Personal Profiles
  // ════════════════════════════════════════════════════════════
  doc.addPage();
  sectionHeader('WORK vs. PERSONAL PROFILE');

  doc.fontSize(11).fillColor(C.mid).text(
    'Your profile often shifts between professional and personal contexts. Significant differences suggest that one environment requires you to suppress or amplify certain tendencies. Being aware of this shift — and the energy cost it carries — is the first step toward greater behavioral flexibility.',
    MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 }
  );
  doc.moveDown(1);

  function profileSection(title, profile) {
    if (!profile) return;
    doc.fontSize(13).fillColor(C.dark).text(title, MARGIN);
    doc.moveDown(0.4);

    const dims = [
      { label: 'Action Mode', data: profile.action, colors: actionColorMap },
      { label: 'Operating Style', data: profile.operating, colors: opColorMap },
      { label: 'Communication Focus', data: profile.communication, colors: commColorMap }
    ];
    dims.forEach(dim => {
      if (!dim.data) return;
      doc.fontSize(10).fillColor(C.gray).text(dim.label + ':', MARGIN);
      doc.moveDown(0.2);
      y = stackedBar(MARGIN, doc.y, dim.data, dim.colors, 22);
      doc.y = y + 4;
      y = legend(MARGIN, doc.y, dim.data, dim.colors);
      doc.y = y + 8;
    });
    doc.moveDown(0.5);
  }

  profileSection('Work Profile', s.workProfile);
  profileSection('Personal Profile', s.personalProfile);

  // Footer
  const footerY = doc.page.height - 50;
  doc.rect(MARGIN, footerY - 8, CONTENT_W, 0.5).fill('#E5E7EB');
  doc.fontSize(8).fillColor(C.gray).text(
    'This assessment is inspired by structural dynamics theory. Results reflect behavioral tendencies derived from scenario responses and should be used as a starting point for reflection and development — not as a fixed categorization.',
    MARGIN, footerY, { width: CONTENT_W, align: 'center' }
  );
}

// ─── Dashboard routes ─────────────────────────────────────────────────────────

app.get('/api/dashboard', (req, res) => {
  const sessions = loadSessions();
  const summary = sessions.map(s => ({
    id: s.id,
    name: s.name,
    email: s.email,
    completedAt: s.completedAt,
    profileName: s.scores?.profileName || '—',
    action: s.scores?.dominantProfile?.action || '—',
    operating: s.scores?.dominantProfile?.operating || '—',
    communication: s.scores?.dominantProfile?.communication || '—'
  }));
  res.json(summary);
});

app.get('/api/session/:id', (req, res) => {
  const sessions = loadSessions();
  const session = sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✓ Kantor Assessment running at http://localhost:${PORT}`);
  console.log(`  Assessment: http://localhost:${PORT}`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard.html\n`);
});
