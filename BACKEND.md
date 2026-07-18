# Unflare backend recommendation

## Live voice-call scaffold

The repository now includes a runnable TypeScript/Fastify voice service in `src/`.
It uses Twilio ConversationRelay for the telephone connection, speech-to-text, and
speech output; Runware supplies the live follow-up question and post-call structured
summary. ConversationRelay means this MVP does not yet use a Runware text-to-speech
model directly.

### Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`. The dashboard’s **Call me for a check-in** button
will show an explanatory configuration error until the Twilio variables below are
set. This is intentional: the browser never receives provider keys.

## WhatsApp check-in scaffold

The dashboard's **Begin WhatsApp demo** button sends a real consent message to the
fixed demo recipient and starts a text-based, AI-supported check-in. WhatsApp messages
use the same consent prompt, urgent-symptom checks, transcript store, and summary
pipeline as telephone calls.

### Test it with the Twilio Sandbox

1. In the Twilio Console, activate the **WhatsApp Sandbox** and join it from your
   test WhatsApp account using the displayed QR code or `join` message.
2. Run `ngrok http 3001` (or another public HTTPS tunnel) and set
   `PUBLIC_BASE_URL` in `.env` to its HTTPS URL.
3. Add your Twilio account credentials and the Sandbox sender to `.env`:

   ```text
   TWILIO_ACCOUNT_SID=...
   TWILIO_AUTH_TOKEN=...
   TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
   ```

   Copy the sender from the Twilio Console rather than relying on the example.
4. In the Sandbox settings, set **When a message comes in** to:

   ```text
   https://your-public-host/twilio/whatsapp
   ```

5. Start the app with `npm run dev`, open `http://localhost:3000`, choose
   **Begin WhatsApp demo**, then reply `YES` to consent and `DONE` when the
   check-in is complete.

For real deployment, register a WhatsApp sender and obtain patient opt-in. A
free-form reply is allowed for 24 hours after the patient's last message; outside
that window, business-initiated messages must use an approved template. Do not put
symptoms, diagnoses, or clinical results in templates.

### Configure a real test call

1. Run the API behind a public HTTPS tunnel, such as `ngrok http 3001`.
2. Set `PUBLIC_BASE_URL` to that HTTPS URL. Twilio derives the secure WebSocket
   endpoint from it automatically.
3. Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and
   `DEMO_PHONE_NUMBER` to `.env`, plus `RUNWARE_API_KEY`. The dashboard uses the
   configured demo recipient so it does not request a phone number on every call.
4. Complete Twilio ConversationRelay onboarding for the account and ensure the
   destination number is permitted in the account's current verification/geo rules.
5. For a localhost tunnel only, set `SKIP_TWILIO_SIGNATURE_VALIDATION=true`. Do
   not use that setting in production.

The service validates Twilio request signatures by default. It also requires E.164
phone numbers and an explicit UI confirmation that the person agreed to receive a
call.

### What is implemented

- `POST /api/calls` starts an outbound call.
- `GET /api/calls/:callId` returns a masked-number status for the UI.
- `POST /twilio/whatsapp` accepts inbound WhatsApp messages and returns the next
  safe check-in response as TwiML.
- `POST /api/whatsapp/demo` sends the opening WhatsApp message to the fixed demo
  recipient; it is rate-limited to one start per minute.
- `POST /api/check-ins/voice` stores the browser voice transcript and, when
  `RUNWARE_API_KEY` is configured, saves a schema-validated AI summary with it.
- `GET /api/whatsapp` supplies the dashboard's WhatsApp launch link without
  exposing any provider credentials.
- `/twilio/voice`, `/twilio/relay`, and related callbacks implement the Twilio
  ConversationRelay lifecycle.
- `src/safety.ts` evaluates a deliberately small set of urgent phrase matches before
  a model is called. It provides urgent-care guidance but never contacts emergency
  services automatically.
- `src/runware.ts` streams a short Runware reply during the call and produces a
  schema-validated post-call summary.

Check-ins are persisted in a local SQLite file for this hackathon scaffold. Before a real
deployment, add authenticated user/patient access, encrypted persistent storage,
auditing, retention controls, a clinically approved escalation policy, and clinical
evaluation of the rule and prompt set.

## MVP architecture

Use a small TypeScript API rather than calling AI services from the browser:

- **API:** Node.js + TypeScript + Fastify
- **Database:** PostgreSQL (Supabase is convenient for the hackathon)
- **Background jobs:** a database-backed job table initially; add a queue only if needed
- **Model gateway:** one server-side module that calls Runware's OpenAI-compatible API
- **Phone calls:** a separate telephony provider; pass completed transcripts into the same check-in pipeline

The browser must never receive the Runware API key.

## Core data model

- `patients`: profile, timezone, consent and escalation preferences
- `observations`: timestamped sensor measurements with source and unit
- `check_ins`: patient answers or call transcripts
- `baselines`: per-patient metric baseline and variability
- `signals`: deterministic trend/anomaly findings and supporting evidence
- `assessments`: versioned score, confidence, rationale and model metadata
- `clinician_alerts`: escalation status, evidence and acknowledgement trail

Store raw observations separately from derived signals. Assessments should be reproducible from the source data, algorithm version, prompt version and model ID.

## Processing flow

1. Ingest simulated wearable readings or a completed check-in.
2. Validate and normalise units and timestamps.
3. Calculate rolling baselines, trend slopes and anomaly scores in code.
4. Apply explicit red-flag and escalation rules in code.
5. Send only the relevant structured evidence to the LLM.
6. Require schema-validated JSON containing a summary, possible explanations, follow-up questions and evidence references.
7. Persist the assessment and show it in patient or clinician views.

The model may explain or summarise evidence, but it must not be the sole source of a health score, diagnosis or emergency decision. Any model-generated evidence reference must map to an observation or check-in supplied in the request.

## Runware model

Start with `deepseek:v4@flash` for:

- transcript-to-structured-symptoms extraction
- follow-up question drafting
- patient-friendly explanations
- concise clinician summaries

Use a low temperature and strict JSON Schema. Keep the model ID configurable so the same evaluation set can be run against a stronger fallback later.

Suggested environment variables:

```text
RUNWARE_API_KEY=
RUNWARE_BASE_URL=https://api.runware.ai/v1
RUNWARE_MODEL=deepseek:v4@flash
DATABASE_URL=
```

For a first integration, use the OpenAI-compatible `POST /v1/chat/completions` endpoint. The native Runware API is useful later if cost reporting, asynchronous delivery or Runware task IDs are required.

## Model output contract

The model response should resemble:

```json
{
  "summary": "Resting heart rate is above baseline alongside shorter sleep.",
  "reportedSymptoms": [
    { "name": "fatigue", "severity": "mild", "evidenceId": "checkin_123" }
  ],
  "followUpQuestions": ["Have you had a fever?"],
  "possibleExplanations": ["reduced recovery", "stress", "intercurrent illness"],
  "unsupportedClaims": []
}
```

Urgency, confidence and the final action should be added by the rules engine after model output validation.

## Minimum API surface

- `POST /api/observations/batch`
- `POST /api/check-ins`
- `GET /api/dashboard`
- `GET /api/timeline`
- `POST /api/assessments/run`
- `GET /api/clinician/alerts`

## Safety and privacy

- Present the prototype as decision support, not diagnosis.
- Add hard-coded emergency red flags and show emergency guidance without waiting for a model response.
- Encrypt data in transit and at rest; minimise patient data sent to any model.
- Keep consent, access, model calls and clinician actions in an audit log.
- Do not use real patient data until vendor contracts, retention, regional processing and healthcare compliance requirements have been reviewed. A general security statement is not a substitute for a signed healthcare data-processing agreement or BAA where one is required.
- Run a small labelled evaluation set covering normal trends, missing data, contradictory self-report, worsening trends and urgent red flags before demos or releases.

## Phone-agent limitation

Runware can generate audio, but its current audio API does not provide speech-to-text. The phone workflow therefore needs telephony plus transcription outside Runware, after which `deepseek:v4@flash` can analyse the transcript. Keep this adapter separate so the provider can be replaced later.

## Build order

1. Database schema and simulated observation ingestion
2. Deterministic baseline/trend and red-flag engine
3. Runware structured-output adapter
4. Dashboard and clinician API endpoints
5. Transcript ingestion, then live phone integration
