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
type Evidence = { source: string; recordId: string; occurredAt: string; detail: string };
type Finding = { code: string; summary: string; evidence: Evidence[] };
type FlareRiskLevel = "low" | "medium" | "high" | "very-high";
type SignalsResponse = {
  slowBurn: Finding | null;
  taperRisk: Finding[];
  sideEffects: Array<{ symptomName: string; occurredAt: string; classification: "likely-side-effect" | "possible-disease-activity" | "unclear"; evidence: Evidence[] }>;
  delayedCorrelation: Finding[];
  flareEarlyWarning: { level: FlareRiskLevel; score: number; rationale: string[]; evidence: Evidence[] };
  recommendation: { headline: string; detail: string; evidence: Evidence[] };
};
type TimelineEntry = {
  source: "check-in" | "wearable" | "lab-result" | "medication-event";
  occurredAt: string;
  data: Record<string, unknown>;
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

const attentionCopy: Record<FlareRiskLevel, { label: string; headline: string; className: string }> = {
  low: { label: "Monitoring", headline: "Your monitoring is steady.", className: "" },
  medium: { label: "Worth watching", headline: "A few small changes are worth watching.", className: "attention" },
  high: { label: "Needs attention", headline: "It would be sensible to check in with your care team.", className: "attention" },
  "very-high": { label: "Review promptly", headline: "Prompt care-team review is recommended.", className: "urgent" }
};

function evidenceLabel(item: Evidence) {
  const date = new Date(item.occurredAt);
  const when = Number.isNaN(date.getTime()) ? item.occurredAt : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${when} · ${item.detail}`;
}

function monitoringDate(value: string, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" }).format(date);
}

function timelineLabel(entry: TimelineEntry) {
  const data = entry.data as {
    source?: string; hrvMs?: number; restingHeartRateBpm?: number; steps?: number; sleep?: { totalMinutes?: number };
    testName?: string; value?: number; unit?: string; flagged?: boolean;
    drugName?: string; dose?: number; eventType?: string; note?: string;
    summary?: { symptoms?: Array<{ name: string; change: string }> };
  };
  if (entry.source === "wearable") {
    const measures = [data.restingHeartRateBpm && `${data.restingHeartRateBpm} bpm resting HR`, data.hrvMs && `${data.hrvMs} ms HRV`, data.steps && `${data.steps.toLocaleString()} steps`].filter(Boolean);
    return measures.join(" · ") || "Wearable reading recorded";
  }
  if (entry.source === "lab-result") return `${data.testName ?? "Clinical result"} ${data.value ?? ""}${data.unit ?? ""}${data.flagged ? " · outside reference range" : ""}`;
  if (entry.source === "medication-event") return `${data.eventType ?? "Medication update"}: ${data.drugName ?? "Medication"}${data.dose !== undefined ? ` ${data.dose}${data.unit ?? ""}` : ""}`;
  const symptoms = data.summary?.symptoms?.map((symptom) => `${symptom.name} (${symptom.change})`).join(", ");
  return symptoms ? `Check-in: ${symptoms}` : "Check-in recorded";
}

function timelineTitle(source: TimelineEntry["source"]) {
  return source === "wearable" ? "Wearable reading" : source === "lab-result" ? "Clinical result" : source === "medication-event" ? "Medication context" : "Patient check-in";
}

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
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const whatsAppTestNumber = "+447492368087";
  const [whatsAppDemoStatus, setWhatsAppDemoStatus] = useState("");
  const [whatsAppDemoStarting, setWhatsAppDemoStarting] = useState(false);
  const [signals, setSignals] = useState<SignalsResponse | null>(null);
  const [signalsError, setSignalsError] = useState("");
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [timelineError, setTimelineError] = useState("");
  const voiceRecognition = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    const hashTab = window.location.hash.slice(1);
    if (["dashboard", "voice", "history", "test"].includes(hashTab)) setTab(hashTab as Tab);
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setModal(null);
    window.addEventListener("keydown", closeOnEscape);
    void loadMonitoring();
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      voiceRecognition.current?.stop();
    };
  }, []);

  async function loadSignals() {
    try {
      const response = await fetch("/api/anca/signals");
      const data = await response.json() as SignalsResponse | { error?: string };
      if (!response.ok || !("flareEarlyWarning" in data)) throw new Error("Monitoring data is unavailable. Start the API with npm run dev.");
      setSignals(data);
      setSignalsError("");
    } catch (error) {
      setSignals(null);
      setSignalsError(error instanceof Error ? error.message : "Monitoring data is unavailable.");
    }
  }

  async function loadTimeline() {
    try {
      const response = await fetch("/api/anca/timeline");
      const data = await response.json() as { timeline?: TimelineEntry[]; error?: string };
      if (!response.ok || !data.timeline) throw new Error(data.error ?? "Timeline data is unavailable.");
      setTimeline(data.timeline);
      setTimelineError("");
    } catch (error) {
      setTimeline([]);
      setTimelineError(error instanceof Error ? error.message : "Timeline data is unavailable.");
    }
  }

  async function loadMonitoring() {
    await Promise.all([loadSignals(), loadTimeline()]);
  }

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

  async function saveCheckIn() {
    if (!selectedSymptoms.length) {
      setSavePrompt("Select at least one option");
      window.setTimeout(() => setSavePrompt("Save check-in"), 1500);
      return;
    }
    setSavePrompt("Saving…");
    try {
      const response = await fetch("/api/check-ins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symptoms: selectedSymptoms }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save this check-in.");
      setCheckInSaved(true);
      setModalTitle("Check-in saved");
      setModalCopy("This has been added to your longitudinal record.");
      void loadMonitoring();
    } catch (error) {
      setSavePrompt(error instanceof Error ? error.message : "Unable to save check-in");
      window.setTimeout(() => setSavePrompt("Save check-in"), 2_200);
    }
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
      void loadSignals();
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

  const latestWearable = [...timeline].reverse().find((entry) => entry.source === "wearable");

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
        <div className="device-card"><span className="device-icon">⌚</span><div><strong>Apple Watch</strong><small><i /> {latestWearable ? `Synced ${monitoringDate(latestWearable.occurredAt, true)}` : "Awaiting a reading"}</small></div></div>
        <div className="profile"><div className="avatar">AM</div><div><strong>Alex Morgan</strong><small>alex@example.com</small></div></div>
      </div>
    </aside>

    <main className={tab === "dashboard" ? "dashboard-main" : undefined}>
      {tab === "dashboard" && <>
        <header className="dashboard-header">
          <div><p className="eyebrow">SATURDAY, 18 JULY · GPA MONITORING</p><h1>Good morning, Alex.</h1><p>Your monitoring update for today.</p></div>
          <span className="demo-pill">SIMULATED DATA</span>
        </header>
        {signals ? (() => {
          const warning = signals.flareEarlyWarning;
          const copy = attentionCopy[warning.level];
          const findings = [signals.slowBurn, ...signals.taperRisk, ...signals.delayedCorrelation].filter((item): item is Finding => Boolean(item));
          const recentTimeline = timeline.slice(-6).reverse();
          const latestMedication = [...timeline].reverse().find((entry) => entry.source === "medication-event");
          const latestLab = [...timeline].reverse().find((entry) => entry.source === "lab-result");
          const latestWearableData = latestWearable?.data as { restingHeartRateBpm?: number; hrvMs?: number; sleep?: { totalMinutes?: number } } | undefined;
          const careTeamSummary = `${copy.headline}\n\n${warning.rationale.join("\n\n")}\n\nSuggested action: ${signals.recommendation.headline}. ${signals.recommendation.detail}`;
          return <>
            <section className="simple-review" aria-labelledby="attention-title">
              <div className="simple-review-header"><div><p className="eyebrow">CURRENT ATTENTION LEVEL</p><h2 id="attention-title">{copy.headline}</h2></div><span className={`status-pill ${copy.className}`}>{copy.label}</span></div>
              <p className="simple-review-lead">{warning.rationale[0] ?? "Your recent monitoring is within your usual pattern."}</p>
              <div className="monitoring-stat-grid" aria-label="Latest monitoring snapshot">
                <article><span>Attention score</span><strong>{warning.score}<small> / 7+</small></strong><p>Combined trend signals, not a diagnosis.</p></article>
                <article><span>Latest wearable</span><strong>{latestWearableData?.restingHeartRateBpm ? `${latestWearableData.restingHeartRateBpm} bpm` : "—"}</strong><p>{latestWearableData?.hrvMs ? `${latestWearableData.hrvMs} ms HRV` : "No heart-rate reading yet"}</p></article>
                <article><span>Medication context</span><strong>{latestMedication ? (latestMedication.data.drugName as string ?? "Recorded") : "—"}</strong><p>{latestMedication ? timelineLabel(latestMedication) : "No recent medication event"}</p></article>
                <article><span>Latest clinical result</span><strong>{latestLab ? (latestLab.data.testName as string ?? "Recorded") : "—"}</strong><p>{latestLab ? timelineLabel(latestLab) : "No result recorded"}</p></article>
              </div>
              <div className="simple-actions"><button className="primary-button" onClick={() => openCheckIn(true)}>Answer a few questions</button><button className="text-button" disabled={summaryReady} onClick={() => { setSummaryReady(true); showToast("✓ Care-team summary prepared"); openInformation("Care-team summary ready", "This summary organises the available evidence for review; it does not diagnose a flare.", careTeamSummary); }}>{summaryReady ? "Summary ready" : "Prepare a care-team summary"} <span>→</span></button></div>
              <p className="attention-guidance"><strong>{signals.recommendation.headline}.</strong> {signals.recommendation.detail}</p>
            </section>
            <div className="monitoring-dashboard-grid">
              <section className="simple-snapshot monitoring-snapshot" aria-labelledby="snapshot-title">
                <div><p className="eyebrow">EVIDENCE IN CONTEXT</p><h2 id="snapshot-title">Why this needs attention</h2></div>
                {findings.length ? <div className="monitoring-findings">{findings.map((finding) => <article key={`${finding.code}-${finding.evidence[0]?.recordId ?? "summary"}`}><b>{finding.summary}</b><div>{finding.evidence.slice(0, 3).map((item, index) => <span key={index}>{evidenceLabel(item)}</span>)}</div></article>)}</div> : <p className="monitoring-empty">No sustained symptom or medication-timing pattern is currently detected.</p>}
                {signals.sideEffects.length > 0 && <div className="monitoring-side-effects"><b>Symptom and medication timing</b>{signals.sideEffects.map((item, index) => <p key={index}>{item.symptomName} is <strong>{item.classification.replaceAll("-", " ")}</strong> based on the available context.</p>)}</div>}
              </section>
              <section className="simple-snapshot timeline-snapshot" aria-labelledby="timeline-title">
                <div className="timeline-snapshot-heading"><div><p className="eyebrow">LONGITUDINAL RECORD</p><h2 id="timeline-title">Recent monitoring timeline</h2></div><button className="text-button" onClick={() => selectTab("history")}>View check-ins <span>→</span></button></div>
                {recentTimeline.length ? <ol className="monitoring-timeline">{recentTimeline.map((entry) => <li key={`${entry.source}-${entry.data.id as string}-${entry.occurredAt}`}><time>{monitoringDate(entry.occurredAt)}</time><span className={`timeline-source ${entry.source}`}>{timelineTitle(entry.source)}</span><p>{timelineLabel(entry)}</p></li>)}</ol> : <p className="monitoring-empty">{timelineError || "No timeline events have been recorded yet."}</p>}
              </section>
            </div>
          </>;
        })() : <section className="simple-review"><p className="eyebrow">MONITORING STATUS</p><h2>Monitoring data is unavailable.</h2><p className="simple-review-lead">{signalsError || "Loading your latest monitoring signals…"}</p><div className="simple-actions"><button className="primary-button" onClick={() => openCheckIn(true)}>Answer a few questions</button><button className="text-button" onClick={() => void loadMonitoring()}>Try again <span>→</span></button></div></section>}
        <aside className="safety-note"><span>i</span><p><strong>Unflare supports monitoring; it does not diagnose a flare.</strong> If you develop severe breathing difficulty, cough up blood, see blood in your urine, have marked weakness, or feel rapidly worse, seek urgent medical help.</p></aside>
      </>}

      {tab === "voice" && <>
        <header className="voice-page-header"><div><p className="eyebrow">GUIDED VOICE CHECK-IN</p><h1>Talk through how you&apos;re feeling.</h1><p>Answer a few short questions by voice to add context to your monitoring record.</p></div><span className="demo-pill">BROWSER MICROPHONE</span></header>
        <section className="voice-start-card" aria-labelledby="voice-start-title"><div><span className="voice-start-icon">◌</span><p className="eyebrow">ABOUT 2 MINUTES</p><h2 id="voice-start-title">Start a voice check-in</h2><p>Unflare will ask about changes from your usual self, infections, symptoms, and medication. It supports monitoring and does not diagnose a flare.</p><button className="primary-button" onClick={openVoiceCheckIn}>Start voice check-in</button></div><aside className={`voice-settings-panel ${voiceSettingsOpen ? "is-open" : ""}`}><button className="voice-settings-trigger" type="button" aria-label="Voice and pace settings" aria-expanded={voiceSettingsOpen} title="Voice and pace settings" onClick={() => setVoiceSettingsOpen((open) => !open)}>⚙</button>{voiceSettingsOpen && <div className="voice-settings-content"><h3>Voice &amp; pace</h3><p className="voice-settings-copy">Choose a voice installed on this device. A slightly slower pace often sounds more natural.</p><label className="voice-setting"><span>Voice</span><select value={selectedVoiceName} onChange={(event) => setSelectedVoiceName(event.target.value)}><option value="auto">Automatic (best available)</option>{availableVoices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} · {voice.lang}</option>)}</select></label><label className="voice-setting"><span>Speaking pace <b>{voiceRate.toFixed(2)}×</b></span><input type="range" min="0.8" max="1.08" step="0.04" value={voiceRate} onChange={(event) => setVoiceRate(Number(event.target.value))} /></label><label className="voice-setting"><span>Pitch <b>{voicePitch.toFixed(1)}</b></span><input type="range" min="0.85" max="1.15" step="0.05" value={voicePitch} onChange={(event) => setVoicePitch(Number(event.target.value))} /></label><button className="voice-preview-button" type="button" onClick={() => speakVoice("Hello, I’m here to guide your check-in. How have you been feeling today?")}>Preview voice</button>{availableVoices.length === 0 && <small className="voice-settings-note">Your browser is still loading its installed voices. The automatic voice will be used.</small>}</div>}</aside></section>
      </>}

      {tab === "history" && <>
        <header className="history-header"><div><p className="eyebrow">LONGITUDINAL RECORD</p><h1>Check-in history</h1><p>Review saved voice, WhatsApp, and phone transcripts from your local record.</p></div></header>
        {historyLoading ? <p className="empty-history">Loading saved check-ins…</p> : historyError ? <p className="empty-history">{historyError}</p> : filteredHistory.length === 0 ? <p className="empty-history">No saved check-ins yet. Complete a voice check-in to see its transcript here.</p> : <section className="history-layout"><div className="conversation-list"><div className="history-filters">{(["all", "app", "whatsapp", "phone"] as const).map((item) => <button key={item} className={historyFilter === item ? "active" : ""} onClick={() => setHistoryFilter(item)}>{item === "all" ? "All" : item === "app" ? "Voice" : item === "whatsapp" ? "WhatsApp" : "Phone"}</button>)}</div>{filteredHistory.map((checkIn) => <button key={checkIn.id} className={`conversation ${activeCheckIn?.id === checkIn.id ? "active" : ""}`} onClick={() => setActiveHistoryId(checkIn.id)}><span className={`conversation-icon ${checkIn.channel === "phone" ? "call" : "chat"}`}>{checkInIcon(checkIn)}</span><span><strong>{checkInTitle(checkIn)}</strong><small>{formatCheckInDate(checkIn.createdAt)} · {checkIn.status}</small><em>{checkInExcerpt(checkIn)}</em></span><b>›</b></button>)}</div>
          {activeCheckIn && <article className="transcript-card"><div className="transcript-head"><div><span className={`conversation-icon ${activeCheckIn.channel === "phone" ? "call" : "chat"}`}>{checkInIcon(activeCheckIn)}</span><div><h2>{checkInTitle(activeCheckIn)}</h2><p>{formatCheckInDate(activeCheckIn.createdAt)} · {activeCheckIn.status}</p></div></div></div>{activeCheckIn.summary ? <div className="summary-box"><p className="eyebrow">AI CHECK-IN SUMMARY</p><p>{activeCheckIn.summary.summary}</p>{activeCheckIn.summary.attentionLevel && activeCheckIn.summary.recommendedNextStep && <div className="summary-bubbles"><span className="summary-bubble attention-bubble">Attention <b className={activeCheckIn.summary.attentionLevel === "urgent_guidance" ? "review-risk" : activeCheckIn.summary.attentionLevel === "care_team_review" ? "review-risk" : "low-risk"}>{attentionLabel(activeCheckIn.summary.attentionLevel)}</b></span><span className="summary-bubble next-step-bubble">Next step <b>{activeCheckIn.summary.recommendedNextStep}</b></span></div>}</div> : <div className="summary-request"><div><p className="eyebrow">AI CHECK-IN SUMMARY</p><p>{summaryCheckInId === activeCheckIn.id ? "Generating a transcript-grounded summary…" : "Generating a concise, transcript-grounded summary for this saved check-in."}</p></div>{summaryError && <small>{summaryError}</small>}</div>}<div className="messages">{activeCheckIn.turns.map((turn) => <div key={turn.id} className={`message ${turn.role === "patient" ? "user" : "ai"}`}><small>{turn.role === "patient" ? "YOU" : "UNFLARE"}</small><p>{turn.text}</p></div>)}</div></article>}
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
