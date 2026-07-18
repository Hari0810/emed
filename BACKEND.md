# Unflare backend recommendation

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
