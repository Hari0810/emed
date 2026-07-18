export type CallStatus =
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "declined"
  | "urgent"
  | "failed";

export type CheckInChannel = "phone" | "whatsapp" | "app";

export type QuestionDomain =
  | "general"
  | "infection"
  | "renal"
  | "respiratory"
  | "ent"
  | "neurology"
  | "medication"
  | "urgent";

export type QuestionAnswerType = "change" | "yes-no" | "free-text";

/**
 * A clinically reviewed prompt. Definitions are versioned so historical answers
 * retain the wording and meaning that applied when they were collected.
 */
export interface QuestionDefinition {
  id: string;
  version: number;
  domain: QuestionDomain;
  purpose: string;
  prompt: string;
  answerType: QuestionAnswerType;
  options?: readonly string[];
  appliesTo?: {
    subtypes?: readonly ("GPA" | "MPA" | "EGPA")[];
    priorOrganInvolvement?: readonly string[];
  };
  followUpQuestionIds?: readonly string[];
  active: boolean;
}

export interface PlannedQuestion {
  questionId: string;
  questionVersion: number;
  reason: string;
  askedAt?: string;
}

export interface CheckInPlan {
  createdAt: string;
  questionIds: string[];
  plannedQuestions: PlannedQuestion[];
}

/** Raw wording is preserved; value is only populated after validated extraction. */
export interface QuestionResponse {
  id: string;
  questionId: string;
  questionVersion: number;
  askedAt: string;
  answeredAt: string;
  rawAnswer: string;
  value: string | null;
  source: CheckInChannel;
  evidenceTurnId: string;
}

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
  attentionLevel: "continue_monitoring" | "care_team_review" | "urgent_guidance";
  recommendedNextStep: string;
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
  channel: CheckInChannel;
  phoneNumber: string;
  twilioCallSid?: string;
  status: CallStatus;
  consent?: boolean;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  turns: ConversationTurn[];
  checkInPlan?: CheckInPlan;
  activeQuestionId?: string;
  questionResponses: QuestionResponse[];
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
