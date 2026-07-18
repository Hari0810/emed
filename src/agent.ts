import { config } from "./config.js";
import { analyseCall, streamAgentReply } from "./runware.js";
import { classifyConsent, detectUrgentSafetyFlag } from "./safety.js";
import {
  addSafetyFlag,
  addTurn,
  createCheckInPlan,
  getCall,
  markQuestionAsked,
  recordActiveQuestionResponse,
  setSummary,
  updateCall,
  updateStatus
} from "./store.js";

type RelaySocket = { send: (data: string) => void; readyState: number };
const openSockets = new Map<string, RelaySocket>();
const activeResponses = new Map<string, AbortController>();

const fallbackQuestionIds = ["general_change", "infection_context", "neurology_change", "respiratory_change", "renal_change", "medication_context"];

function send(socket: RelaySocket, message: unknown) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function speak(socket: RelaySocket, text: string, last = true) {
  send(socket, { type: "text", token: text, last, interruptible: true, preemptible: true });
}

function end(socket: RelaySocket, reasonCode: string) {
  send(socket, { type: "end", handoffData: JSON.stringify({ reasonCode }) });
}

function chooseFallbackQuestion(callId: string) {
  const session = getCall(callId);
  if (!session) return "How have you felt compared with your usual self?";
  const asked = session.questionResponses.length;
  const questionId = fallbackQuestionIds[Math.min(asked, fallbackQuestionIds.length - 1)]!;
  return askCatalogueQuestion(callId, questionId);
}

function askCatalogueQuestion(callId: string, questionId: string) {
  const question = markQuestionAsked(callId, questionId);
  return question?.prompt ?? "How have you felt compared with your usual self?";
}

function urgentMessage() {
  return `This could need urgent medical attention. Please call ${config.EMERGENCY_NUMBER} now, or go to the nearest emergency department. Do not wait for this app or change your medication unless a clinician tells you to.`;
}

function recordReply(callId: string, response: string) {
  addTurn(callId, "assistant", response);
  return response;
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
  if (session.consent) recordActiveQuestionResponse(callId, patientTurn);

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
    createCheckInPlan(callId);
    const response = `Thank you. I will ask a few short questions. This does not diagnose a flare or replace your care team. ${askCatalogueQuestion(callId, "general_change")}`;
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
      reply = chooseFallbackQuestion(callId);
      speak(socket, reply, false);
    }
    if (!controller.signal.aborted) {
      speak(socket, "", true);
      addTurn(callId, "assistant", reply);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      reply = chooseFallbackQuestion(callId);
      speak(socket, reply);
      addTurn(callId, "assistant", reply);
      console.error("Runware live response failed", error);
    }
  } finally {
    activeResponses.delete(callId);
  }
}

export async function handleWhatsAppPrompt(callId: string, text: string) {
  const session = getCall(callId);
  if (!session) return "I could not start this check-in. Please try again.";

  const patientTurn = addTurn(callId, "patient", text.trim());
  if (!patientTurn) return "I could not save that message. Please try again.";
  if (session.consent) recordActiveQuestionResponse(callId, patientTurn);

  const urgent = detectUrgentSafetyFlag(text);
  if (urgent) {
    addSafetyFlag(callId, urgent);
    updateStatus(callId, "urgent");
    return recordReply(callId, urgentMessage());
  }

  if (session.consent === undefined) {
    const consent = classifyConsent(text);
    if (consent === undefined) {
      return recordReply(
        callId,
        "Before we continue, do you agree to a short AI-supported health check-in on WhatsApp? It is not emergency care or a diagnosis. Reply YES or NO."
      );
    }
    updateCall(callId, { consent });
    if (!consent) {
      updateStatus(callId, "declined");
      return recordReply(
        callId,
        "No problem. I will not continue this check-in. If you need help, contact your usual care team."
      );
    }
    createCheckInPlan(callId);
    return recordReply(callId, `Thank you. ${askCatalogueQuestion(callId, "general_change")} I will ask one question at a time. Reply DONE when you have finished.`);
  }

  if (/\b(done|finish(?:ed)?|goodbye|bye|that's all|that is all|end (?:the )?(?:chat|check-in)|stop)\b/i.test(text)) {
    const response = recordReply(
      callId,
      "Thank you. I have added this conversation to your check-in record. This does not diagnose a flare; contact your care team if you are concerned."
    );
    void finaliseCall(callId);
    return response;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let reply = "";
  try {
    const streamed = await streamAgentReply(
      getCall(callId)!,
      (token) => { reply += token; },
      controller.signal
    );
    if (!streamed || !reply.trim()) reply = chooseFallbackQuestion(callId);
  } catch (error) {
    reply = chooseFallbackQuestion(callId);
    if (!controller.signal.aborted) console.error("Runware WhatsApp response failed", error);
  } finally {
    clearTimeout(timeout);
  }
  return recordReply(callId, `${reply.trim()} Reply DONE when you have finished.`);
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
