<h1 align="center">MediRec</h1>
<p align="center">A medication reconciliation app built on Medplum (FHIR) with an AI-assisted bottle-capture workflow.</p>
<p align="center">
  <a href="./LICENSE.txt">
    <img src="https://img.shields.io/badge/license-Apache-blue.svg" />
  </a>
</p>

MediRec helps a nurse reconcile what a patient's EHR record says they're taking against what's
actually in the medicine cabinet at home. A nurse photographs each pill bottle during a home visit;
the app reads the label, resolves the drug to a standard code, and compares it against the
patient's active `MedicationRequest`s in Medplum — flagging matches, dose conflicts, duplicate
products, and medications that are on file but were never found (or vice versa).

It also includes a lightweight patient-intake flow that checks insurance eligibility/coverage
from demographics alone at the time a patient is created.

## What it does

- **Patient list & profile** — search patients, view demographics, active medications, coverage,
  FHIR timeline, and edit/version history (`src/pages/HomePage.tsx`, `src/pages/PatientPage.tsx`).
- **Create patient + eligibility discovery** — creates a `Patient`, then calls a Stedi-backed API
  route to discover insurance coverage from name/DOB/address and writes the results as `Coverage`
  resources (`src/pages/CreatePatientPage.tsx`, `api/eligibility.ts`).
- **Medication reconciliation session** — a full-screen capture flow: photograph a bottle, extract
  the drug name/strength/dose via Gemini vision, resolve it to an ingredient-level RxNorm code, and
  compute a verdict against the EHR's active medications (`src/pages/capture/CaptureSessionPage.tsx`,
  `api/extract.ts`, `src/capture/`).
- **Add an intended medication** — record a `MedicationRequest` the prescriber intends the patient
  to be on, picked from a local drug catalog (`src/pages/capture/AddMedicationPage.tsx`).
- **Roadmap placeholders** — Dashboard, org-wide Medications, Tasks, Care Coordination, Reports, and
  Settings are wired into navigation but currently render a "Coming soon" screen
  (`src/pages/ComingSoonPage.tsx`, routes in `src/App.tsx`).

## Architecture

```
src/
  App.tsx                 Route table + full-screen vs. app-shell layout switch
  main.tsx                MedplumClient + Mantine theme + provider setup
  hooks/usePatient.ts      Resolves :patientId from the URL to a FHIR Patient
  components/              Shared page fragments (layout, patient tabs, stat cards, coverage, timeline)
  pages/                   Route-level pages
  pages/capture/           The reconciliation capture flow (camera, extraction, verdicts)
  capture/                 Framework-agnostic reconciliation logic, shared by mock and real backends
  theme/tokens.ts          Design tokens (colors) used across components

api/
  extract.ts               Vercel function: pill-bottle photo -> {drug, strength, dose, confidence}
  eligibility.ts            Vercel function: demographics -> discovered insurance coverage + COB
  drug_index.json           Seed data for the moss.dev drug-name search index
```

`src/pages/patient/` is an unrouted leftover from the original Medplum starter template — nothing
in the app imports it. It's left in place but isn't part of the live app.

### The mock/real backend split (important)

The reconciliation logic (`computeVerdict` in `src/capture/verdict.ts`) is a pure function shared
by two backends behind `src/capture/medplumApi.ts`:

- **`src/capture/mockBots.ts`** — an in-memory/`sessionStorage`-backed fake, used when
  `MEDPLUM_MOCK_BOTS` is **not** the literal string `"false"`. **The default is mock mode** — the
  check is `import.meta.env.MEDPLUM_MOCK_BOTS !== 'false'`, so simply leaving the variable unset
  (or blank) keeps you on mock data.
- **`src/capture/realFhir.ts`** — creates real FHIR `Encounter`/`MedicationStatement` resources in
  Medplum. Verdict details (evidence, `ehrSays`/`homeSays`, suggested action) don't have a natural
  FHIR field, so they're round-tripped as JSON in `MedicationStatement.note[0].text` and parsed
  back out when building a session summary.

To switch to the real backend, set `MEDPLUM_MOCK_BOTS=false` in `.env`. The `MEDPLUM_BOT_*`
variables in `.env.defaults` (`MEDPLUM_BOT_SESSION_START`, `MEDPLUM_BOT_CHECK_MED`,
`MEDPLUM_BOT_SESSION_SUMMARY`) are not referenced anywhere in the code — they're vestigial from an
earlier bot-based design and can be ignored.

### Three independent fallback layers

These are easy to conflate but are unrelated to each other:

1. **Mock vs. real reconciliation backend** — `MEDPLUM_MOCK_BOTS`, described above.
2. **Drug-name → RxNorm code resolution** (`api/extract.ts`) — normally resolved via a moss.dev
   semantic search index seeded from `api/drug_index.json`. If moss.dev is unreachable (e.g. its
   native binary can't load in the current runtime) or isn't configured
   (`MOSS_PROJECT_ID`/`MOSS_PROJECT_KEY` unset), it falls back to `localCatalogMatch`, a
   deterministic substring match over the same seed data — it only returns a code on an actual
   match, never a guess.
3. **Insurance eligibility discovery** (`api/eligibility.ts`) — normally calls Stedi's Insurance
   Discovery and Coordination of Benefits APIs. Stedi test-mode API keys don't support these
   endpoints, so on failure it returns clearly-labeled demo data (`mockDiscovery`) instead, with a
   `note` field the UI surfaces as a "Demo data" banner.

### Verdicts

`computeVerdict` (in `src/capture/verdict.ts`) classifies each captured medication as one of:

| Verdict | Meaning |
| --- | --- |
| `MATCH` | Matches an active EHR medication |
| `DOSE_CONFLICT` | Same product, different strength/frequency than the EHR |
| `DUPLICATE` | Same ingredient, different product form (e.g. succinate vs. tartrate) — possibly double-dosing |
| `NOT_IN_EHR` | Found at home but not on the active EHR medication list |
| `NOT_IN_HOME` | Active on the EHR but no matching bottle was found during the session |
| `UNRESOLVED` | Couldn't identify the medication at all |

Each verdict also carries a `severity` (`auto`, `review`, `must_resolve`) used to color-code the UI
and tally the session summary. Precedence when multiple conditions could apply:
`DUPLICATE > DOSE_CONFLICT > NOT_IN_EHR > MATCH`, with `UNRESOLVED` short-circuiting everything
else when the medication couldn't be identified at all.

## Getting Started

Register a Medplum project by following [this tutorial](https://www.medplum.com/docs/tutorials/register).

Install dependencies:

```bash
npm install
```

Copy the environment defaults and fill in secrets:

```bash
cp .env.defaults .env
```

Then run the app:

```bash
npm run dev
```

This serves the app on `http://localhost:3000/`. Vite's dev server also proxies `/api/extract` and
`/api/eligibility` through a small middleware (`apiDevPlugin` in `vite.config.ts`) that reuses the
same Vercel-style handler functions, so there's no need to run `vercel dev` locally.

### Environment variables

Client-exposed config (must be prefixed `MEDPLUM_`, per `vite.config.ts`'s `envPrefix`):

| Variable | Purpose |
| --- | --- |
| `MEDPLUM_BASE_URL` | Medplum API base URL |
| `MEDPLUM_CLIENT_ID` | Medplum OAuth client ID used by the sign-in form |
| `MEDPLUM_MOCK_BOTS` | `"false"` to use the real FHIR reconciliation backend; anything else (including unset) uses the mock backend |

Server-only secrets (never prefixed `MEDPLUM_`, so Vite never bundles them into client code — set
these in your gitignored `.env`, not `.env.defaults`):

| Variable | Used by | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | `api/extract.ts` | Calls Gemini vision to read pill bottle labels |
| `MOSS_PROJECT_ID` / `MOSS_PROJECT_KEY` | `api/extract.ts` | moss.dev semantic search for drug-name → RxNorm resolution |
| `STEDI_API_KEY` | `api/eligibility.ts` | Stedi Insurance Discovery / Coordination of Benefits |
| `STEDI_PROVIDER_NPI` | `api/eligibility.ts` | Provider NPI sent with Stedi requests; falls back to Stedi's public test/demo NPI if unset |

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server (with API middleware) on port 3000 |
| `npm run build` | Type-check, then build for production |
| `npm run preview` | Preview a production build locally |
| `npm run lint` / `npm run lint:fix` | Lint (and autofix) with the Medplum ESLint config |

## About Medplum

[Medplum](https://www.medplum.com/) is an open-source, API-first EHR. This app uses Medplum's
hosted service as its FHIR backend, plus [Medplum React components](https://storybook.medplum.com/)
for patient search, resource tables, timelines, and history.

- Read the [Medplum documentation](https://www.medplum.com/docs)
- Browse the [React component library](https://storybook.medplum.com/)
- Join the [Medplum Discord](https://discord.gg/medplum)
