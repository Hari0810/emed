export type CallStatus =
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "declined"
  | "urgent"
  | "failed";

export interface ConversationTurn {
  id: string;
  role: "patient" | "assistant";
  text: string;
  createdAt: string;
}

export interface SafetyFlag {
  code: string;
  evidence: string;
  createdAt: string;
}

export interface CallSummary {
  summary: string;
  symptoms: Array<{
    name: string;
    change: "new" | "worsening" | "stable" | "improving" | "unclear";
    duration: string | null;
    evidenceTurnIds: string[];
  }>;
  medicationContext: string[];
  infectionContext: string[];
  followUpRecommended: boolean;
  unsupportedClaims: string[];
}

export interface CallSession {
  id: string;
  phoneNumber: string;
  twilioCallSid?: string;
  status: CallStatus;
  consent?: boolean;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  turns: ConversationTurn[];
  safetyFlags: SafetyFlag[];
  summary?: CallSummary;
  error?: string;
}

export type ConversationRelayMessage =
  | {
      type: "setup";
      callSid: string;
      sessionId: string;
      customParameters?: Record<string, string>;
    }
  | { type: "prompt"; voicePrompt: string; lang: string; last: boolean }
  | { type: "interrupt"; utteranceUntilInterrupt: string; durationUntilInterruptMs: number }
  | { type: "dtmf"; digit: string }
  | { type: "error"; description: string };
