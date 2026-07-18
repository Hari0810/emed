const modal = document.querySelector('#modal');
const modalTitle = document.querySelector('#modalTitle');
const modalCopy = document.querySelector('#modalCopy');
const modalContent = document.querySelector('#modalContent');
const moodOptions = modalContent.innerHTML;

function closeModal() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function finishCheckIn(mood) {
  modalTitle.textContent = 'Check-in saved';
  modalCopy.textContent = `We’ve recorded that you’re feeling ${mood.toLowerCase()} today.`;
  modalContent.innerHTML = '<button class="modal-confirm" type="button">Done</button>';
  modalContent.querySelector('button').addEventListener('click', closeModal);
}

function openCheckIn(prompt = 'How are you feeling today?', copy = 'This helps Unflare understand what your sensors can’t see.') {
  modalTitle.textContent = prompt;
  modalCopy.textContent = copy;
  modalContent.innerHTML = moodOptions;
  modalContent.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => finishCheckIn(button.dataset.mood));
  });
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

document.querySelector('#checkIn').addEventListener('click', () => openCheckIn());
document.querySelector('#startCall').addEventListener('click', () => openCheckIn());
document.querySelector('#answerButton').addEventListener('click', () => {
  openCheckIn('Have you felt unwell or under extra stress?', 'Your answer can help explain the change in resting heart rate.');
});

document.querySelector('#whyButton').addEventListener('click', () => {
  modalTitle.textContent = 'How we calculated 78';
  modalCopy.textContent = 'Your score compares sleep, activity, recovery, heart rate and recent check-ins with your usual range.';
  modalContent.innerHTML = '<button class="modal-confirm" type="button">Got it</button>';
  modalContent.querySelector('button').addEventListener('click', closeModal);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
});

document.querySelector('#closeModal').addEventListener('click', closeModal);
document.querySelector('.modal-backdrop').addEventListener('click', closeModal);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

document.querySelector('#planButton').addEventListener('click', (event) => {
  const button = event.currentTarget;
  button.textContent = 'Added to today’s plan';
  button.disabled = true;
  button.classList.add('is-complete');
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
    title: 'Weekly health check-in', meta: 'Today · 9:14 AM · 4 minutes',
    summary: 'Alex reported lower energy since Thursday and a mild headache this morning. No fever, chest pain, or shortness of breath. Hydration may be lower than usual.',
    messages: [['unflare', 'Hi Alex, I noticed your resting heart rate has been a little higher. How have you been feeling?'], ['you', 'A bit more tired than usual, and I woke up with a mild headache.'], ['unflare', 'Have you had any fever, chest pain, or trouble breathing?'], ['you', 'No, none of those. I probably haven’t had enough water today.']]
  },
  chat: {
    title: 'Daily check-in', meta: 'Thursday · 7:42 PM · Chat',
    summary: 'Alex felt more drained than usual after a busy day. Activity remained normal and no acute symptoms were reported.',
    messages: [['unflare', 'How was your energy today?'], ['you', 'Lower than usual. I had a busy day and felt drained by the evening.'], ['unflare', 'Thanks — I’ll take that into account alongside your sleep and activity.']]
  },
  call2: {
    title: 'Medication follow-up', meta: '14 July · 10:30 AM · 3 minutes',
    summary: 'All scheduled medication doses were taken. Alex reported no new side effects or concerns.',
    messages: [['unflare', 'Were you able to take your medication as planned this week?'], ['you', 'Yes, I haven’t missed any doses.'], ['unflare', 'Good to hear. Have you noticed any new side effects?'], ['you', 'No, nothing new.']]
  },
  chat2: {
    title: 'Sleep check-in', meta: '11 July · 8:05 AM · Chat',
    summary: 'Sleep was interrupted twice overnight. Alex returned to sleep quickly and felt okay the following morning.',
    messages: [['unflare', 'Your sleep was interrupted twice last night. How do you feel this morning?'], ['you', 'A little tired, but otherwise okay.'], ['unflare', 'Thanks. I’ll keep an eye on whether that becomes a pattern.']]
  }
};

function renderTranscript(conversation) {
  document.querySelector('#transcriptTitle').textContent = conversation.title;
  document.querySelector('#transcriptMeta').textContent = conversation.meta;
  document.querySelector('#transcriptSummary').textContent = conversation.summary;
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
