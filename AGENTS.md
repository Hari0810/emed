# Project Summary

## Disease Focus

The hackathon MVP is specifically designed for **ANCA-associated vasculitis (AAV)**, including granulomatosis with polyangiitis (GPA) and microscopic polyangiitis (MPA). Eosinophilic granulomatosis with polyangiitis (EGPA) also sits within the AAV family but has distinct manifestations and care pathways; subtype-specific logic must be designed with clinical input rather than assumed to transfer unchanged.

AAV is a rare group of autoimmune diseases in which inflammation of small blood vessels can damage organs. Relapses can be serious, but their timing and causes vary substantially between patients. Many relapses have no clear behavioural trigger and are never the patient's fault.

The product therefore does **not** position everyday behaviour as the primary cause of disease activity. Its core purpose is to:

- detect subtle, sustained changes that may precede a flare
- track medication adherence and symptom changes around clinician-directed dose tapers
- capture infections, stress, and environmental exposures as clinical context rather than proven causes
- help distinguish possible disease activity from medication side effects or ordinary day-to-day variation
- give clinicians a concise longitudinal record that supports earlier review

This is an early-warning and care-coordination tool, not a diagnostic system or a substitute for a rheumatology or vasculitis care team.

---

## Vision

Build an **AI-powered ANCA-associated vasculitis copilot** that continuously monitors a person's health using both passive sensor data and active conversation, then helps identify possible deterioration before it becomes clinically significant.

Rather than replacing clinicians, it acts as an intelligent layer between the patient and healthcare system.

The goal is:

- reduce avoidable appointments while supporting timely clinical review
- detect patterns consistent with genuine deterioration earlier
- improve adherence
- make clinicians' lives easier by surfacing only actionable issues

---

## Core Idea

Most healthcare today only sees:

- occasional appointments
- occasional blood tests
- self-reported symptoms

We're trying to reconstruct what happens during the **other 99% of life.**

Instead of isolated snapshots, we build a continuous picture.

### Passive sensing

- smartwatch data
- phone sensors
- sleep
- activity
- heart rate
- HRV
- weight
- blood pressure
- glucose (future)
- medication adherence
- environmental context
- temperature, when available

For the hackathon these can all be stubbed/simulated.

### Clinical data

Wearables alone are insufficient for AAV. When available, the timeline should also incorporate clinician-ordered observations such as:

- kidney function, including creatinine and eGFR
- urinalysis findings, including blood and protein
- inflammatory markers and full blood count
- blood pressure and weight changes
- treatment dates, doses, and infusion history
- clinician assessments and confirmed infections

These data remain supporting evidence. No single result, including an ANCA level, should be used by the app alone to confirm a flare or direct treatment.

### Active sensing

The AI periodically asks questions like:

> "How have you felt today?"

or

> "Has your fatigue been worse than yesterday?"

or

> "Have you noticed new sinus symptoms, joint pain, breathlessness, blood in your urine, a new rash, numbness, or unusual weakness?"

This captures information sensors cannot.

### Objective + Subjective together

One of the strongest ideas: combine **objective measurements** with **subjective experience**.

Patient says *"I feel awful."* — sensors show 8 hours sleep, normal HRV, normal resting HR, and normal activity → the report still matters; normal wearable data cannot rule out infection, medication effects, or vasculitis activity.

Patient says *"I'm completely fine."* — sensors show heart rate increasing, activity declining, weight increasing, and sleep worsening → ask targeted follow-up questions and assess the combined trend rather than assuming deterioration.

Neither source alone is sufficient.

---

## Behavioural Sensing

A major differentiator. Rather than looking only at physiology, we observe behaviour and function:

- walking less every week
- sleeping later
- medication becoming inconsistent
- eating at unusual times
- becoming socially withdrawn
- exercise gradually disappearing

For AAV, these observations are treated as changes from the individual's baseline, not proof that a behaviour caused a flare. A reduction in activity, worsening sleep, or social withdrawal may be an early consequence of fatigue, pain, infection, medication side effects, or disease activity.

The app also records clinically relevant context:

- missed or delayed maintenance medication
- clinician-directed steroid or immunosuppressant dose changes
- recent colds, flu, COVID-19, or sinus infections
- periods of marked emotional or physical stress
- surgery, injury, or severe exhaustion
- relevant occupational or environmental exposure, such as heavy silica dust exposure

These associations vary between people and should be presented as context for clinical interpretation, never as certain causation.

---

## AI Digital Twin

Rather than static thresholds, we model *"What is normal for this individual?"*

The AI learns usual sleep, heart rate, variability, medication routine, activity, symptoms, and functional capacity. It estimates whether the person is departing from their own baseline rather than relying only on population thresholds.

For AAV, the model must combine patient-reported symptoms, medication history, passive trends, infections, and available clinical observations. It must not infer that normal wearable data rules out a flare, because important organ involvement may not be visible through consumer sensors.

---

## Trend Detection

Instead of reacting to single events, detect:

- worsening over days
- worsening over weeks
- gradual behavioural drift
- symptom changes following a medication taper
- clusters of weak signals that become concerning together

Example — over 10 days, activity steadily declines, fatigue and joint aches increase, resting heart rate rises, and the patient reports persistent sinus symptoms shortly after a medication dose reduction. No single observation diagnoses a flare, but the combined trend warrants targeted follow-up and may justify clinician review.

### Slow-burn flare detection

Potential early changes can be vague and easy to dismiss or forget. The timeline should make gradual changes visible, including:

- increasing fatigue or reduced functional capacity
- low-grade fever or feeling feverish
- new or increasing joint or muscle aches
- persistent or worsening sinus, nasal, or ear symptoms, especially in GPA
- new cough, breathlessness, or chest symptoms
- new rash or other skin changes
- numbness, tingling, or weakness
- urinary changes, including visible blood
- a general sense of feeling progressively less well

These are monitoring signals, not a complete diagnostic checklist. New or severe breathing problems, coughing blood, visible blood in urine, marked weakness, or other rapidly worsening symptoms should trigger clear urgent-care guidance rather than routine app monitoring.

---

## Seriousness Detection

Current apps generate too many alerts. Instead, the AI estimates confidence, severity, possible explanations, and urgency. It should avoid claiming a single "likely cause" when flare, infection, medication side effects, and unrelated illness remain difficult to distinguish remotely.

| Confidence | Action |
| --- | --- |
| Low | continue monitoring |
| Medium | ask additional questions |
| High | recommend prompt contact with the care team |
| Very high | escalate according to an agreed clinical pathway and show urgent-care guidance |

Confidence is confidence that a pattern merits attention, not confidence in a diagnosis. Medication changes must never be recommended autonomously; the patient should continue prescribed treatment and contact their care team for advice.

---

## Doctor Workflow

Doctors don't want more dashboards. They want fewer interruptions.

Instead of sending every data point, the AI produces:

> "Patient has shown a sustained decline over 10 days following a clinician-directed prednisone reduction.
>
> Fatigue and joint pain increased, with new persistent sinus symptoms.
>
> Daily activity fell 32% and resting heart rate increased 14% from personal baseline.
>
> Medication adherence remained 96%; a recent respiratory infection was reported.
>
> Triage confidence: High. Suggested action: care-team review."

Doctors receive **signal**, not raw data.

Potential future features:

- clinician inbox
- triage
- appointment recommendations
- auto-booking
- draft clinical summaries

---

## Phone AI Agent

Instead of questionnaires, the AI phones the patient. It asks health questions, records a transcript, analyses answers, and updates the health model.

Especially useful for elderly users or those less comfortable with apps.

---

## Why ANCA-Associated Vasculitis

AAV is a strong use case for multimodal longitudinal monitoring precisely because simple behaviour-to-symptom attribution is unreliable. The app's value is not "trigger detective" functionality or a promise that lifestyle changes can prevent relapse. Its value comes from preserving context that is difficult to reconstruct during an occasional appointment:

- the exact timing of prescribed medication tapers and missed doses
- subtle symptom progression across days or weeks
- infection history that may otherwise be forgotten
- the relationship between medication timing and possible side effects
- objective changes in activity, sleep, heart rate, and function
- patient-specific warning signs learned from previous episodes

The wider platform may eventually support other chronic diseases, but MVP language, simulated data, symptom questions, risk logic, and clinician summaries should all be designed and evaluated for AAV first.

### What the product must not claim

- that a patient's behaviour caused their flare
- that every flare has an identifiable or preventable trigger
- that diet, exercise, sleep, or stress control can replace immunosuppressive treatment
- that consumer wearable readings can confirm or rule out active vasculitis
- that the app can diagnose a flare or safely direct medication changes
- that correlation in a personal timeline proves causation

---

## Why AI Now?

Modern LLMs enable capabilities that were difficult two years ago:

- natural health conversations
- longitudinal reasoning
- summarising months of history
- multimodal reasoning across sensor data and text
- personalised coaching
- adaptive questioning
- clinician-ready summaries
- personalised baseline modelling

This is more than a chatbot — it's a reasoning layer over continuous health data.

---

## Hackathon MVP

Since wearable integration won't be available during the hackathon, the MVP simulates data while showcasing the intelligence.

- **Frontend:** Patient dashboard showing trends, alerts, and health timeline.
- **AI Phone Agent:** Places a call, asks structured health questions, and records a transcript.
- **Health Timeline:** Combines simulated wearable data with conversation-derived symptoms.
- **Medication Timeline:** Aligns adherence and clinician-directed dose changes with symptoms, side effects, infections, and passive data.
- **Trend Analysis:** Detects behavioural, functional, symptom, and physiological changes over time without claiming causation.
- **Triage Engine:** Produces an attention level, confidence, evidence, and a safe recommended next step rather than diagnosing a flare.
- **Clinician View:** Displays concise summaries with evidence and recommended actions rather than raw telemetry.

---

## Existing Inspiration

- **Folia Health** — patient-reported outcomes and symptom tracking.
- **Digital twins** in healthcare — personalised computational models of patients.
- Existing remote monitoring platforms — generally strong at collecting data but weaker at reasoning across multiple modalities and proactively identifying meaningful changes.

This concept aims to bridge that gap by combining passive sensing, conversational AI, longitudinal reasoning, and clinician-oriented decision support.

---

## Overall Value Proposition

> **An AI copilot for ANCA-associated vasculitis that combines passive sensor data, medication history, and natural conversation to learn each patient's baseline, identify subtle patterns of possible deterioration earlier, and surface concise, clinically relevant evidence to patients and healthcare professionals.**
