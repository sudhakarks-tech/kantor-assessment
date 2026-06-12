/* ─── State ───────────────────────────────────────────────────────────────── */
let sessionId = null;
let completedSessionId = null;
let questionCount = 0;
const TOTAL_QUESTIONS = 28; // approximate for progress bar

/* ─── Entry point ─────────────────────────────────────────────────────────── */
async function startAssessment() {
  const name  = document.getElementById('nameInput').value.trim();
  const email = document.getElementById('emailInput').value.trim();

  if (!name) { alert('Please enter your name.'); return; }
  if (!email || !email.includes('@')) { alert('Please enter a valid email address.'); return; }

  const btn = document.getElementById('startBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Starting…';

  try {
    const res = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start');

    sessionId = data.sessionId;
    switchToChat();
    appendAssistantMessage(data.message);
  } catch (err) {
    alert('Error: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Begin Assessment';
  }
}

/* ─── Screen switching ────────────────────────────────────────────────────── */
function switchToChat() {
  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('chatScreen').classList.remove('hidden');
  document.getElementById('progressWrap').classList.remove('hidden');
  document.getElementById('chatScreen').style.display = 'flex';
  document.getElementById('userInput').focus();
}

function switchToCompletion(scores) {
  document.getElementById('chatScreen').classList.add('hidden');
  document.getElementById('chatScreen').style.display = 'none';
  document.getElementById('inputArea').classList.add('hidden');

  const profileName = scores?.profileName || 'Your Profile';
  document.getElementById('completionProfile').textContent = profileName.toUpperCase();

  document.getElementById('completionScreen').classList.remove('hidden');
  document.getElementById('progressFill').style.width = '100%';

  completedSessionId = sessionId;
}

/* ─── Send message ────────────────────────────────────────────────────────── */
async function sendMessage(text) {
  const input = document.getElementById('userInput');
  const message = (text || input.value).trim();
  if (!message || !sessionId) return;

  input.value = '';
  autoResize(input);
  removeOptions();
  appendUserMessage(message);
  showTypingIndicator();
  setInputEnabled(false);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message })
    });
    const data = await res.json();

    removeTypingIndicator();

    if (!res.ok) throw new Error(data.error || 'Request failed');

    questionCount = data.questionCount || questionCount + 1;
    updateProgress();

    if (data.isComplete) {
      if (data.message) appendAssistantMessage(data.message);
      setTimeout(() => switchToCompletion(data.scores), 1800);
    } else {
      appendAssistantMessage(data.message);
      setInputEnabled(true);
      document.getElementById('userInput').focus();
    }
  } catch (err) {
    removeTypingIndicator();
    appendErrorMessage(err.message);
    setInputEnabled(true);
  }
}

/* ─── Message rendering ───────────────────────────────────────────────────── */
function appendAssistantMessage(text) {
  const area = document.getElementById('chatArea');

  const wrapper = document.createElement('div');
  wrapper.className = 'message assistant';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = 'A';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  // Parse options (lines starting with A. B. C. D.)
  const { prose, options } = parseOptions(text);

  bubble.innerHTML = formatText(prose);

  if (options.length > 0) {
    const optList = document.createElement('div');
    optList.className = 'options-list';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = opt;
      btn.onclick = () => {
        document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        setTimeout(() => sendMessage(opt), 200);
      };
      optList.appendChild(btn);
    });
    bubble.appendChild(optList);
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  area.appendChild(wrapper);
  scrollToBottom();
}

function appendUserMessage(text) {
  const area = document.getElementById('chatArea');
  const wrapper = document.createElement('div');
  wrapper.className = 'message user';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = 'U';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  area.appendChild(wrapper);
  scrollToBottom();
}

function appendErrorMessage(msg) {
  const area = document.getElementById('chatArea');
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = `<div class="message-avatar">!</div><div class="message-bubble" style="background:#FEF2F2;border-color:#FECACA;color:#DC2626">Sorry, something went wrong: ${msg}. Please try again.</div>`;
  area.appendChild(div);
  scrollToBottom();
}

/* ─── Option parsing ──────────────────────────────────────────────────────── */
function parseOptions(text) {
  const lines = text.split('\n');
  const optionPattern = /^[A-D][.)]\s+/;
  const prose = [];
  const options = [];

  for (const line of lines) {
    if (optionPattern.test(line.trim())) {
      options.push(line.trim());
    } else {
      prose.push(line);
    }
  }

  return {
    prose: prose.join('\n').trim(),
    options
  };
}

/* ─── Text formatting ─────────────────────────────────────────────────────── */
function formatText(text) {
  return text
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

/* ─── Typing indicator ────────────────────────────────────────────────────── */
function showTypingIndicator() {
  const area = document.getElementById('chatArea');
  const wrapper = document.createElement('div');
  wrapper.className = 'message assistant';
  wrapper.id = 'typingIndicator';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = 'A';

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';

  wrapper.appendChild(avatar);
  wrapper.appendChild(indicator);
  area.appendChild(wrapper);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

function removeOptions() {
  document.querySelectorAll('.option-btn').forEach(b => {
    b.disabled = true;
    b.style.cursor = 'default';
  });
}

/* ─── Utilities ───────────────────────────────────────────────────────────── */
function scrollToBottom() {
  const area = document.getElementById('chatArea');
  area.scrollTop = area.scrollHeight;
}

function setInputEnabled(enabled) {
  const input = document.getElementById('userInput');
  const btn = document.getElementById('sendBtn');
  input.disabled = !enabled;
  btn.disabled = !enabled;
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function updateProgress() {
  const pct = Math.min((questionCount / TOTAL_QUESTIONS) * 100, 95);
  document.getElementById('progressFill').style.width = pct + '%';
}

function startNew() {
  sessionId = null;
  completedSessionId = null;
  questionCount = 0;
  document.getElementById('chatArea').innerHTML = '';
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressWrap').classList.add('hidden');
  document.getElementById('completionScreen').classList.add('hidden');
  document.getElementById('inputArea').classList.remove('hidden');
  document.getElementById('welcomeScreen').classList.remove('hidden');
  document.getElementById('nameInput').value = '';
  document.getElementById('emailInput').value = '';
}

async function downloadReport() {
  if (!completedSessionId) return;
  const btn = document.getElementById('downloadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Generating…';

  try {
    const res = await fetch(`/api/report/${completedSessionId}`);
    if (!res.ok) throw new Error('Report not ready');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'behavioral-profile.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Could not generate report: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⬇ Download PDF Report';
  }
}
