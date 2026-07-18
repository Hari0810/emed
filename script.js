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

function submitCheckIn(selectedSymptoms, noChanges, needsPromptReview) {
  fetch('/api/checkins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mood: noChanges ? 'steady' : needsPromptReview ? 'concerning' : 'changed',
      symptoms: noChanges ? [] : selectedSymptoms,
      recordedAt: new Date().toISOString()
    })
  }).catch(() => {});
}

function finishCheckIn(selectedSymptoms) {
  const noChanges = selectedSymptoms.includes('No new symptoms');
  const higherAttentionSymptoms = ['Breathing or chest symptoms', 'Urine changes', 'Numbness or weakness'];
  const needsPromptReview = selectedSymptoms.some((symptom) => higherAttentionSymptoms.includes(symptom));
  let summary = noChanges
    ? 'No new or worsening symptoms were reported.'
    : `Recorded: ${selectedSymptoms.join(', ')}.`;

  if (needsPromptReview) {
    summary += ' Because this includes a potentially important change, contact your care team promptly. If it is severe or rapidly worsening, seek urgent medical help.';
  }

  submitCheckIn(selectedSymptoms, noChanges, needsPromptReview);

  modalTitle.textContent = 'Check-in saved';
  modalCopy.textContent = 'This has been added to your longitudinal record.';
  modalContent.className = '';
  modalContent.innerHTML = `<div class="saved-symptoms${needsPromptReview ? ' urgent' : ''}">${summary} Unflare will compare this check-in with your medication timeline, clinical data, and personal baseline.</div><button class="modal-confirm" type="button">Done</button>`;
  modalContent.querySelector('button').addEventListener('click', closeModal);
  modalSafety.hidden = true;
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
    finishCheckIn(selected);
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

document.querySelector('#checkIn').addEventListener('click', () => openCheckIn());
document.querySelector('#startCall').addEventListener('click', () => openCheckIn());
document.querySelector('#answerButton').addEventListener('click', () => {
  openCheckIn('Have any of these symptoms changed?', 'Your recent medication change and 10-day trend make a targeted check-in useful. Select all that apply.');
});

document.querySelector('#whyButton').addEventListener('click', () => {
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

const conversations = {
  call: {
    title: 'Targeted symptom call',
    meta: 'Today · 9:14 AM · 4 minutes',
    summary: 'Alex reported increasing fatigue, mild joint aches, and persistent sinus pressure. No fever, breathlessness, chest pain, visible blood in urine, rash, numbness, or weakness was reported.',
    tags: [['Pattern', 'Changed'], ['Attention', 'Review', 'review-risk'], ['Next step', 'Care team']],
    messages: [
      ['unflare', 'Hi Alex. Your activity and resting heart rate have both shifted. Has your fatigue changed too?'],
      ['you', 'Yes, I’ve felt more tired each day, and my joints are a little achy.'],
      ['unflare', 'Have you noticed sinus symptoms, fever, breathing changes, urine changes, a rash, numbness, or unusual weakness?'],
      ['you', 'Some sinus pressure that hasn’t cleared, but none of the other symptoms.']
    ]
  },
  chat: {
    title: 'Daily symptom check-in',
    meta: 'Thursday · 7:42 PM · Chat',
    summary: 'Alex felt more drained than usual for the third day. Activity was below baseline. No urgent warning symptoms were reported.',
    tags: [['Fatigue', 'Increasing'], ['Attention', 'Monitor'], ['Follow-up', '48 hours']],
    messages: [
      ['unflare', 'How does your energy compare with your usual level today?'],
      ['you', 'Lower again. I’ve been more drained each evening this week.'],
      ['unflare', 'Thanks. I’ll add that change to the pattern and ask again if it continues.']
    ]
  },
  call2: {
    title: 'Medication follow-up',
    meta: '14 July · 10:30 AM · 3 minutes',
    summary: 'Prednisone was reduced from 10 mg to 7.5 mg on 9 July as directed by the care team. Alex reported taking 96% of scheduled doses and making no unplanned medication changes.',
    tags: [['Dose', '7.5 mg'], ['Adherence', '96%'], ['Prescriber', 'Confirmed']],
    messages: [
      ['unflare', 'Your record shows a prescribed prednisone reduction on 9 July. Is 7.5 mg still your current dose?'],
      ['you', 'Yes. I missed one dose this month but haven’t changed anything else.'],
      ['unflare', 'Thanks. Keep taking it as prescribed and contact your care team before making any changes.']
    ]
  },
  chat2: {
    title: 'Infection follow-up',
    meta: '11 July · 8:05 AM · Chat',
    summary: 'Cold symptoms were improving after four days. Alex reported nasal congestion but no fever, breathing difficulty, or chest pain.',
    tags: [['Infection', 'Improving'], ['Fever', 'None'], ['Context', 'Recorded']],
    messages: [
      ['unflare', 'How are the cold symptoms you reported earlier this week?'],
      ['you', 'Mostly better. My nose is still congested, but I don’t have a fever.'],
      ['unflare', 'Thanks. I’ll keep this infection in your timeline as relevant context.']
    ]
  }
};

function renderTranscript(conversation) {
  document.querySelector('#transcriptTitle').textContent = conversation.title;
  document.querySelector('#transcriptMeta').textContent = conversation.meta;
  document.querySelector('#transcriptSummary').textContent = conversation.summary;
  document.querySelector('.summary-box > div').innerHTML = conversation.tags.map(([label, value, className = '']) => `<span>${label} <b class="${className}">${value}</b></span>`).join('');
  document.querySelector('#transcriptMessages').innerHTML = conversation.messages.map(([speaker, text]) => `
    <div class="message ${speaker === 'you' ? 'user' : 'ai'}">
      <small>${speaker === 'you' ? 'YOU' : 'UNFLARE'}</small>
      <p>${text}</p>
    </div>`).join('');
}

document.querySelectorAll('.conversation').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.conversation').forEach((row) => row.classList.remove('active'));
    item.classList.add('active');
    renderTranscript(conversations[item.dataset.conversation]);
  });
});

document.querySelectorAll('[data-filter]').forEach((filter) => {
  filter.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === filter));
    document.querySelectorAll('.conversation').forEach((conversation) => {
      conversation.hidden = filter.dataset.filter !== 'all' && conversation.dataset.kind !== filter.dataset.filter;
    });
  });
});

if (location.hash === '#history') selectTab('history');
