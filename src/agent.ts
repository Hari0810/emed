import { config } from "./config.js";
import { analyseCall, streamAgentReply } from "./runware.js";
import { classifyConsent, detectUrgentSafetyFlag } from "./safety.js";
import { addSafetyFlag, addTurn, getCall, setSummary, updateCall, updateStatus } from "./store.js";
import type { CallSession } from "./types.js";

type RelaySocket = { send: (data: string) => void; readyState: number };
const openSockets = new Map<string, RelaySocket>();
const activeResponses = new Map<string, AbortController>();

const fallbackQuestions = [
  "Has your energy or ability to do usual activities changed from your normal over the last few days?",
  "Have you had fever, a recent infection, or persistent sinus or nasal symptoms?",
  "Have you noticed any joint or muscle aches, rash, numbness, or unusual weakness?",
  "Have you noticed breathing or chest changes, or any change in your urine?",
  "Have you taken your medication as prescribed, without making any changes yourself?"
];

function send(socket: RelaySocket, message: unknown) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function speak(socket: RelaySocket, text: string, last = true) {
  send(socket, { type: "text", token: text, last, interruptible: true, preemptible: true });
}

function end(socket: RelaySocket, reasonCode: string) {
  send(socket, { type: "end", handoffData: JSON.stringify({ reasonCode }) });
}

function chooseFallbackQuestion(session: CallSession) {
  const asked = session.turns.filter((turn) => turn.role === "assistant").length;
  return fallbackQuestions[Math.min(asked, fallbackQuestions.length - 1)]!;
}

function urgentMessage() {
  return `This could need urgent medical attention. Please call ${config.EMERGENCY_NUMBER} now, or go to the nearest emergency department. Do not wait for this app or change your medication unless a clinician tells you to.`;
}

export function attachSocket(callId: string, socket: RelaySocket) {
  openSockets.set(callId, socket);
  updateStatus(callId, "in-progress");
}

export function interruptReply(callId: string) {
  activeResponses.get(callId)?.abort();
  activeResponses.delete(callId);
}

export async function handlePatientPrompt(callId: string, text: string) {
  const session = getCall(callId);
  const socket = openSockets.get(callId);
  if (!session || !socket) return;

  interruptReply(callId);
  const patientTurn = addTurn(callId, "patient", text);
  if (!patientTurn) return;

  const urgent = detectUrgentSafetyFlag(text);
  if (urgent) {
    addSafetyFlag(callId, urgent);
    updateStatus(callId, "urgent");
    const response = urgentMessage();
    addTurn(callId, "assistant", response);
    speak(socket, response);
    setTimeout(() => end(socket, "urgent-guidance"), 7_000);
    return;
  }

  if (session.consent === undefined) {
    const consent = classifyConsent(text);
    if (consent === undefined) {
      const response = "Before we continue, do you agree to a short AI-supported health check-in? It is not emergency care or a diagnosis.";
      addTurn(callId, "assistant", response);
      speak(socket, response);
      return;
    }
    updateCall(callId, { consent });
    if (!consent) {
      const response = "No problem. I will not continue this check-in. If you need help, contact your usual care team. Goodbye.";
      addTurn(callId, "assistant", response);
      updateStatus(callId, "declined");
      speak(socket, response);
      setTimeout(() => end(socket, "consent-declined"), 3_000);
      return;
    }
    const response = "Thank you. I will ask a few short questions. This does not diagnose a flare or replace your care team. How have you felt compared with your usual self?";
    addTurn(callId, "assistant", response);
    speak(socket, response);
    return;
  }

  if (/\b(goodbye|bye|that's all|that is all|end (?:the )?call|stop)\b/i.test(text)) {
    const response = "Thank you for checking in. I will add this conversation to your record. Goodbye.";
    addTurn(callId, "assistant", response);
    updateStatus(callId, "completed");
    speak(socket, response);
    setTimeout(() => end(socket, "patient-ended"), 3_000);
    return;
  }

  const controller = new AbortController();
  activeResponses.set(callId, controller);
  let reply = "";
  try {
    const streamed = await streamAgentReply(
      getCall(callId)!,
      (token) => {
        reply += token;
        speak(socket, token, false);
      },
      controller.signal
    );
    if (!streamed) {
      reply = chooseFallbackQuestion(getCall(callId)!);
      speak(socket, reply, false);
    }
    if (!controller.signal.aborted) {
      speak(socket, "", true);
      addTurn(callId, "assistant", reply);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      reply = chooseFallbackQuestion(getCall(callId)!);
      speak(socket, reply);
      addTurn(callId, "assistant", reply);
      console.error("Runware live response failed", error);
    }
  } finally {
    activeResponses.delete(callId);
  }
}

export async function finaliseCall(callId: string) {
  interruptReply(callId);
  openSockets.delete(callId);
  const session = getCall(callId);
  if (!session || session.status === "urgent" || session.status === "declined") return;
  updateStatus(callId, "completed");
  try {
    const summary = await analyseCall(getCall(callId)!);
    if (summary) setSummary(callId, summary);
  } catch (error) {
    console.error("Runware post-call analysis failed", error);
  }
}
