"use client";

import { useEffect, useRef, useState } from "react";

type Tab = "dashboard" | "voice" | "history" | "test";
type ModalMode = "checkin" | "info" | "voice";
type ConversationKey = "call" | "chat" | "call2" | "chat2";
type VoiceTurn = { speaker: "unflare" | "you"; text: string };
type WhatsAppTestTurn = { speaker: "you" | "unflare"; text: string };

type FlareRiskLevel = "low" | "medium" | "high" | "very-high";
type Evidence = { source: string; recordId: string; occurredAt: string; detail: string };
type Finding = { code: string; summary: string; evidence: Evidence[] };
type SideEffectClassification = {
  symptomName: string;
  occurredAt: string;
  classification: "likely-side-effect" | "possible-disease-activity" | "unclear";
  evidence: Evidence[];
};
type FlareEarlyWarning = { level: FlareRiskLevel; score: number; rationale: string[]; evidence: Evidence[] };
type ActionTier = "self-monitor" | "self-care" | "contact-care-team" | "contact-care-team-promptly";
type Recommendation = { tier: ActionTier; headline: string; detail: string; evidence: Evidence[] };
type SignalsResponse = {
  slowBurn: Finding | null;
  taperRisk: Finding[];
  sideEffects: SideEffectClassification[];
  delayedCorrelation: Finding[];
  flareEarlyWarning: FlareEarlyWarning;
  recommendation: Recommendation;
};

const attentionCopy: Record<FlareRiskLevel, { pillClass: string; pillText: string; headline: string }> = {
  low: { pillClass: "", pillText: "● Monitoring", headline: "Steady — no notable changes detected." },
  medium: { pillClass: "attention", pillText: "● Worth watching", headline: "A few small changes are worth watching." },
  high: { pillClass: "attention", pillText: "● Needs attention", headline: "Care-team review recommended." },
  "very-high": { pillClass: "urgent", pillText: "● Review promptly", headline: "Prompt care-team review recommended." }
};

function evidenceLabel(evidence: Evidence) {
  const date = new Date(evidence.occurredAt);
  const when = Number.isNaN(date.getTime()) ? evidence.occurredAt : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${when} · ${evidence.detail}`;
}

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

const voiceQuestions = [
  "How have you felt compared with your usual self?",
  "Have you had a fever, recent infection, or persistent sinus or nasal symptoms?",
  "Have you noticed new joint or muscle aches, a rash, numbness, or unusual weakness?",
  "Have you noticed any breathing, chest, or urine changes?",
  "Have you taken your medication as prescribed, including any clinician-directed dose changes?"
];

function urgentVoiceMessage(answer: string) {
  if (/\b(cough(?:ing|ed)? up blood|blood when (?:i )?cough|haemoptysis|hemoptysis)\b/i.test(answer)) return "Coughing up blood can need urgent medical attention. Please call 999 now or go to the nearest emergency department.";
  if (/\b(can(?:not|'t) breathe|severe(?:ly)? breathless|struggling to breathe|gasping for (?:air|breath))\b/i.test(answer)) return "Severe breathing problems can need urgent medical attention. Please call 999 now or go to the nearest emergency department.";
  if (/\b(blood in (?:my |the )?urine|visible blood when (?:i )?(?:pee|urinate)|urine (?:is|was|looks?) (?:red|bloody))\b/i.test(answer)) return "Visible blood in urine can need urgent medical attention. Please call 999 now or go to the nearest emergency department.";
  if (/\b(sudden(?:ly)? (?:very )?weak|cannot move (?:my )?(?:arm|leg|side)|can't move (?:my )?(?:arm|leg|side)|one[- ]sided weakness)\b/i.test(answer)) return "Marked weakness can need urgent medical attention. Please call 999 now or go to the nearest emergency department.";
  return null;
}

const symptoms = [
  "Fatigue",
  "Sinus or nasal symptoms",
  "Joint or muscle pain",
  "Fever or infection",
  "Breathing or chest symptoms",
  "Urine changes",
  "Rash or skin changes",
  "Numbness or weakness",
  "No new symptoms"
];

const conversations = {
  call: {
    kind: "call",
    title: "Targeted symptom call",
    meta: "Today · 9:14 AM · 4 min",
    detailMeta: "Today · 9:14 AM · 4 minutes",
    excerpt: "Fatigue, joint aches, and sinus pressure",
    summary: "Alex reported increasing fatigue, mild joint aches, and persistent sinus pressure. No fever, breathlessness, chest pain, visible blood in urine, rash, numbness, or weakness was reported.",
    tags: [["Pattern", "Changed"], ["Attention", "Review", "review-risk"], ["Next step", "Care team"]],
    messages: [["unflare", "Hi Alex. Your activity and resting heart rate have both shifted. Has your fatigue changed too?"], ["you", "Yes, I’ve felt more tired each day, and my joints are a little achy."], ["unflare", "Have you noticed sinus symptoms, fever, breathing changes, urine changes, a rash, numbness, or unusual weakness?"], ["you", "Some sinus pressure that hasn’t cleared, but none of the other symptoms."]]
  },
  chat: {
    kind: "chat",
    title: "Daily symptom check-in",
    meta: "Thursday · 7:42 PM · Chat",
    detailMeta: "Thursday · 7:42 PM · Chat",
    excerpt: "“More drained than usual”",
    summary: "Alex felt more drained than usual for the third day. Activity was below baseline. No urgent warning symptoms were reported.",
    tags: [["Fatigue", "Increasing"], ["Attention", "Monitor"], ["Follow-up", "48 hours"]],
    messages: [["unflare", "How does your energy compare with your usual level today?"], ["you", "Lower again. I’ve been more drained each evening this week."], ["unflare", "Thanks. I’ll add that change to the pattern and ask again if it continues."]]
  },
  call2: {
    kind: "call",
    title: "Medication follow-up",
    meta: "14 July · 10:30 AM · 3 min",
    detailMeta: "14 July · 10:30 AM · 3 minutes",
    excerpt: "Prednisone taper and adherence reviewed",
    summary: "Prednisone was reduced from 10 mg to 7.5 mg on 9 July as directed by the care team. Alex reported taking 96% of scheduled doses and making no unplanned medication changes.",
    tags: [["Dose", "7.5 mg"], ["Adherence", "96%"], ["Prescriber", "Confirmed"]],
    messages: [["unflare", "Your record shows a prescribed prednisone reduction on 9 July. Is 7.5 mg still your current dose?"], ["you", "Yes. I missed one dose this month but haven’t changed anything else."], ["unflare", "Thanks. Keep taking it as prescribed and contact your care team before making any changes."]]
  },
  chat2: {
    kind: "chat",
    title: "Infection follow-up",
    meta: "11 July · 8:05 AM · Chat",
    detailMeta: "11 July · 8:05 AM · Chat",
    excerpt: "Cold improving; no fever reported",
    summary: "Cold symptoms were improving after four days. Alex reported nasal congestion but no fever, breathing difficulty, or chest pain.",
    tags: [["Infection", "Improving"], ["Fever", "None"], ["Context", "Recorded"]],
    messages: [["unflare", "How are the cold symptoms you reported earlier this week?"], ["you", "Mostly better. My nose is still congested, but I don’t have a fever."], ["unflare", "Thanks. I’ll keep this infection in your timeline as relevant context."]]
  }
} as const;

export default function Home() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalCopy, setModalCopy] = useState("");
  const [modalBody, setModalBody] = useState("");
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [checkInSaved, setCheckInSaved] = useState(false);
  const [savePrompt, setSavePrompt] = useState("Save check-in");
  const [summaryReady, setSummaryReady] = useState(false);
  const [toast, setToast] = useState("");
  const [activeConversation, setActiveConversation] = useState<ConversationKey>("call");
  const [filter, setFilter] = useState<"all" | "call" | "chat">("all");
  const [voiceTurns, setVoiceTurns] = useState<VoiceTurn[]>([]);
  const [voiceQuestionIndex, setVoiceQuestionIndex] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceComplete, setVoiceComplete] = useState(false);
  const whatsAppTestNumber = "+447492368087";
  const [whatsAppTestMessage, setWhatsAppTestMessage] = useState("");
  const [whatsAppTestTurns, setWhatsAppTestTurns] = useState<WhatsAppTestTurn[]>([]);
  const [whatsAppTestStatus, setWhatsAppTestStatus] = useState("Send START to begin a simulated WhatsApp check-in.");
  const [whatsAppTestSending, setWhatsAppTestSending] = useState(false);
  const [signals, setSignals] = useState<SignalsResponse | null>(null);
  const [signalsError, setSignalsError] = useState("");
  const voiceRecognition = useRef<BrowserSpeechRecognition | null>(null);

  async function loadSignals() {
    try {
      const response = await fetch("/api/anca/signals");
      if (!response.ok) throw new Error();
      setSignals(await response.json() as SignalsResponse);
      setSignalsError("");
    } catch {
      setSignalsError("Unable to load your latest monitoring signals. Start the API with npm run dev.");
    }
  }

  useEffect(() => {
    const hashTab = window.location.hash.slice(1);
    if (["dashboard", "voice", "history", "test"].includes(hashTab)) setTab(hashTab as Tab);
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setModal(null);
    window.addEventListener("keydown", closeOnEscape);
    void loadSignals();
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      voiceRecognition.current?.stop();
    };
  }, []);

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    window.history.replaceState(null, "", `#${nextTab}`);
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function openCheckIn(targeted = false) {
    setModalTitle(targeted ? "Have any of these symptoms changed?" : "What has changed today?");
    setModalCopy(targeted ? "Your recent medication change and 10-day trend make a targeted check-in useful. Select all that apply." : "Select every new or worsening symptom. This adds context; it does not diagnose a flare.");
    setSelectedSymptoms([]);
    setSavePrompt("Save check-in");
    setCheckInSaved(false);
    setModal("checkin");
  }

  function openInformation(title: string, copy: string, body: string) {
    setModalTitle(title);
    setModalCopy(copy);
    setModalBody(body);
    setModal("info");
  }

  function toggleSymptom(symptom: string) {
    if (symptom === "No new symptoms") {
      setSelectedSymptoms([symptom]);
      return;
    }
    setSelectedSymptoms((current) => current.includes(symptom)
      ? current.filter((item) => item !== symptom)
      : [...current.filter((item) => item !== "No new symptoms"), symptom]);
  }

  async function saveCheckIn() {
    if (!selectedSymptoms.length) {
      setSavePrompt("Select at least one option");
      window.setTimeout(() => setSavePrompt("Save check-in"), 1500);
      return;
    }
    setSavePrompt("Saving…");
    try {
      const response = await fetch("/api/check-ins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symptoms: selectedSymptoms })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to save this check-in.");
      setCheckInSaved(true);
      setModalTitle("Check-in saved");
      setModalCopy("This has been added to your longitudinal record.");
      void loadSignals();
    } catch (error) {
      setSavePrompt(error instanceof Error ? error.message : "Unable to save check-in");
      window.setTimeout(() => setSavePrompt("Save check-in"), 2200);
    }
  }

  function speakVoice(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.rate = 0.96;
    window.speechSynthesis.speak(utterance);
  }

  function stopVoiceListening() {
    voiceRecognition.current?.stop();
    voiceRecognition.current = null;
    setVoiceListening(false);
  }

  function openVoiceCheckIn() {
    const openingQuestion = voiceQuestions[0]!;
    setModalTitle("Start a voice symptom check-in");
    setModalCopy("Use your microphone to answer a few short questions. This supports monitoring; it does not diagnose a flare.");
    setVoiceTurns([{ speaker: "unflare", text: openingQuestion }]);
    setVoiceQuestionIndex(0);
    setVoiceStatus("Tap Listen & answer when you are ready.");
    setVoiceComplete(false);
    setModal("voice");
    window.setTimeout(() => speakVoice(openingQuestion), 100);
  }

  function finishVoiceCheckIn(message = "Thank you. This check-in is ready to review alongside your timeline.") {
    stopVoiceListening();
    setVoiceComplete(true);
    setVoiceStatus(message);
    setVoiceTurns((turns) => [...turns, { speaker: "unflare", text: message }]);
    speakVoice(message);
  }

  function handleVoiceAnswer(answer: string) {
    setVoiceTurns((turns) => [...turns, { speaker: "you", text: answer }]);
    const urgent = urgentVoiceMessage(answer);
    if (urgent) {
      stopVoiceListening();
      setVoiceComplete(true);
      setVoiceStatus("Urgent guidance shown.");
      setVoiceTurns((turns) => [...turns, { speaker: "unflare", text: urgent }]);
      speakVoice(urgent);
      return;
    }

    const nextIndex = voiceQuestionIndex + 1;
    if (nextIndex >= voiceQuestions.length) {
      finishVoiceCheckIn();
      return;
    }
    const nextQuestion = voiceQuestions[nextIndex]!;
    setVoiceQuestionIndex(nextIndex);
    setVoiceStatus("Answer recorded. Tap Listen & answer for the next question.");
    setVoiceTurns((turns) => [...turns, { speaker: "unflare", text: nextQuestion }]);
    speakVoice(nextQuestion);
  }

  function startVoiceListening() {
    if (voiceComplete) {
      setModal(null);
      return;
    }
    const speechWindow = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceStatus("Voice recognition is not available in this browser. Try Chrome or Edge for this demo.");
      return;
    }

    window.speechSynthesis?.cancel();
    const recognition = new Recognition();
    voiceRecognition.current = recognition;
    recognition.lang = "en-GB";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const answer = result?.[0]?.transcript.trim();
      if (answer) handleVoiceAnswer(answer);
    };
    recognition.onerror = (event) => {
      setVoiceListening(false);
      setVoiceStatus(event.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser settings and try again." : "I could not hear that. Please try again.");
    };
    recognition.onend = () => {
      voiceRecognition.current = null;
      setVoiceListening(false);
    };
    setVoiceListening(true);
    setVoiceStatus("Listening… speak when you are ready.");
    recognition.start();
  }

  async function sendWhatsAppTestMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = whatsAppTestMessage.trim();
    if (!message || whatsAppTestSending) return;

    setWhatsAppTestSending(true);
    setWhatsAppTestStatus("Sending through the local WhatsApp simulator…");
    setWhatsAppTestTurns((turns) => [...turns, { speaker: "you", text: message }]);
    setWhatsAppTestMessage("");
    try {
      const response = await fetch("/api/test/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: whatsAppTestNumber, message })
      });
      const data = await response.json() as { response?: string; error?: string; session?: { status?: string } };
      if (!response.ok || !data.response) throw new Error(data.error ?? "The simulator could not process that message.");
      setWhatsAppTestTurns((turns) => [...turns, { speaker: "unflare", text: data.response! }]);
      setWhatsAppTestStatus(data.session?.status === "urgent" ? "Urgent-symptom pathway triggered." : "Message processed by the local simulator.");
    } catch (error) {
      setWhatsAppTestStatus(error instanceof Error ? error.message : "The simulator could not be reached. Start the API with npm run dev.");
    } finally {
      setWhatsAppTestSending(false);
    }
  }

  function resetWhatsAppTest() {
    setWhatsAppTestTurns([]);
    setWhatsAppTestMessage("");
    setWhatsAppTestStatus("Conversation cleared. Send START to begin a new simulated check-in.");
  }

  const active = conversations[activeConversation];
  const savedUrgent = selectedSymptoms.some((symptom) => ["Breathing or chest symptoms", "Urine changes", "Numbness or weakness"].includes(symptom));

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand" aria-label="Unflare"><span className="brand-mark">u</span><span>unflare</span></div>
      <nav>
        <button className={`nav-item ${tab === "dashboard" ? "active" : ""}`} onClick={() => selectTab("dashboard")}><span>⌂</span> Dashboard</button>
        <button className={`nav-item ${tab === "voice" ? "active" : ""}`} onClick={() => selectTab("voice")}><span>◉</span> Voice check-in</button>
        <button className={`nav-item ${tab === "history" ? "active" : ""}`} onClick={() => selectTab("history")}><span>◷</span> History</button>
        <button className={`nav-item ${tab === "test" ? "active" : ""}`} onClick={() => selectTab("test")}><span>◉</span> Test</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="device-card"><span className="device-icon">⌚</span><div><strong>Apple Watch</strong><small><i /> Synced 4m ago</small></div></div>
        <div className="profile"><div className="avatar">AM</div><div><strong>Alex Morgan</strong><small>alex@example.com</small></div></div>
      </div>
    </aside>

    <main>
      {tab === "dashboard" && (() => {
        const warning = signals?.flareEarlyWarning;
        const copy = attentionCopy[warning?.level ?? "low"];
        const findingsCount = signals ? (signals.slowBurn ? 1 : 0) + signals.taperRisk.length + signals.delayedCorrelation.length : 0;
        const leadText = !signals
          ? "Loading your monitoring signals…"
          : warning && warning.rationale.length > 0
            ? warning.rationale[0]
            : "Your recent check-ins, wearable data, and results are within your usual pattern.";
        const careTeamSummaryBody = warning
          ? `${copy.headline}\n\n${warning.rationale.join("\n\n")}`
          : "No supporting evidence is available yet.";
        const recommendation = signals?.recommendation;
        return <>
          <header>
            <div><p className="eyebrow">SATURDAY, 18 JULY · GPA MONITORING</p><h1>Good morning, Alex.</h1><p>Your monitoring update for today.</p></div>
            <span className="demo-pill">SIMULATED DATA</span>
          </header>
          <section className="attention-panel" aria-labelledby="attention-title">
            <div className="attention-panel-heading"><div><p className="eyebrow">CURRENT ATTENTION LEVEL</p><h2 id="attention-title">{copy.headline}</h2></div><span className={`status-pill ${copy.pillClass}`}>{copy.pillText}</span></div>
            <p className="attention-lead">{leadText}</p>
            <div className="dashboard-actions"><button className="primary-button" disabled={summaryReady} onClick={() => { setSummaryReady(true); showToast("✓ Care-team summary prepared"); openInformation("Care-team summary ready", "This summary organises the evidence behind your current attention level; it does not diagnose a flare.", careTeamSummaryBody); }}>{summaryReady ? "Summary ready to share" : "Prepare care-team summary"}</button><button className="secondary-button" onClick={() => openCheckIn(true)}>Complete targeted check-in</button></div>
            <div className="evidence-summary" aria-label="Key evidence"><span><b>{findingsCount}</b> signals detected</span><span><b>{warning?.score ?? 0}</b> risk score</span></div>
            <p className="attention-guidance">{recommendation ? <><b>{recommendation.headline}.</b> {recommendation.detail}</> : "Loading a recommended next step…"}</p>
            {signalsError && <p className="signals-error">{signalsError}</p>}
          </section>
          <details className="supporting-details">
            <summary><span>Why this attention level</span><small>Symptom trends, medication timing, and recent results</small></summary>
            <div className="supporting-content">
              <section className="section-block" aria-label="Slow, gradual symptom trend">
                <div className="section-title"><div><h2>Slow-burn symptom trend</h2><p>Vague symptoms tracked over a rolling two-week window.</p></div></div>
                {signals?.slowBurn ? <div className="finding-list"><article className="finding-card"><p>{signals.slowBurn.summary}</p><div className="evidence">{signals.slowBurn.evidence.map((item, index) => <span key={index}>{evidenceLabel(item)}</span>)}</div></article></div> : <p className="signals-empty">No rising trend of vague symptoms detected in the recent window.</p>}
              </section>
              <section className="section-block" aria-label="Medication taper correlation">
                <div className="section-title"><div><h2>Medication taper timing</h2><p>Symptom changes in the weeks after a steroid dose change.</p></div></div>
                {signals && signals.taperRisk.length > 0 ? <div className="finding-list">{signals.taperRisk.map((finding) => <article className="finding-card" key={finding.code + finding.evidence[0]?.recordId}><p>{finding.summary}</p><div className="evidence">{finding.evidence.map((item, index) => <span key={index}>{evidenceLabel(item)}</span>)}</div></article>)}</div> : <p className="signals-empty">No symptom changes have followed a recent medication taper.</p>}
              </section>
              <section className="section-block" aria-label="Delayed infection or stress correlation">
                <div className="section-title"><div><h2>Infection and stress context</h2><p>Earlier context that may relate to a later symptom change — not a confirmed cause.</p></div></div>
                {signals && signals.delayedCorrelation.length > 0 ? <div className="finding-list">{signals.delayedCorrelation.map((finding) => <article className="finding-card" key={finding.code + finding.evidence[0]?.recordId}><p>{finding.summary}</p><div className="evidence">{finding.evidence.map((item, index) => <span key={index}>{evidenceLabel(item)}</span>)}</div></article>)}</div> : <p className="signals-empty">No infection or stress context precedes a later symptom change.</p>}
              </section>
              {signals && signals.sideEffects.length > 0 && <section className="section-block" aria-label="Side effect versus disease activity">
                <div className="section-title"><div><h2>Symptom vs. medication timing</h2><p>Whether a symptom lines up with a recent dose, or with other screening symptoms instead.</p></div></div>
                <div className="finding-list">{signals.sideEffects.map((item, index) => <article className="finding-card" key={index}><p><b>{item.symptomName}</b> — {item.classification === "likely-side-effect" ? "likely side effect" : item.classification === "possible-disease-activity" ? "possible disease activity" : "unclear"}</p><div className="evidence">{item.evidence.map((evidenceItem, evidenceIndex) => <span key={evidenceIndex}>{evidenceLabel(evidenceItem)}</span>)}</div></article>)}</div>
              </section>}
            </div>
          </details>
          <aside className="safety-note"><span>i</span><p><strong>Unflare supports monitoring; it does not diagnose a flare.</strong> If you develop severe breathing difficulty, cough up blood, see blood in your urine, have marked weakness, or feel rapidly worse, seek urgent medical help.</p></aside>
        </>;
      })()}

      {tab === "voice" && <>
        <header className="voice-page-header"><div><p className="eyebrow">GUIDED VOICE CHECK-IN</p><h1>Talk through how you&apos;re feeling.</h1><p>Answer a few short questions by voice to add context to your monitoring record.</p></div><span className="demo-pill">BROWSER MICROPHONE</span></header>
        <section className="voice-start-card" aria-labelledby="voice-start-title"><div><span className="voice-start-icon">◌</span><p className="eyebrow">ABOUT 2 MINUTES</p><h2 id="voice-start-title">Start a voice check-in</h2><p>Unflare will ask about changes from your usual self, infections, symptoms, and medication. It supports monitoring and does not diagnose a flare.</p><button className="primary-button" onClick={openVoiceCheckIn}>Start voice check-in</button></div><aside><h3>Before you begin</h3><ul><li>Find a quiet place and allow microphone access.</li><li>Answer in your own words; you can end the check-in at any time.</li><li>For severe or rapidly worsening symptoms, seek urgent medical help.</li></ul></aside></section>
      </>}

      {tab === "history" && <>
        <header className="history-header"><div><p className="eyebrow">LONGITUDINAL RECORD</p><h1>Check-in history</h1><p>Review past call and chat transcripts alongside their recorded context.</p></div></header>
        <section className="history-layout"><div className="conversation-list"><div className="history-filters">{(["all", "call", "chat"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? "All" : `${item.charAt(0).toUpperCase()}${item.slice(1)}s`}</button>)}</div>{(Object.entries(conversations) as [ConversationKey, typeof conversations[ConversationKey]][]).filter(([, conversation]) => filter === "all" || conversation.kind === filter).map(([key, conversation]) => <button key={key} className={`conversation ${activeConversation === key ? "active" : ""}`} onClick={() => setActiveConversation(key)}><span className={`conversation-icon ${conversation.kind}`}>{conversation.kind === "call" ? "☎" : "✦"}</span><span><strong>{conversation.title}</strong><small>{conversation.meta}</small><em>{conversation.excerpt}</em></span><b>›</b></button>)}</div>
          <article className="transcript-card"><div className="transcript-head"><div><span className={`conversation-icon ${active.kind}`}>{active.kind === "call" ? "☎" : "✦"}</span><div><h2>{active.title}</h2><p>{active.detailMeta}</p></div></div></div><div className="summary-box"><p className="eyebrow">CHECK-IN SUMMARY</p><p>{active.summary}</p><div>{active.tags.map(([label, value, className]) => <span key={label}>{label} <b className={className}>{value}</b></span>)}</div></div><div className="messages">{active.messages.map(([speaker, message], index) => <div key={index} className={`message ${speaker === "you" ? "user" : "ai"}`}><small>{speaker === "you" ? "YOU" : "UNFLARE"}</small><p>{message}</p></div>)}</div></article>
        </section>
      </>}

      {tab === "test" && <>
        <header className="test-header"><div><p className="eyebrow">DEVELOPMENT TOOL</p><h1>Test WhatsApp messages</h1><p>Exercise the WhatsApp check-in flow without sending a message through Twilio.</p></div><span className="demo-pill">LOCAL SIMULATOR</span></header>
        <section className="whatsapp-test-layout" aria-label="WhatsApp message simulator">
          <article className="whatsapp-test-card">
            <div className="test-card-heading"><div><span className="whatsapp-test-icon">◉</span><div><h2>WhatsApp simulator</h2><p>Uses the same consent, safety, and follow-up logic as the inbound webhook.</p></div></div><button className="text-button" type="button" onClick={resetWhatsAppTest}>Clear chat</button></div>
            <div className="whatsapp-test-notice"><span>i</span><p>No message is sent to WhatsApp or Twilio. This tool is available only while running the local development API.</p></div>
            <p className="test-sender"><span>Test sender</span><b>{whatsAppTestNumber}</b></p>
            <div className="whatsapp-test-messages" aria-live="polite">
              {whatsAppTestTurns.length === 0 && <p className="whatsapp-test-empty">Try <b>START</b>, then <b>YES</b>, followed by a symptom response. Use an urgent phrase to verify the safety pathway.</p>}
              {whatsAppTestTurns.map((turn, index) => <div className={`whatsapp-test-turn ${turn.speaker}`} key={`${turn.speaker}-${index}`}><small>{turn.speaker === "you" ? "TEST SENDER" : "UNFLARE"}</small><p>{turn.text}</p></div>)}
            </div>
            <form className="whatsapp-test-form" onSubmit={sendWhatsAppTestMessage}>
              <label htmlFor="whatsapp-test-message">Message</label>
              <div><input id="whatsapp-test-message" value={whatsAppTestMessage} onChange={(event) => setWhatsAppTestMessage(event.target.value)} placeholder="Type a WhatsApp message…" disabled={whatsAppTestSending} /><button className="primary-button whatsapp-button" type="submit" disabled={!whatsAppTestMessage.trim() || whatsAppTestSending}>{whatsAppTestSending ? "Sending…" : "Send"}</button></div>
            </form>
            <p className="whatsapp-test-status" role="status">{whatsAppTestStatus}</p>
          </article>
          <aside className="whatsapp-test-guide"><p className="eyebrow">QUICK TEST SCRIPT</p><h2>Verify the full check-in flow.</h2><ol><li>Send <b>START</b> to receive the consent request.</li><li>Send <b>YES</b> to begin the check-in.</li><li>Send a symptom update, then <b>DONE</b>.</li></ol><p>For safety testing, use a supported urgent phrase such as “I am coughing up blood”. The simulator will show the urgent-care response and close that test session.</p></aside>
        </section>
      </>}
    </main>

    {modal && <div className="modal open" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-backdrop" aria-label="Close dialog" onClick={() => { stopVoiceListening(); setModal(null); }} /><div className="modal-panel"><button className="close-button" aria-label="Close" onClick={() => { stopVoiceListening(); setModal(null); }}>×</button><span className="modal-symbol">✦</span><p className="eyebrow">{modal === "checkin" ? "AAV SYMPTOM CHECK-IN" : modal === "voice" ? "BROWSER VOICE CHECK-IN" : "UNFLARE INSIGHT"}</p><h2 id="modal-title">{modalTitle}</h2><p>{modalCopy}</p>
      {modal === "checkin" && !checkInSaved && <div className="symptom-options">{symptoms.map((symptom) => <button key={symptom} className={selectedSymptoms.includes(symptom) ? "selected" : ""} onClick={() => toggleSymptom(symptom)}>{symptom === "Sinus or nasal symptoms" ? "Sinus or nasal" : symptom === "Joint or muscle pain" ? "Joint or muscle pain" : symptom === "Breathing or chest symptoms" ? "Breathing or chest" : symptom === "Rash or skin changes" ? "Rash or skin" : symptom}</button>)}<button className="modal-confirm save-symptoms" onClick={saveCheckIn}>{savePrompt}</button></div>}
      {modal === "checkin" && checkInSaved && <><div className={`saved-symptoms ${savedUrgent ? "urgent" : ""}`}>{selectedSymptoms.includes("No new symptoms") ? "No new or worsening symptoms were reported." : `Recorded: ${selectedSymptoms.join(", ")}.`}{savedUrgent ? " Because this includes a potentially important change, contact your care team promptly. If it is severe or rapidly worsening, seek urgent medical help." : ""} Unflare will compare this check-in with your medication timeline, clinical data, and personal baseline.</div><button className="modal-confirm" onClick={() => setModal(null)}>Done</button></>}
      {modal === "info" && <><div className="saved-symptoms">{modalBody}</div><button className="modal-confirm" onClick={() => setModal(null)}>Got it</button></>}
      {modal === "voice" && <div className="voice-checkin"><div className="voice-transcript" aria-live="polite">{voiceTurns.map((turn, index) => <div className={`voice-turn ${turn.speaker}`} key={`${turn.speaker}-${index}`}><small>{turn.speaker === "you" ? "YOU" : "UNFLARE"}</small><p>{turn.text}</p></div>)}</div><p className="voice-status" aria-live="polite">{voiceStatus}</p><div className="voice-actions"><button className="modal-confirm" type="button" onClick={startVoiceListening} disabled={voiceListening}>{voiceComplete ? "Close check-in" : voiceListening ? "Listening…" : "Listen & answer"}</button>{!voiceComplete && <button className="voice-end-button" type="button" onClick={() => finishVoiceCheckIn("Check-in ended. This short transcript can be reviewed with your timeline.")}>End check-in</button>}</div></div>}
      {(modal === "checkin" && !checkInSaved) && <p className="modal-safety">For severe or rapidly worsening symptoms, seek urgent medical help instead of waiting for the app.</p>}
      {modal === "voice" && <p className="modal-safety">For severe or rapidly worsening symptoms, seek urgent medical help instead of waiting for the app.</p>}
    </div></div>}
    <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
  </div>;
}
