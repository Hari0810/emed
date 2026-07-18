const modal = document.querySelector('#modal');
const modalTitle = document.querySelector('#modalTitle');
const modalCopy = document.querySelector('#modalCopy');
const modalContent = document.querySelector('#modalContent');
const modalSafety = document.querySelector('.modal-safety');
const symptomOptions = modalContent.innerHTML;

function closeModal() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function showModal() {
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2600);
}

async function readJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    if (/^\s*<!doctype|^\s*<html/i.test(text)) {
      throw new Error('The Unflare API is not running here. Start it with npm run dev and open http://localhost:3000.');
    }
    throw new Error(`The server returned an unexpected response (${response.status}).`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The server returned invalid JSON. Check the backend logs and try again.');
  }
}

async function finishCheckIn(selectedSymptoms) {
  const noChanges = selectedSymptoms.includes('No new symptoms');
  const higherAttentionSymptoms = ['Breathing or chest symptoms', 'Urine changes', 'Numbness or weakness'];
  const needsPromptReview = selectedSymptoms.some((symptom) => higherAttentionSymptoms.includes(symptom));
  let summary = noChanges
    ? 'No new or worsening symptoms were reported.'
    : `Recorded: ${selectedSymptoms.join(', ')}.`;

  if (needsPromptReview) {
    summary += ' Because this includes a potentially important change, contact your care team promptly. If it is severe or rapidly worsening, seek urgent medical help.';
  }

  try {
    const response = await fetch('/api/check-ins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symptoms: selectedSymptoms })
    });
    const body = await readJsonResponse(response);
    if (!response.ok) throw new Error(body.error || 'Unable to save this check-in.');
    await loadHistory(body.checkIn.id);
    modalTitle.textContent = 'Check-in saved';
    modalCopy.textContent = 'This has been added to your longitudinal record.';
    modalContent.className = '';
    modalContent.innerHTML = `<div class="saved-symptoms${needsPromptReview ? ' urgent' : ''}">${summary} Unflare will compare this check-in with your medication timeline, clinical data, and personal baseline.</div><button class="modal-confirm" type="button">Done</button>`;
    modalContent.querySelector('button').addEventListener('click', closeModal);
    modalSafety.hidden = true;
  } catch (error) {
    modalTitle.textContent = 'Unable to save check-in';
    modalCopy.textContent = error.message || 'Please try again.';
  }
}

function bindSymptomOptions() {
  const optionButtons = [...modalContent.querySelectorAll('[data-symptom]')];
  const saveButton = modalContent.querySelector('.save-symptoms');

  optionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.symptom === 'No new symptoms') {
        optionButtons.forEach((option) => option.classList.remove('selected'));
        button.classList.add('selected');
      } else {
        modalContent.querySelector('[data-symptom="No new symptoms"]').classList.remove('selected');
        button.classList.toggle('selected');
      }
    });
  });

  saveButton.addEventListener('click', () => {
    const selected = optionButtons.filter((button) => button.classList.contains('selected')).map((button) => button.dataset.symptom);
    if (!selected.length) {
      saveButton.textContent = 'Select at least one option';
      window.setTimeout(() => { saveButton.textContent = 'Save check-in'; }, 1500);
      return;
    }
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    void finishCheckIn(selected);
  });
}

function openCheckIn(prompt = 'What has changed today?', copy = 'Select every new or worsening symptom. This adds context; it does not diagnose a flare.') {
  modalTitle.textContent = prompt;
  modalCopy.textContent = copy;
  modalContent.className = 'symptom-options';
  modalContent.innerHTML = symptomOptions;
  modalSafety.hidden = false;
  bindSymptomOptions();
  showModal();
}

function openInformation(title, copy, content, buttonLabel = 'Got it') {
  modalTitle.textContent = title;
  modalCopy.textContent = copy;
  modalContent.className = '';
  modalContent.innerHTML = `${content}<button class="modal-confirm" type="button">${buttonLabel}</button>`;
  modalContent.querySelector('button').addEventListener('click', closeModal);
  modalSafety.hidden = true;
  showModal();
}

async function pollCallStatus(callId, statusElement) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
    try {
      const response = await fetch(`/api/calls/${encodeURIComponent(callId)}`);
      const body = await readJsonResponse(response);
      if (!response.ok) return;
      const { call } = body;
      statusElement.textContent = `Call status: ${call.status.replace('-', ' ')}.`;
      if (['completed', 'declined', 'urgent', 'failed'].includes(call.status)) return;
    } catch {
      return;
    }
  }
}

function openVoiceCall() {
  modalTitle.textContent = 'Call me for a symptom check-in';
  modalCopy.textContent = 'Unflare will call the configured demo number for a short AI-supported check-in. It is not emergency care and does not diagnose a flare.';
  modalContent.className = 'voice-call-form';
  modalContent.innerHTML = `
    <form id="voiceCallForm">
      <p class="demo-call-number">Demo number configured · ending in 8087</p>
      <label class="call-consent"><input name="callConsent" type="checkbox" required> I have permission to call the configured demo number.</label>
      <p id="callFormStatus" class="call-form-status" aria-live="polite"></p>
      <button class="modal-confirm" type="submit">Start call</button>
    </form>`;
  modalSafety.hidden = false;
  modalSafety.textContent = 'Only start a call to a number that has agreed to receive health check-ins. For urgent symptoms, seek urgent medical help instead.';
  modalContent.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button');
    const status = form.querySelector('#callFormStatus');
    submitButton.disabled = true;
    status.textContent = 'Starting your call…';
    try {
      const response = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body.error || 'Unable to start the call.');
      status.textContent = `Calling ${body.call.phoneNumber}. Call status: ${body.call.status}.`;
      submitButton.textContent = 'Call requested';
      pollCallStatus(body.call.id, status);
    } catch (error) {
      status.textContent = error.message || 'Unable to start the call.';
      submitButton.disabled = false;
    }
  });
  showModal();
}

async function openWhatsAppCheckIn() {
  const pendingWindow = window.open('about:blank', '_blank');
  if (pendingWindow) pendingWindow.opener = null;
  try {
    const response = await fetch('/api/whatsapp');
    const body = await readJsonResponse(response);
    if (!response.ok) throw new Error(body.error || 'Unable to load WhatsApp configuration.');
    if (!body.enabled || !body.launchUrl) {
      throw new Error('WhatsApp is not configured. Add TWILIO_WHATSAPP_FROM and your Twilio credentials to .env, then restart the server.');
    }
    if (pendingWindow) {
      pendingWindow.location.replace(body.launchUrl);
    } else {
      window.location.href = body.launchUrl;
    }
    if (body.sandbox) {
      showToast('Twilio Sandbox opened — join it first if prompted');
    }
  } catch (error) {
    pendingWindow?.close();
    openInformation(
      'WhatsApp check-in unavailable',
      error.message || 'Unable to open WhatsApp.',
      '<div class="saved-symptoms">Run the complete app with <strong>npm run dev</strong>. For Sandbox testing, activate WhatsApp in the Twilio Console and configure its inbound webhook.</div>'
    );
  }
}

document.querySelector('#checkIn')?.addEventListener('click', () => openCheckIn());
document.querySelector('#startCall').addEventListener('click', openVoiceCall);
document.querySelector('#startWhatsApp').addEventListener('click', openWhatsAppCheckIn);
document.querySelector('#answerButton').addEventListener('click', () => {
  openCheckIn('Have any of these symptoms changed?', 'Your recent medication change and 10-day trend make a targeted check-in useful. Select all that apply.');
});

document.querySelector('#whyButton')?.addEventListener('click', () => {
  openInformation(
    'Why review is recommended',
    'Confidence describes how strongly the combined pattern merits attention — not confidence that you are having a flare.',
    '<div class="saved-symptoms">Prednisone 10 → 7.5 mg · Activity −32% · Resting heart rate +14% · Increasing fatigue · New joint aches · Persistent sinus pressure · Recent respiratory infection</div>'
  );
});

document.querySelector('#closeModal').addEventListener('click', closeModal);
document.querySelector('.modal-backdrop').addEventListener('click', closeModal);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

document.querySelector('#planButton').addEventListener('click', (event) => {
  const button = event.currentTarget;
  button.textContent = 'Summary ready to share';
  button.disabled = true;
  button.classList.add('is-complete');
  showToast('✓ Care-team summary prepared');
  openInformation(
    'Care-team summary ready',
    'This summary organises the simulated evidence for review; it does not diagnose a flare.',
    '<div class="saved-symptoms"><strong>10-day sustained change</strong><br>Prednisone reduced from 10 mg to 7.5 mg on 9 July. Fatigue, mild joint aches, and sinus pressure increased. Daily activity fell 32% and resting heart rate rose 14% from baseline. Adherence: 96%. Recent respiratory infection reported. No urgent warning symptoms reported in today’s check-in.<br><br><strong>Suggested action:</strong> care-team review.</div>',
    'Done'
  );
});

function selectTab(tabName) {
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabName);
  });
  history.replaceState(null, '', `#${tabName}`);
}

document.querySelectorAll('[data-tab]').forEach((tab) => {
  tab.addEventListener('click', (event) => {
    event.preventDefault();
    selectTab(tab.dataset.tab);
  });
});

let checkIns = [];
let activeHistoryFilter = 'all';

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function displayChannel(checkIn) {
  return checkIn.channel === 'phone' ? 'Phone call' : checkIn.channel === 'whatsapp' ? 'WhatsApp chat' : 'App check-in';
}

function displayTitle(checkIn) {
  return checkIn.channel === 'phone' ? 'Phone symptom check-in' : checkIn.channel === 'whatsapp' ? 'WhatsApp symptom check-in' : 'Targeted symptom check-in';
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function previewFor(checkIn) {
  const patientTurn = [...(checkIn.turns || [])].reverse().find((turn) => turn.role === 'patient');
  const preview = patientTurn?.text || checkIn.summary?.summary || 'Check-in started.';
  return preview.length > 88 ? `${preview.slice(0, 85)}…` : preview;
}

function kindFor(checkIn) {
  return checkIn.channel === 'phone' ? 'call' : 'chat';
}

function renderTranscript(checkIn) {
  const isCall = checkIn.channel === 'phone';
  const icon = document.querySelector('#transcriptIcon');
  icon.className = `conversation-icon ${isCall ? 'call' : 'chat'}`;
  icon.textContent = isCall ? '☎' : '✦';
  document.querySelector('#transcriptTitle').textContent = displayTitle(checkIn);
  document.querySelector('#transcriptMeta').textContent = `${formatDate(checkIn.createdAt)} · ${displayChannel(checkIn)} · ${checkIn.status.replace('-', ' ')}`;
  document.querySelector('#transcriptSummary').textContent = checkIn.summary?.summary || 'This check-in is still in progress. Its transcript will appear as messages are received.';

  const tags = [
    ['Status', checkIn.status.replace('-', ' ')],
    ['Channel', displayChannel(checkIn)]
  ];
  if (checkIn.safetyFlags?.length) tags.push(['Attention', 'Urgent']);
  else if (checkIn.summary?.followUpRecommended) tags.push(['Follow-up', 'Care team']);
  document.querySelector('#transcriptTags').innerHTML = tags.map(([label, value]) => `<span>${escapeHtml(label)} <b>${escapeHtml(value)}</b></span>`).join('');

  const messages = checkIn.turns || [];
  document.querySelector('#transcriptMessages').innerHTML = messages.length
    ? messages.map((turn) => `<div class="message ${turn.role === 'patient' ? 'user' : 'ai'}"><small>${turn.role === 'patient' ? 'YOU' : 'UNFLARE'}</small><p>${escapeHtml(turn.text)}</p></div>`).join('')
    : '<p class="empty-history">No messages have been recorded yet.</p>';
}

function renderHistory(selectedId) {
  const list = document.querySelector('#conversationList');
  const visible = checkIns.filter((checkIn) => activeHistoryFilter === 'all' || kindFor(checkIn) === activeHistoryFilter);
  if (!visible.length) {
    list.innerHTML = '<p class="empty-history">No matching check-ins yet.</p>';
    return;
  }
  const currentId = selectedId || visible[0].id;
  list.innerHTML = visible.map((checkIn) => {
    const isCall = kindFor(checkIn) === 'call';
    return `<button class="conversation${checkIn.id === currentId ? ' active' : ''}" data-check-in-id="${escapeHtml(checkIn.id)}"><span class="conversation-icon ${isCall ? 'call' : 'chat'}">${isCall ? '☎' : '✦'}</span><span><strong>${escapeHtml(displayTitle(checkIn))}</strong><small>${escapeHtml(formatDate(checkIn.createdAt))} · ${escapeHtml(displayChannel(checkIn))}</small><em>${escapeHtml(previewFor(checkIn))}</em></span><b>›</b></button>`;
  }).join('');
  const selected = visible.find((checkIn) => checkIn.id === currentId) || visible[0];
  renderTranscript(selected);
  list.querySelectorAll('[data-check-in-id]').forEach((item) => {
    item.addEventListener('click', () => renderHistory(item.dataset.checkInId));
  });
}

async function loadHistory(selectedId) {
  const list = document.querySelector('#conversationList');
  try {
    const response = await fetch('/api/check-ins');
    const body = await readJsonResponse(response);
    if (!response.ok) throw new Error(body.error || 'Unable to load check-ins.');
    checkIns = body.checkIns || [];
    renderHistory(selectedId);
  } catch (error) {
    list.innerHTML = `<p class="empty-history">${escapeHtml(error.message || 'Unable to load your check-ins.')}</p>`;
  }
}

document.querySelectorAll('[data-filter]').forEach((filter) => {
  filter.addEventListener('click', () => {
    activeHistoryFilter = filter.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === filter));
    renderHistory();
  });
});

if (location.hash === '#history') selectTab('history');
loadHistory();
