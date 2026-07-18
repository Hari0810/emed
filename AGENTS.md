# Project Summary

## Vision

Build an **AI-powered chronic disease copilot** that continuously monitors a person's health using both passive sensor data and active conversation, then intervenes *before* deterioration becomes clinically significant.

Rather than replacing clinicians, it acts as an intelligent layer between the patient and healthcare system.

The goal is:

- reduce unnecessary appointments
- detect genuine deterioration earlier
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

For the hackathon these can all be stubbed/simulated.

### Active sensing

The AI periodically asks questions like:

> "How have you felt today?"

or

> "Has your fatigue been worse than yesterday?"

This captures information sensors cannot.

### Objective + Subjective together

One of the strongest ideas: combine **objective measurements** with **subjective experience**.

Patient says *"I feel awful."* — sensors show 8 hours sleep, normal HRV, normal resting HR, normal activity → likely transient issue.

Patient says *"I'm completely fine."* — sensors show HR increasing, activity collapsing, weight increasing, sleep worsening → potentially concerning trend.

Neither source alone is sufficient.

---

## Behavioural Sensing

A major differentiator. Rather than looking only at physiology, we infer behaviour:

- walking less every week
- sleeping later
- medication becoming inconsistent
- eating at unusual times
- becoming socially withdrawn
- exercise gradually disappearing

These trends often occur before clinical deterioration.

---

## AI Digital Twin

Rather than static thresholds, we model *"What is normal for this individual?"*

The AI learns usual sleep, usual heart rate, normal variability, medication habits, and activity patterns. It predicts where the patient is heading rather than simply reporting where they are.

---

## Trend Detection

Instead of reacting to single events, detect:

- worsening over days
- worsening over weeks
- gradual behavioural drift

Example — Week 1: 10k steps, Week 2: 8k, Week 3: 6k, Week 4: 4k. Even though every individual day might still appear "acceptable," the overall trend is concerning.

---

## Seriousness Detection

Current apps generate too many alerts. Instead, the AI estimates confidence, severity, likely cause, and urgency:

| Confidence | Action |
| --- | --- |
| Low | continue monitoring |
| Medium | ask additional questions |
| High | recommend contacting clinician |
| Very high | automatically flag clinician |

---

## Doctor Workflow

Doctors don't want more dashboards. They want fewer interruptions.

Instead of sending every data point, the AI produces:

> "Patient has shown a sustained decline over 10 days.
>
> Medication adherence fell from 96% to 63%.
>
> Resting HR increased 14%.
>
> Sleep reduced 1.8h/night.
>
> Confidence: High."

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

## Diseases We Considered

Initially obesity and GLP-1 support, then expanded into broader chronic disease management. Possible focus areas:

- hypertension
- cardiometabolic disease
- type 2 diabetes
- PCOS
- autoimmune diseases with flare-ups
- cardiovascular disease

The architecture is largely disease-agnostic.

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
- **Trend Analysis:** Detects behavioural drift and physiological changes over time.
- **Risk Engine:** Produces an overall health score, confidence level, and rationale.
- **Clinician View:** Displays concise summaries with evidence and recommended actions rather than raw telemetry.

---

## Existing Inspiration

- **Folia Health** — patient-reported outcomes and symptom tracking.
- **Digital twins** in healthcare — personalised computational models of patients.
- Existing remote monitoring platforms — generally strong at collecting data but weaker at reasoning across multiple modalities and proactively identifying meaningful changes.

This concept aims to bridge that gap by combining passive sensing, conversational AI, longitudinal reasoning, and clinician-oriented decision support.

---

## Overall Value Proposition

> **An AI copilot for chronic disease management that continuously combines passive sensor data and natural conversation to learn each patient's baseline, detect meaningful behavioural and physiological changes early, and surface only clinically relevant insights to patients and healthcare professionals.**
