"use client";

import { useEffect, useRef, useState } from "react";

type Tab = "dashboard" | "voice" | "history" | "test";
type ModalMode = "checkin" | "info" | "voice";
type VoiceTurn = { speaker: "unflare" | "you"; text: string };
type StoredTurn = { id: string; role: "patient" | "assistant"; text: string; createdAt: string };
type StoredCheckIn = {
  id: string;
  channel: "phone" | "whatsapp" | "app";
  status: "queued" | "ringing" | "in-progress" | "completed" | "declined" | "urgent" | "failed";
  createdAt: string;
  turns: StoredTurn[];
  safetyFlags: Array<{ code: string; evidence: string }>;
  summary?: {
    summary: string;
    attentionLevel?: "continue_monitoring" | "care_team_review" | "urgent_guidance";
    recommendedNextStep?: string;
  };
};

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
  const [history, setHistory] = useState<StoredCheckIn[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<"all" | StoredCheckIn["channel"]>("all");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [summaryCheckInId, setSummaryCheckInId] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [voiceTurns, setVoiceTurns] = useState<VoiceTurn[]>([]);
  const [voiceQuestionIndex, setVoiceQuestionIndex] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceComplete, setVoiceComplete] = useState(false);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState("auto");
  const [voiceRate, setVoiceRate] = useState(0.92);
  const [voicePitch, setVoicePitch] = useState(1);
  const whatsAppTestNumber = "+447492368087";
  const [whatsAppDemoStatus, setWhatsAppDemoStatus] = useState("");
  const [whatsAppDemoStarting, setWhatsAppDemoStarting] = useState(false);
  const voiceRecognition = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    const hashTab = window.location.hash.slice(1);
    if (["dashboard", "voice", "history", "test"].includes(hashTab)) setTab(hashTab as Tab);
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setModal(null);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      voiceRecognition.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => setAvailableVoices(window.speechSynthesis.getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith("en")));
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  useEffect(() => {
    if (tab === "history") void loadHistory();
  }, [tab]);

  useEffect(() => {
    const filtered = history.filter((checkIn) => historyFilter === "all" || checkIn.channel === historyFilter);
    const selected = filtered.find((checkIn) => checkIn.id === activeHistoryId) ?? filtered[0];
    if (tab !== "history" || !selected || selected.summary?.recommendedNextStep || summaryCheckInId || summaryError) return;
    void generateHistorySummary(selected.id);
  }, [tab, history, historyFilter, activeHistoryId, summaryCheckInId, summaryError]);

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    window.history.replaceState(null, "", `#${nextTab}`);
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch("/api/check-ins");
      const data = await response.json() as { checkIns?: StoredCheckIn[]; error?: string };
      if (!response.ok || !data.checkIns) throw new Error(data.error ?? "Could not load your saved check-ins.");
      setHistory(data.checkIns);
      setActiveHistoryId((current) => current && data.checkIns!.some((checkIn) => checkIn.id === current) ? current : data.checkIns![0]?.id ?? null);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Could not load your saved check-ins.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function generateHistorySummary(checkInId: string) {
    if (summaryCheckInId) return;
    setSummaryCheckInId(checkInId);
    setSummaryError("");
    try {
      const response = await fetch(`/api/check-ins/${checkInId}/summary`, { method: "POST" });
      const data = await response.json() as { checkIn?: StoredCheckIn; error?: string };
      if (!response.ok || !data.checkIn) throw new Error(data.error ?? "The AI summary could not be generated.");
      setHistory((current) => current.map((checkIn) => checkIn.id === checkInId ? data.checkIn! : checkIn));
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "The AI summary could not be generated.");
    } finally {
      setSummaryCheckInId(null);
    }
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

  function saveCheckIn() {
    if (!selectedSymptoms.length) {
      setSavePrompt("Select at least one option");
      window.setTimeout(() => setSavePrompt("Save check-in"), 1500);
      return;
    }
    setCheckInSaved(true);
    setModalTitle("Check-in saved");
    setModalCopy("This has been added to your longitudinal record.");
  }

  function preferredVoice() {
    if (selectedVoiceName !== "auto") return availableVoices.find((voice) => voice.name === selectedVoiceName);
    return availableVoices.find((voice) => voice.lang.toLowerCase() === "en-gb" && /(natural|siri|google|microsoft)/i.test(voice.name))
      ?? availableVoices.find((voice) => voice.lang.toLowerCase() === "en-gb")
      ?? availableVoices[0];
  }

  function speakVoice(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = preferredVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "en-GB";
    }
    utterance.rate = voiceRate;
    utterance.pitch = voicePitch;
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
    setVoiceSaving(false);
    setModal("voice");
    // Keep this in the click handler so browsers that require a user gesture allow speech.
    speakVoice(openingQuestion);
  }

  async function saveVoiceTranscript(turns: VoiceTurn[]) {
    setVoiceSaving(true);
    stopVoiceListening();
    try {
      const response = await fetch("/api/check-ins/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns })
      });
      const data = await response.json() as { error?: string; summaryGenerated?: boolean };
      if (!response.ok) throw new Error(data.error ?? "The transcript could not be saved.");
      setVoiceStatus(data.summaryGenerated ? "Check-in and AI summary saved to History." : "Check-in saved to History. AI summary is unavailable until the model is configured.");
      void loadHistory();
    } catch (error) {
      setVoiceStatus(error instanceof Error ? `${error.message} Please try again.` : "The transcript could not be saved. Please try again.");
    } finally {
      setVoiceSaving(false);
    }
  }

  function finishVoiceCheckIn(message = "Thank you. This check-in is ready to review alongside your timeline.", completedTurns = voiceTurns) {
    stopVoiceListening();
    setVoiceComplete(true);
    const finalTurns = [...completedTurns, { speaker: "unflare" as const, text: message }];
    setVoiceTurns(finalTurns);
    setVoiceStatus("Saving your check-in…");
    speakVoice(message);
    void saveVoiceTranscript(finalTurns);
  }

  function handleVoiceAnswer(answer: string) {
    const turnsWithAnswer = [...voiceTurns, { speaker: "you" as const, text: answer }];
    setVoiceTurns(turnsWithAnswer);
    const urgent = urgentVoiceMessage(answer);
    if (urgent) {
      stopVoiceListening();
      setVoiceComplete(true);
      const urgentTurns = [...turnsWithAnswer, { speaker: "unflare" as const, text: urgent }];
      setVoiceStatus("Urgent guidance shown. Saving this check-in…");
      setVoiceTurns(urgentTurns);
      speakVoice(urgent);
      void saveVoiceTranscript(urgentTurns);
      return;
    }

    const nextIndex = voiceQuestionIndex + 1;
    if (nextIndex >= voiceQuestions.length) {
      finishVoiceCheckIn(undefined, turnsWithAnswer);
      return;
    }
    const nextQuestion = voiceQuestions[nextIndex]!;
    const acknowledgement = "Thanks, I’ve recorded that.";
    setVoiceQuestionIndex(nextIndex);
    setVoiceStatus("Answer recorded. Unflare is asking the next question.");
    setVoiceTurns([...turnsWithAnswer, { speaker: "unflare", text: acknowledgement }, { speaker: "unflare", text: nextQuestion }]);
    speakVoice(`${acknowledgement} ${nextQuestion}`);
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

  async function beginWhatsAppDemo() {
    if (whatsAppDemoStarting) return;
    setWhatsAppDemoStarting(true);
    setWhatsAppDemoStatus("Starting your WhatsApp check-in…");
    try {
      const response = await fetch("/api/whatsapp/demo", { method: "POST" });
      const data = await response.json() as { error?: string; recipient?: string };
      if (!response.ok) throw new Error(data.error ?? "WhatsApp could not be started.");
      setWhatsAppDemoStatus(`Demo started. Check WhatsApp on ${data.recipient ?? whatsAppTestNumber} and reply YES to continue.`);
    } catch (error) {
      setWhatsAppDemoStatus(error instanceof Error ? error.message : "WhatsApp could not be started.");
    } finally {
      setWhatsAppDemoStarting(false);
    }
  }

  const filteredHistory = history.filter((checkIn) => historyFilter === "all" || checkIn.channel === historyFilter);
  const activeCheckIn = filteredHistory.find((checkIn) => checkIn.id === activeHistoryId) ?? filteredHistory[0];
  const savedUrgent = selectedSymptoms.some((symptom) => ["Breathing or chest symptoms", "Urine changes", "Numbness or weakness"].includes(symptom));

  function checkInTitle(checkIn: StoredCheckIn) {
    if (checkIn.channel === "whatsapp") return "WhatsApp check-in";
    if (checkIn.channel === "phone") return "Phone check-in";
    return "Voice check-in";
  }

  function checkInIcon(checkIn: StoredCheckIn) {
    return checkIn.channel === "phone" ? "☎" : checkIn.channel === "whatsapp" ? "◉" : "◌";
  }

  function checkInExcerpt(checkIn: StoredCheckIn) {
    return [...checkIn.turns].reverse().find((turn) => turn.role === "patient")?.text ?? checkIn.summary?.summary ?? "No responses recorded.";
  }

  function formatCheckInDate(value: string) {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function attentionLabel(level: NonNullable<StoredCheckIn["summary"]>["attentionLevel"]) {
    return level === "urgent_guidance" ? "Urgent guidance" : level === "care_team_review" ? "Care-team review" : "Continue monitoring";
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand" aria-label="Unflare"><span className="brand-mark">u</span><span>unflare</span></div>
      <nav>
        <button className={`nav-item ${tab === "dashboard" ? "active" : ""}`} onClick={() => selectTab("dashboard")}><span>⌂</span> Dashboard</button>
        <button className={`nav-item ${tab === "voice" ? "active" : ""}`} onClick={() => selectTab("voice")}><span>◉</span> Voice check-in</button>
        <button className={`nav-item ${tab === "history" ? "active" : ""}`} onClick={() => selectTab("history")}><span>◷</span> History</button>
        <button className={`nav-item ${tab === "test" ? "active" : ""}`} onClick={() => selectTab("test")}><span>◉</span> WhatsApp (beta)</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="device-card"><span className="device-icon">⌚</span><div><strong>Apple Watch</strong><small><i /> Synced 4m ago</small></div></div>
        <div className="profile"><div className="avatar">AM</div><div><strong>Alex Morgan</strong><small>alex@example.com</small></div></div>
      </div>
    </aside>

    <main className={tab === "dashboard" ? "dashboard-main" : undefined}>
      {tab === "dashboard" && <>
        <header className="dashboard-header">
          <div><p className="eyebrow">SATURDAY, 18 JULY · GPA MONITORING</p><h1>Good morning, Alex.</h1><p>Your monitoring update for today.</p></div>
          <span className="demo-pill">SIMULATED DATA</span>
        </header>
        <div className="dashboard-grid">
        <section className="attention-panel" aria-labelledby="attention-title">
          <div className="attention-panel-heading"><div><p className="eyebrow">CURRENT ATTENTION LEVEL</p><h2 id="attention-title">Care-team review recommended.</h2></div><span className="status-pill attention">● Needs attention</span></div>
          <p className="attention-lead">Small changes have continued for 10 days after your prescribed prednisone reduction. This deserves review, but does not confirm a flare.</p>
          <section className="why-attention" aria-labelledby="why-attention-title">
            <div className="why-attention-heading"><div><p className="eyebrow">WHY THIS NEEDS ATTENTION</p><h3 id="why-attention-title">Several changes are moving together.</h3></div><span>10-day pattern</span></div>
            <div className="why-reasons" aria-label="Reasons for care-team review">
              <article><span className="reason-icon">Rx</span><div><b>Medication context</b><p>Prednisone was reduced from 10 mg to 7.5 mg on 9 July.</p></div></article>
              <article><span className="reason-icon">3</span><div><b>Symptoms changed</b><p>Fatigue, joint aches, and sinus pressure have increased.</p></div></article>
              <article><span className="reason-icon">↓</span><div><b>Function shifted</b><p>Daily activity is 32% below your usual level.</p></div></article>
              <article><span className="reason-icon">↑</span><div><b>Body signal changed</b><p>Resting heart rate is 14% above your baseline.</p></div></article>
            </div>
            <p className="why-context">A recent respiratory infection is relevant context. These signals need clinical interpretation; they do not diagnose a flare.</p>
          </section>
          <div className="dashboard-actions"><button className="primary-button" disabled={summaryReady} onClick={() => { setSummaryReady(true); showToast("✓ Care-team summary prepared"); openInformation("Care-team summary ready", "This summary organises the simulated evidence for review; it does not diagnose a flare.", "10-day sustained change\n\nPrednisone reduced from 10 mg to 7.5 mg on 9 July. Fatigue, mild joint aches, and sinus pressure increased. Daily activity fell 32% and resting heart rate rose 14% from baseline. Adherence: 96%. Recent respiratory infection reported. No urgent warning symptoms reported in today’s check-in.\n\nSuggested action: care-team review."); }}>{summaryReady ? "Summary ready to share" : "Prepare care-team summary"}</button><button className="secondary-button" onClick={() => openCheckIn(true)}>Complete targeted check-in</button></div>
          <p className="attention-guidance">Keep taking medication as prescribed unless your care team advises otherwise.</p>
        </section>
        <section className="supporting-details" aria-labelledby="monitoring-details-title">
          <div className="monitoring-details-heading"><div><p className="eyebrow">MONITORING DETAILS</p><h2 id="monitoring-details-title">The supporting record</h2></div><p>Medication, symptoms, trends, and recent results</p></div>
          <div className="supporting-content">
            <section className="medication-context" aria-label="Medication context"><div><p className="eyebrow">MEDICATION CONTEXT</p><h2>Prednisone was reduced from 10 mg to 7.5 mg on 9 July.</h2><p>Fatigue, joint aches, and sinus pressure have increased since. A recent respiratory infection is also relevant context.</p></div><div className="context-stats"><span>Current dose <b>7.5 mg</b></span><span>Adherence <b>96%</b></span></div></section>
            <section className="section-block"><div className="section-title"><div><h2>Signals compared with your usual pattern</h2><p>These signals do not diagnose a flare.</p></div></div><div className="metric-grid"><article className="metric-card"><div className="metric-title"><span>Daily activity</span><em className="alert-tag">Shifted</em></div><strong>5,320 <small>steps/day</small></strong><div className="bars falling" aria-label="Activity declining over seven days"><i style={{ height: "88%" }} /><i style={{ height: "80%" }} /><i style={{ height: "73%" }} /><i style={{ height: "64%" }} /><i style={{ height: "56%" }} /><i className="today" style={{ height: "48%" }} /><i className="future" /></div><div className="chart-labels"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><p><b className="down">↓ 32%</b> below your usual level</p></article><article className="metric-card"><div className="metric-title"><span>Reported symptoms</span><em className="alert-tag">Increasing</em></div><div className="symptom-list"><div><span>Fatigue</span><b>Moderate · ↑</b></div><div><span>Joint aches</span><b>Mild · New</b></div><div><span>Sinus pressure</span><b>Persistent</b></div></div><p><b className="down">3 changes</b> across recent check-ins</p></article><article className="metric-card"><div className="metric-title"><span>Resting heart rate</span><em className="watch">Watch</em></div><strong>71 <small>bpm today</small></strong><svg className="line-chart warm-chart" viewBox="0 0 300 96" role="img" aria-label="Resting heart rate rising over seven days"><path className="area" d="M0 72 L50 68 L100 61 L150 55 L200 41 L250 31 L300 25 L300 96 L0 96Z" /><path className="line" d="M0 72 L50 68 L100 61 L150 55 L200 41 L250 31 L300 25" /><line x1="0" y1="62" x2="300" y2="62" /></svg><p><b className="down">↑ 14%</b> above your baseline of 62 bpm</p></article></div></section>
            <section className="clinical-strip" aria-label="Latest clinical data"><div><p className="eyebrow">SIMULATED CLINICAL DATA · 16 JULY</p><h2>Recent results are available to your care team.</h2><p>Wearable data cannot confirm or rule out active vasculitis. Clinical review and clinician-ordered tests remain essential.</p></div><div className="clinical-values"><span>Creatinine <b>89 µmol/L</b><small>Stable</small></span><span>Urine blood <b>Negative</b><small>Dip test</small></span><span>CRP <b>8 mg/L</b><small>From 3 mg/L</small></span></div></section>
          </div>
        </section>
        </div>
        <aside className="safety-note"><span>i</span><p><strong>Unflare supports monitoring; it does not diagnose a flare.</strong> If you develop severe breathing difficulty, cough up blood, see blood in your urine, have marked weakness, or feel rapidly worse, seek urgent medical help.</p></aside>
      </>}

      {tab === "voice" && <>
        <header className="voice-page-header"><div><p className="eyebrow">GUIDED VOICE CHECK-IN</p><h1>Talk through how you&apos;re feeling.</h1><p>Answer a few short questions by voice to add context to your monitoring record.</p></div><span className="demo-pill">BROWSER MICROPHONE</span></header>
        <section className="voice-start-card" aria-labelledby="voice-start-title"><div><span className="voice-start-icon">◌</span><p className="eyebrow">ABOUT 2 MINUTES</p><h2 id="voice-start-title">Start a voice check-in</h2><p>Unflare will ask about changes from your usual self, infections, symptoms, and medication. It supports monitoring and does not diagnose a flare.</p><button className="primary-button" onClick={openVoiceCheckIn}>Start voice check-in</button></div><aside><h3>Voice &amp; pace</h3><p className="voice-settings-copy">Choose a voice installed on this device. A slightly slower pace often sounds more natural.</p><label className="voice-setting"><span>Voice</span><select value={selectedVoiceName} onChange={(event) => setSelectedVoiceName(event.target.value)}><option value="auto">Automatic (best available)</option>{availableVoices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} · {voice.lang}</option>)}</select></label><label className="voice-setting"><span>Speaking pace <b>{voiceRate.toFixed(2)}×</b></span><input type="range" min="0.8" max="1.08" step="0.04" value={voiceRate} onChange={(event) => setVoiceRate(Number(event.target.value))} /></label><label className="voice-setting"><span>Pitch <b>{voicePitch.toFixed(1)}</b></span><input type="range" min="0.85" max="1.15" step="0.05" value={voicePitch} onChange={(event) => setVoicePitch(Number(event.target.value))} /></label><button className="voice-preview-button" type="button" onClick={() => speakVoice("Hello, I’m here to guide your check-in. How have you been feeling today?")}>Preview voice</button>{availableVoices.length === 0 && <small className="voice-settings-note">Your browser is still loading its installed voices. The automatic voice will be used.</small>}</aside></section>
      </>}

      {tab === "history" && <>
        <header className="history-header"><div><p className="eyebrow">LONGITUDINAL RECORD</p><h1>Check-in history</h1><p>Review saved voice, WhatsApp, and phone transcripts from your local record.</p></div></header>
        {historyLoading ? <p className="empty-history">Loading saved check-ins…</p> : historyError ? <p className="empty-history">{historyError}</p> : filteredHistory.length === 0 ? <p className="empty-history">No saved check-ins yet. Complete a voice check-in to see its transcript here.</p> : <section className="history-layout"><div className="conversation-list"><div className="history-filters">{(["all", "app", "whatsapp", "phone"] as const).map((item) => <button key={item} className={historyFilter === item ? "active" : ""} onClick={() => setHistoryFilter(item)}>{item === "all" ? "All" : item === "app" ? "Voice" : item === "whatsapp" ? "WhatsApp" : "Phone"}</button>)}</div>{filteredHistory.map((checkIn) => <button key={checkIn.id} className={`conversation ${activeCheckIn?.id === checkIn.id ? "active" : ""}`} onClick={() => setActiveHistoryId(checkIn.id)}><span className={`conversation-icon ${checkIn.channel === "phone" ? "call" : "chat"}`}>{checkInIcon(checkIn)}</span><span><strong>{checkInTitle(checkIn)}</strong><small>{formatCheckInDate(checkIn.createdAt)} · {checkIn.status}</small><em>{checkInExcerpt(checkIn)}</em></span><b>›</b></button>)}</div>
          {activeCheckIn && <article className="transcript-card"><div className="transcript-head"><div><span className={`conversation-icon ${activeCheckIn.channel === "phone" ? "call" : "chat"}`}>{checkInIcon(activeCheckIn)}</span><div><h2>{checkInTitle(activeCheckIn)}</h2><p>{formatCheckInDate(activeCheckIn.createdAt)} · {activeCheckIn.status}</p></div></div></div>{activeCheckIn.summary ? <div className="summary-box"><p className="eyebrow">AI CHECK-IN SUMMARY</p><p>{activeCheckIn.summary.summary}</p>{activeCheckIn.summary.attentionLevel && activeCheckIn.summary.recommendedNextStep && <div><span>Attention <b className={activeCheckIn.summary.attentionLevel === "urgent_guidance" ? "review-risk" : activeCheckIn.summary.attentionLevel === "care_team_review" ? "review-risk" : "low-risk"}>{attentionLabel(activeCheckIn.summary.attentionLevel)}</b></span><span>Next step <b>{activeCheckIn.summary.recommendedNextStep}</b></span></div>}</div> : <div className="summary-request"><div><p className="eyebrow">AI CHECK-IN SUMMARY</p><p>{summaryCheckInId === activeCheckIn.id ? "Generating a transcript-grounded summary…" : "Generating a concise, transcript-grounded summary for this saved check-in."}</p></div>{summaryError && <small>{summaryError}</small>}</div>}<div className="messages">{activeCheckIn.turns.map((turn) => <div key={turn.id} className={`message ${turn.role === "patient" ? "user" : "ai"}`}><small>{turn.role === "patient" ? "YOU" : "UNFLARE"}</small><p>{turn.text}</p></div>)}</div></article>}
        </section>}
      </>}

      {tab === "test" && <>
        <header className="test-header"><div><p className="eyebrow">WHATSAPP DEMO</p><h1>Start a WhatsApp check-in.</h1><p>Send a real WhatsApp message to begin the AI-supported demo conversation.</p></div><span className="demo-pill">TWILIO WHATSAPP</span></header>
        <section className="whatsapp-test-layout" aria-label="WhatsApp demo">
          <article className="whatsapp-test-card">
            <div className="test-card-heading"><div><span className="whatsapp-test-icon">◉</span><div><h2>WhatsApp check-in demo</h2><p>Starts the real consent and follow-up conversation through Twilio.</p></div></div></div>
            <div className="whatsapp-test-notice"><span>i</span><p>Clicking the button sends a real WhatsApp message. Reply in WhatsApp to continue the check-in.</p></div>
            <p className="test-sender"><span>Demo recipient</span><b>{whatsAppTestNumber}</b></p>
            <button className="primary-button whatsapp-button begin-whatsapp-demo" type="button" onClick={beginWhatsAppDemo} disabled={whatsAppDemoStarting}>{whatsAppDemoStarting ? "Starting WhatsApp demo…" : "Begin WhatsApp demo"}</button>
            <p className="whatsapp-test-status" role="status">{whatsAppDemoStatus}</p>
          </article>
          <aside className="whatsapp-test-guide"><p className="eyebrow">HOW IT WORKS</p><h2>Continue the conversation in WhatsApp.</h2><ol><li>Click <b>Begin WhatsApp demo</b>.</li><li>Open WhatsApp on the number shown.</li><li>Reply <b>YES</b>, then answer the questions.</li></ol><p>The number must have joined your Twilio WhatsApp Sandbox, if you are using one. The Twilio inbound-message URL must point to this app&apos;s <code>/twilio/whatsapp</code> endpoint.</p></aside>
        </section>
      </>}
    </main>

    {modal && <div className="modal open" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-backdrop" aria-label="Close dialog" onClick={() => { stopVoiceListening(); setModal(null); }} /><div className="modal-panel"><button className="close-button" aria-label="Close" onClick={() => { stopVoiceListening(); setModal(null); }}>×</button><span className="modal-symbol">✦</span><p className="eyebrow">{modal === "checkin" ? "AAV SYMPTOM CHECK-IN" : modal === "voice" ? "BROWSER VOICE CHECK-IN" : "UNFLARE INSIGHT"}</p><h2 id="modal-title">{modalTitle}</h2><p>{modalCopy}</p>
      {modal === "checkin" && !checkInSaved && <div className="symptom-options">{symptoms.map((symptom) => <button key={symptom} className={selectedSymptoms.includes(symptom) ? "selected" : ""} onClick={() => toggleSymptom(symptom)}>{symptom === "Sinus or nasal symptoms" ? "Sinus or nasal" : symptom === "Joint or muscle pain" ? "Joint or muscle pain" : symptom === "Breathing or chest symptoms" ? "Breathing or chest" : symptom === "Rash or skin changes" ? "Rash or skin" : symptom}</button>)}<button className="modal-confirm save-symptoms" onClick={saveCheckIn}>{savePrompt}</button></div>}
      {modal === "checkin" && checkInSaved && <><div className={`saved-symptoms ${savedUrgent ? "urgent" : ""}`}>{selectedSymptoms.includes("No new symptoms") ? "No new or worsening symptoms were reported." : `Recorded: ${selectedSymptoms.join(", ")}.`}{savedUrgent ? " Because this includes a potentially important change, contact your care team promptly. If it is severe or rapidly worsening, seek urgent medical help." : ""} Unflare will compare this check-in with your medication timeline, clinical data, and personal baseline.</div><button className="modal-confirm" onClick={() => setModal(null)}>Done</button></>}
      {modal === "info" && <><div className="saved-symptoms">{modalBody}</div><button className="modal-confirm" onClick={() => setModal(null)}>Got it</button></>}
      {modal === "voice" && <div className="voice-checkin"><div className="voice-transcript" aria-live="polite">{voiceTurns.map((turn, index) => <div className={`voice-turn ${turn.speaker}`} key={`${turn.speaker}-${index}`}><small>{turn.speaker === "you" ? "YOU" : "UNFLARE"}</small><p>{turn.text}</p></div>)}</div>{voiceListening && <div className="voice-listening-indicator" role="status" aria-label="Listening for your answer"><span className="voice-listening-dot" aria-hidden="true" /><span className="voice-waveform" aria-hidden="true"><i /><i /><i /><i /><i /></span><span>Listening</span></div>}<p className="voice-status" aria-live="polite">{voiceStatus}</p><div className="voice-actions"><button className={`modal-confirm ${voiceListening ? "is-listening" : ""}`} type="button" onClick={startVoiceListening} disabled={voiceListening || voiceSaving} aria-busy={voiceListening || voiceSaving}>{voiceComplete ? voiceSaving ? "Saving…" : "Close check-in" : voiceListening ? <><span className="button-waveform" aria-hidden="true"><i /><i /><i /></span>Listening…</> : "Listen & answer"}</button>{!voiceComplete && <button className="voice-end-button" type="button" onClick={() => finishVoiceCheckIn("Check-in ended. This transcript will be saved to History.")}>End check-in</button>}</div></div>}
      {(modal === "checkin" && !checkInSaved) && <p className="modal-safety">For severe or rapidly worsening symptoms, seek urgent medical help instead of waiting for the app.</p>}
      {modal === "voice" && <p className="modal-safety">For severe or rapidly worsening symptoms, seek urgent medical help instead of waiting for the app.</p>}
    </div></div>}
    <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
  </div>;
}
