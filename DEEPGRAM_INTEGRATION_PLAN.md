# Deepgram Integration Plan

## Current Architecture

This repository is a Vite React app using React 19, React Router 7, Mantine 8, and Medplum 5.1.27. The browser app is mounted in `src/main.tsx`, where a single `MedplumClient` is created and passed through `MedplumProvider`; `App` then renders Medplum's `AppShell` and all routes.

The app is deployed as a Vercel static Vite app with serverless functions under `api/`. `vercel.json` serves the `dist` build and falls back non-file routes to `/` for client-side routing. Local development uses `vite.config.ts`; it already includes a dev middleware for the Vercel-style `/api/extract` function.

SMART/FHIR authentication is currently handled entirely by Medplum React components in the browser. `SignInPage` uses `SignInForm` with `MEDPLUM_CLIENT_ID`; `main.tsx` initializes the Medplum client with `MEDPLUM_BASE_URL`; `useMedplumProfile()` determines whether the user is signed in. Patient context is route-based via `/Patient/:id` and `useParams()`.

FHIR reads and writes happen from the browser through the Medplum client:

- `PatientMedications` reads `MedicationRequest` resources for the current patient.
- `AddMedicationPage` creates active `MedicationRequest` resources.
- `CaptureSessionPage` starts a reconciliation session, captures medication images, and posts image data to `/api/extract`.
- `src/capture/realFhir.ts` can create an `Encounter`, create `MedicationStatement` resources for captured home meds, and summarize reconciliation results.
- `src/capture/mockBots.ts` supplies a session-storage mock path unless `MEDPLUM_MOCK_BOTS=false`.

There is one existing server endpoint:

- `POST /api/extract`: accepts `{ "image": "<base64 JPEG>" }`, calls Gemini OCR, resolves an ingredient-level RxNorm key through moss.dev or a local catalog, and returns `{ med, confidence }`.

## Relevant Files

- `src/main.tsx`: global providers and Medplum client initialization.
- `src/App.tsx`: active app shell and route tree.
- `src/pages/SignInPage.tsx`: Medplum sign-in entry.
- `src/pages/PatientPage.tsx`: active patient route layout.
- `src/pages/capture/CaptureSessionPage.tsx`: camera capture, `/api/extract` call, session summary UI.
- `src/pages/capture/AddMedicationPage.tsx`: direct `MedicationRequest` creation for test/intended meds.
- `src/components/PatientMedications.tsx`: active medication-list display.
- `src/capture/types.ts`: reconciliation session DTOs.
- `src/capture/realFhir.ts`: real Medplum-backed session/reconciliation functions.
- `src/capture/mockBots.ts`: local mock session functions.
- `src/capture/verdict.ts`: pure medication comparison logic.
- `src/capture/image.ts`: browser-side image downscale/capture helpers.
- `api/extract.ts`: current server-side computer-vision/OCR extraction function.
- `vite.config.ts`: Vite config and local API-function middleware.
- `.env.defaults`: client and server environment defaults.

There is also an older `src/pages/patient/PatientPage.tsx` subtree that is not wired into `src/App.tsx` and expects a different route param shape. Deepgram should not be mounted there.

## Existing And Missing Endpoints

Existing:

- `POST /api/extract`: current medication-label photo extraction. This is useful but narrowly named and does not expose the future CV app contract.

Recommended smallest endpoint set:

- `POST /api/deepgram/token`: create a short-lived Deepgram JWT from server-side `DEEPGRAM_API_KEY`.
- `POST /api/medications/identify`: stable wrapper contract for the existing/future CV medication-identification service.

Defer until a real voice workflow exists:

- `POST /api/voice/session`: only needed when voice sessions must be audited or tied to a server-side SMART user.
- `POST /api/medications/reconcile`: current reconciliation is in `src/capture/realFhir.ts`; move this server-side only when auth validation and review semantics are defined.
- `POST /api/medications/confirm`: should not write final FHIR resources until clinician-review rules are explicit.
- `POST /api/fhir/context`: only needed if the voice agent cannot get sufficient context through validated tool calls.
- `POST /api/voice/tool`: useful later as a single Deepgram tool dispatcher, but it should validate a strict allowlist and caller context first.

## Recommended Endpoint Architecture

```text
Browser React app
  |
  | POST /api/deepgram/token
  v
Vercel function -> Deepgram /v1/auth/grant -> short-lived JWT only

Browser capture flow
  |
  | POST /api/medications/identify
  v
Vercel function -> existing local /api/extract logic OR external CV app
  |
  v
Normalized medication-identification result
```

The permanent Deepgram API key must stay server-side. Deepgram's token endpoint is `POST https://api.deepgram.com/v1/auth/grant`, using `Authorization: Token <apiKey>`; the response contains a temporary JWT and expiry. Temporary tokens are appropriate for browser-side realtime voice connections because the SMART token and permanent Deepgram key are never sent to Deepgram.

## Proposed Deepgram Tools

The first implementation should use narrowly scoped function-calling tools, not unrestricted FHIR access.

| Tool | Purpose | Input | Output | Internal Service | Patient Confirmation | Clinician Review | Failure States |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `get_current_medication_list` | Read active medication list for current patient. | `{ patientId, sessionId? }` | `{ medications, warnings }` | Future server FHIR context service or current `realFhir.activeEhrMeds` equivalent | No | No | patient not found, unauthorized patient, FHIR read failure |
| `identify_medication_image` | Identify a medication from a captured image or image ID. | `{ patientId, sessionId?, image?, imageId?, contentType? }` | `MedicationIdentifyResponse` | `POST /api/medications/identify` | Yes | Usually if low confidence or unresolved | missing image, invalid file type, oversized image, CV unavailable |
| `compare_identified_medication` | Compare normalized home med against active EHR meds. | `{ patientId, sessionId, medication, confidence }` | `{ verdict, evidence, suggestedAction }` | Existing `computeVerdict` through server API later | Yes | Yes for conflicts/additions/uncertainty | no session, missing RxNorm key, FHIR read failure |
| `confirm_medication` | Record patient confirmation/correction of a candidate medication. | `{ patientId, sessionId, medication, confirmation, correction? }` | `{ status, reviewRequired, draftResourceId? }` | Future `POST /api/medications/confirm` | Yes | Yes unless workflow authorizes final write | unauthorized, invalid correction, write blocked |
| `correct_medication` | Capture patient-provided correction before comparison. | `{ patientId, sessionId, previousMedication, correctedMedication }` | `{ medication, requiresConfirmation }` | Client/server validation helper | Yes | If materially changes record | invalid medication fields, no active session |
| `create_medication_review_task` | Create clinician-review work item for unresolved/conflicting meds. | `{ patientId, sessionId, reason, medication?, evidence }` | `{ taskId, status }` | Future Task-writing endpoint | No | Yes | missing reason, unauthorized write, FHIR write failure |
| `get_patient_allergies` | Read allergy context relevant to medication discussion. | `{ patientId }` | `{ allergies, warnings }` | Future limited FHIR context endpoint | No | No | unauthorized, FHIR read failure |
| `get_preferred_language` | Choose voice-agent language hints. | `{ patientId }` | `{ language, source }` | Future limited FHIR context endpoint | No | No | missing patient context, unknown language |
| `end_medication_reconciliation` | Summarize open conflicts and stop session. | `{ patientId, sessionId }` | `{ summary, unresolvedCount, mustReviewCount }` | Existing `getSummary` equivalent through server API later | No | Yes if unresolved items remain | no session, summary failure |

Detailed TypeScript interfaces and JSON-schema metadata live in `src/voice/types.ts`.

## Computer-Vision API Contract

This repo already has camera access, image capture, image downscaling, OCR-like medication extraction, and a local drug catalog. It does not yet have an external CV medication-identification service or image storage.

The future CV app should expose this contract:

`POST /api/medications/identify`

Request:

```json
{
  "image": "<base64 image payload without data URL prefix>",
  "contentType": "image/jpeg",
  "imageId": null
}
```

Response:

```json
{
  "status": "possible_match",
  "medication": {
    "name": "Metformin",
    "strength": "500 mg",
    "strengthMg": 500,
    "dosageForm": "tablet",
    "imprint": "IP 204",
    "manufacturer": null,
    "rxnormCode": "6809",
    "rawText": "label OCR text"
  },
  "confidence": 0.91,
  "alternatives": [],
  "warnings": [],
  "requiresConfirmation": true,
  "source": "external_cv_service"
}
```

Accepted content types should be `image/jpeg`, `image/png`, and `image/webp`. The app should reject missing images, unsupported types, and oversized base64 payloads before forwarding anything to a CV service.

## FHIR Strategy

Current requested SMART scopes are controlled by the Medplum app/client configuration, not hardcoded in this repository. The code currently reads `Patient`, `MedicationRequest`, `MedicationStatement`, and `Encounter`; it can write `MedicationRequest`, `MedicationStatement`, and `Encounter` through the browser Medplum client.

Recommended resource usage:

- Read: `Patient`, active `MedicationRequest`, `MedicationStatement`, `AllergyIntolerance`, possibly `Encounter`.
- Draft/review write: `Task` for clinician review, possibly `Communication` for notes.
- Reconciliation evidence: `MedicationStatement` is acceptable for patient-reported home meds, but unresolved/conflicting results should be draft/review-only until workflow policy is clear.
- Avoid final medication-list changes from voice alone. Creating/updating final `MedicationRequest` should require explicit clinician authorization.

Patient and encounter context should be passed to the voice agent only as minimal IDs and summarized medication context from validated server tools. The SMART access token must never be sent to Deepgram.

## Persistent Voice Agent Placement

Mount the persistent Deepgram widget just inside `AppShell` in `src/App.tsx`, above `Routes` and inside `MedplumProvider`. That location has access to Medplum profile state and survives navigation between patient overview, medications, capture, and summary routes. Mounting inside `CaptureSessionPage` would restart the Deepgram connection when navigating away from capture. Mounting in the unused `src/pages/patient/PatientPage.tsx` would not affect the active route tree.

The agent should be always available, but not always listening. The microphone state must be visible and the user must explicitly start/stop listening.

## Security Risks

- Current Vercel API functions do not validate Medplum authentication server-side.
- `POST /api/extract` accepts unauthenticated image payloads today.
- A Deepgram token endpoint without app-level auth can be abused for project usage even if it does not expose the permanent key.
- Browser-side Medplum writes mean patient IDs come from the route and must be treated carefully.
- `api/extract.ts` logs generic extraction failures. Avoid logging raw OCR text, images, transcripts, or secrets.
- Do not store voice transcripts automatically.
- Do not send SMART access tokens, Medplum refresh tokens, or unrestricted FHIR credentials to Deepgram.

Before production, add server-side auth validation for all new API endpoints. A reasonable next step is a backend session or a Medplum token validation strategy that verifies the caller and patient context before returning voice tokens or patient summaries.

## Data Flow

```text
Patient microphone
        |
        v
Deepgram Voice Agent
        |
        v
Validated function call
        |
        v
Application backend
   +----+----------------+
   |                     |
   v                     v
FHIR server       Medication vision API
   |                     |
   v                     v
Existing meds       Possible medication
   +----------+----------+
              |
              v
Reconciliation comparison
              |
              v
Patient confirmation
              |
              v
Clinician review or authorized FHIR write
```

## Implementation Sequence

1. Add shared env/config helpers for server-only settings.
2. Add `POST /api/deepgram/token` using server-side `DEEPGRAM_API_KEY` and short-lived Deepgram tokens.
3. Add shared voice-tool TypeScript types and schemas.
4. Add shared medication-vision request/response types.
5. Add a medication-vision server client that can call an external CV service or the existing local extraction path.
6. Add `POST /api/medications/identify` as the stable CV contract wrapper.
7. Later, add a persistent React Deepgram widget at the `AppShell` level and connect it to the token endpoint.
8. Later, move reconciliation and confirmation workflows behind authenticated server endpoints with clinician-review semantics.

## Open Questions

- What auth strategy should Vercel functions use to validate the current Medplum user and patient context?
- Should medication confirmation create `MedicationStatement`, `Task`, `QuestionnaireResponse`, or a domain-specific review queue first?
- Will the CV app accept base64 JSON, multipart upload, or image IDs from object storage?
- Should image storage be ephemeral, or should images be stored as FHIR `DocumentReference` after explicit consent?
- Which Deepgram agent model, language behavior, and tool-calling schema should be used for production?
