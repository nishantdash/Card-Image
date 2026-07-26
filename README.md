# Hyperface · AI Card Personalization

A prototype for a bank's custom debit/credit card artwork service. Customers design
card artwork with AI (or stylize their own photo); every submission passes through a
moderation pipeline before it can reach an embosser. Bank operations staff review
whatever the pipeline routes to a human.

Because artwork is physically printed on a payment card issued to a named customer,
the moderation bar is deliberately higher than for general web content.

- **Stack:** React 18 + Vite 5, Vercel serverless functions, no UI framework
- **Image provider:** Google Gemini (`gemini-2.5-flash-image`, "Nano Banana")
- **Moderation:** Gemini multimodal classifier + deterministic blocklists

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # 84 tests, no watch mode
npm run build          # production build to dist/
```

`npm run dev` also mounts the `api/` serverless handlers on the Vite dev server (see
`vite.config.js`), so the server-enforced generation path is testable locally
without `vercel dev`.

Generation needs a key. Without one the app still runs end-to-end — moderation and
routing work, and the UI falls back to offline sample artwork.

---

## Configuration

Copy `.env.example` to `.env` and fill in what you need. The full reference lives in
that file; the essentials:

### Required (server-side)

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Image generation **and** moderation. Read only by `api/generate.js`. |

> **Not** `VITE_`-prefixed, deliberately. Vite inlines `VITE_*` variables into the
> public client bundle, where they are readable in devtools. This key must never be
> exposed to the browser.

On Vercel: **Project → Settings → Environment Variables**, then redeploy.

### Optional (moderation)

| Variable | Default | Purpose |
|---|---|---|
| `MODERATION_PROVIDER` | `gemini` | `gemini` (text + image), `openai` (omni-moderation), `huggingface` (text only) |
| `MODERATION_ENABLED` | `true` | Kill switch. When off, nothing can auto-approve. |
| `MODERATION_TIMEOUT_MS` | `9000` | Per-classification timeout. |
| `MODERATE_OUTPUT_IMAGES` | `true` | Also classify generated artwork, not just inputs. |
| `OPENAI_API_KEY` / `HF_TOKEN` | — | Only for the corresponding provider. |

Default `gemini` reuses `GEMINI_API_KEY`, so moderation is active as soon as
generation works — no second credential.

### Optional (local development only)

| Variable | Purpose |
|---|---|
| `VITE_ALLOW_DIRECT_PROVIDER` | Lets the browser call the image provider directly. |
| `VITE_GEMINI_API_KEY` | Key for that path. Use a throwaway. |

This path applies the blocklists but **not** model moderation, and decides in the
browser where it can be bypassed. It is gated on `import.meta.env.DEV`, so a
production build cannot fall into it.

---

## Project structure

```
shared/                     # Framework-agnostic. No window, no fetch, no process.
  guardrails/
    terms.js                # Blocklists, grouped by severity (block vs review)
    normalize.js            # Obfuscation-resistant matching
    text.js                 # Prompt scanning + redaction
    name.js                 # Cardholder name validation
    score.js                # L4 risk aggregation + L5 routing
    modelPolicy.js          # Model verdict thresholds -> policy outcomes
    index.js                # evaluateSubmission() — the single decision point
  prompt.js                 # Prompt assembly + closed style vocabulary
  opsSeed.js                # Sample queue rows, seeded once, labelled in the UI

api/                        # Vercel serverless (server-only)
  generate.js               # The ONLY path to an image provider
  submissions.js            # Ops queue: list / create / decide
  _moderation.js            # Gemini / OpenAI / HuggingFace classifiers
  _store.js                 # KV persistence (Upstash REST) + memory fallback
  _verdict.js               # HMAC-signed verdict tokens

src/
  context/AppContext.jsx    # All journey + ops state
  lib/
    pipeline.js             # Layer orchestration & display status
    providers.js            # Transport: server path + local direct path
    useGeneration.js        # Generation hook, iteration counting, fallback art
    imageChecks.js          # Real DPI + Laplacian sharpness measurement
    bankTemplate.js         # AU Bank card template, embosser compositing
    settings.js, utils.js, opsApi.js
  components/customer/      # Builder, StepSource/Customize/Review/Result, Preview
  components/ops/           # OpsItem, ProviderSettings, HistoryPanel
  views/                    # CustomerView, OpsView, ArchitectureView

legacy/                     # Pre-React vanilla HTML/CSS/JS version. Not built or
                            # served; kept for reference only.
```

`shared/` is imported by **both** the browser bundle and the serverless function on
purpose. A client-side-only guardrail is a suggestion, and two separate
implementations drift.

---

## Moderation pipeline

Eight layers. Each reports what it actually did — a layer with no detector wired up
reports **"Not evaluated"**, never "Passed".

| Layer | Name | Status | What it does |
|---|---|---|---|
| L0 | Prompt Intelligence | ✅ | Blocklist + classifier on the prompt; redacts every hit before dispatch |
| L1 | Cardholder Name | ✅ | Profanity/slurs, embosser charset, structural checks |
| L2 | Upload Guardrails | ✅ | Real pixel dimensions, effective DPI, Laplacian sharpness |
| L3 | Image Analysis | ✅ | Classifier on the uploaded photo **and** each generated design; also scores prompt fidelity and print readiness |
| L4 | Risk Scoring Engine | ✅ | Weighted aggregation over *evaluated* signals |
| L5 | Auto Approval | ✅ | Server-enforced routing decision |
| L6 | Fraud Detection | ⬜ | Not implemented — needs pHash + durable storage |
| L7 | Continuous Learning | ⬜ | Not implemented — needs a decision feedback store |

### Routing thresholds

| Risk score | Outcome |
|---|---|
| `< 20` | Auto Approved |
| `< 45` | Quick Review |
| `< 70` | Manual Review |
| `>= 70` | Rejected |

Three things override the weighted score:

1. **Hard blocks** (profanity, slurs, weapons, adult/illegal) force `REJECTED`. A
   weighted average must never be able to average away a slur.
2. **Per-detector ceilings** — a single severe signal blocks on its own. With
   `nsfw` weighted at 0.18, a detector returning 95 contributes only ~17 points and
   would otherwise auto-approve.
3. **Unevaluated detectors** cap the outcome below auto-approval. An uninspected
   customer photo requires a human.

### Two independent detectors

Neither can veto the other; the stricter outcome wins.

- **Deterministic blocklists** — free, instant, resistant to leetspeak (`M0TH3RFUCK3R`),
  spaced letters (`g u n`), plurals (`guns`), accents, and concatenation (`ironman`).
  Works when the classifier API is down.
- **Model classifier** — 16 harm categories scored 0–100. Catches paraphrase a
  keyword list cannot: *"a lady wearing absolutely nothing at all"* scores 0 on the
  blocklist and is blocked by the model.

### Fail-closed, not fail-reject

If moderation times out, submissions route to **human review** — never
auto-approved (that would ship unmoderated artwork), never rejected (that would
tell a customer they violated policy when nothing actually checked). Google's own
safety filter refusing to classify is treated as a *positive* signal, not an outage.

---

## Output quality & prompt fidelity

Artwork is printed at **1713×1080 @ 600 DPI** (ISO/IEC 7810 ID-1). Three things
keep the output print-worthy:

**Native resolution.** Generation requests `imageSize: 2K`, falling back when a
model variant rejects the field. `shared/imageMeta.js` reads real dimensions from
the file header server-side and reports native resolution, upscale factor and
effective DPI. This matters because `composeEmbosserReadyArtwork` draws onto the
card canvas with `drawImageCover`, which will happily stretch a smaller image — it
looks fine in a browser preview and prints soft. An unmeasurable image is reported
as such, never assumed fine.

**Emboss-aware prompting.** Directives derived from the actual template zones: no
rendered text (it collides with the embossed number and name), and keep the lower
third and upper-left corner calm for the number, name and chip. The customer's own
words lead the prompt, because image models weight early tokens most heavily and
burying the request behind boilerplate is what makes output drift.

**Fidelity scoring.** The output-image classifier also scores, in the *same* vision
call so it costs no extra request:

| Score | Meaning |
|---|---|
| `prompt_match` | How faithfully the render realises the request |
| `visual_quality` | Sharpness, artefacts, gradient banding |
| `text_free` | Absence of rendered letters/numbers |
| `emboss_safe` | Clearance under the emboss zones |

Variations are ranked **best-match-first**, so the selected thumbnail is the
closest to the description rather than an arbitrary one. The customer sees a
"Match to your description" readout naming the specific element the model says is
missing. Fidelity is weighted heaviest in the overall score — a beautiful image of
the wrong thing is not a good result.

---

## Customer journey

Four steps, inside a mobile frame. The live card preview and name field sit
alongside every step.

| Step | Back control | Goes to |
|---|---|---|
| 1 · Start | — | — |
| 2 · Style | `Back` | Step 1 |
| 3 · Review | `✕ Cancel` | Step 2, run aborted |
| 4 · Result | `← Change design` | Step 2 |

- **Cancel** truly aborts — an `AbortController` threads into the `fetch`, so the
  browser drops the in-flight request. No error banner and no fallback artwork.
- Back navigation preserves everything: prompt, style selections, name, uploaded
  photo, and previously generated artwork.
- A run starts **only** on an explicit "Looks good", tracked by a run token — so
  returning to a previous page never silently regenerates.
- Back from step 4 goes to **step 2**, not step 3. Step 3 is a transient processing
  screen, not a destination.

### Style vocabulary

Validated server-side against a closed list (`shared/prompt.js`). Anything
unrecognised is dropped, which closes a prompt-injection channel through
`selections.mood`.

- **Style:** watercolor, cyberpunk, anime, minimal, oil-painting, vintage-poster, 3d-render
- **Mood:** vibrant, calm, dark, dreamy, futuristic
- **Palette:** warm, cool, monochrome, pastel, neon
- **Background:** city-skyline, mountains, abstract, cosmic

---

## Ops dashboard

Two tabs: **Review Queue** and **Architecture**.

Each queue item shows risk/safety/confidence, cohort approval, a signal breakdown,
and **generation attempts** with an orientation split — e.g. `3 (2H · 1V)`.

An iteration is counted every time the card image loader dispatches a request:

| Trigger | Counted |
|---|---|
| Initial generation | ✅ |
| "Try again" regeneration | ✅ |
| Horizontal ↔ vertical re-render | ✅ |
| Cancelled run | ✅ — it consumed an attempt |
| Orientation switch served from cache | ❌ no loader, no provider call |

The signal breakdown distinguishes **measured clean** from **never measured**, and
reports model coverage plus which side enforced the decision.

---

## Testing

```bash
npm test
```

47 tests, no dependencies beyond `node:test`.

| File | Covers |
|---|---|
| `shared/guardrails/guardrails.test.mjs` | Name validation, blocklist bypasses, redaction, decision reachability |
| `shared/guardrails/modelPolicy.test.mjs` | Category thresholds, verdict merging, fail-closed behaviour |
| `api/generate.test.mjs` | Server refusals, prompt injection, payload limits, rate limiting |

Notable assertions: the full decision range is reachable; ordinary words
(`"a classy minimal design"`, `"brass bass guitar"`, `"begun at sunrise"`) are not
false positives; real names colliding with public figures (`JESUS CRUZ`) route to
review rather than rejection.

---

## Deployment

Vercel, `framework: vite`. `vercel.json` excludes `/api/*` from the SPA rewrite — a
catch-all `/(.*)` swallows the serverless routes.

1. Set `GEMINI_API_KEY` in the Vercel project (not `VITE_`-prefixed)
2. Push — Vercel builds `dist/` and deploys `api/` as functions
3. Verify with **Test Connection** in the Ops Dashboard

Live: https://card-image-nishant-dash.vercel.app/

---

## Known limitations

Documented rather than hidden:

- **No authentication anywhere.** The Ops Dashboard is a tab toggle in the same
  public SPA. Anyone with the URL can open it and approve/reject submissions. This
  is the largest outstanding gap.
- **The ops queue has no per-reviewer attribution.** Decisions are recorded but
  not attributed to a user, because there is no authentication.
- **Rate limiting is per-instance.** Both endpoints use an in-memory map;
  serverless instances are per-region and recycled. A real quota should move to
  the KV store the queue already uses.
- **Moderation cache is per-instance** for the same reason.
- **L6 / L7 are not implemented** and report as unevaluated.
- **Blocklists live in a source file.** They are locale-specific, go stale, and
  shipping them in the client bundle tells an attacker what to avoid. Production
  should move them to a maintained data source — which is why the authoritative
  evaluation runs server-side.
- **Provider keys are not rotatable from the UI.** By design; see the changelog.
- **`change_tracker.csv` and `postman/`** are historical artifacts, not wired into
  the app.

---

## Changelog

### 2026-07-26 — Guardrail hardening

A review of the moderation guardrails found eight defects. All are fixed, plus
model-based moderation, an ops iteration counter, and customer-flow navigation.

**The trigger:** `Motherfucker` passed every guardrail as a cardholder name.

#### Guardrail fixes

1. **Cardholder name had no validation at all.** No code path checked it —
   `maxLength={22}` and `.trim().toUpperCase()` were the entire pipeline, and the
   blocklists had no profanity category. Added `shared/guardrails/name.js`.

2. **`REJECTED` and `MANUAL_REVIEW` were mathematically unreachable.** Three of six
   weighted inputs were hardcoded to zero, `nsfw` was generated on a 0–4 scale but
   weighted as 0–100, and `celebrity` peaked at 0.78 — an arithmetic ceiling of
   **32** against a rejection floor of **70**. The hard-block UI was dead code. A
   prompt hitting every blocklist category scored 31 and rendered as *"will
   auto-approve in 2 mins"*. Weights now renormalize over available signals and
   hard blocks bypass the average.

3. **Blocklist bypassed by trivial variants.** `\bterm\b` against raw input meant
   `guns`, `knives`, `nudes`, `ironman`, `g u n` and `n-u-d-e` all scored 0.
   Replaced with two matchers — loose (preserves offsets, for redaction) and folded
   (catches spaced letters).

4. **Guardrails did not gate generation.** `generate()` ran *concurrently* with the
   pipeline and the journey advanced unconditionally, so artwork was produced and
   displayed regardless of the verdict. Moderation now runs first; a block produces
   zero artwork.

5. **Unsafe terms reached the provider verbatim.** The rewrite map covered 6 of ~50
   terms; `nude`, `gore`, `gun`, `bomb`, `cocaine` were forwarded to Gemini after
   scoring 100/100. Every matched term is now redacted.

6. **L1/L2 signals were fabricated.** `resolution: '2048×1290'` and `dpi: 600` were
   string literals regardless of the file; `nsfw` was `Math.random() * 4`, which
   always landed under every threshold. Now real measurements, and honest
   "Not evaluated" where no detector exists.

7. **Everything was client-side.** Added `api/generate.js` as the only path to a
   provider. It recomputes the verdict from raw inputs, holds the key server-side,
   and validates style selections against a closed vocabulary.

8. **Unescaped filename XSS.** `StepSource.jsx` interpolated `file.name` into
   `dangerouslySetInnerHTML`; a file named `<img src=x onerror=...>.png` executed.

Also fixed: `vercel.json`'s catch-all rewrite swallowed `/api/*`.

#### Model-based moderation

Replaced sole reliance on keyword lists with a classifier over 16 harm categories,
applied to the prompt, the uploaded photo, and **every generated image** — a clean
prompt can still produce unsafe output, and previously nothing inspected what the
provider returned. The blocklist is retained as a deterministic floor.

#### Ops iteration counter

The previous `regenCount` only incremented when a generation had *already*
happened, so the first run counted as 0, and `ensureOrientation` never touched it —
orientation re-renders were invisible despite each being a real provider call. A
customer who generated once and flipped orientation twice showed **0**. Replaced
with `iterations: { total, horizontal, vertical }`.

#### Customer flow navigation

Back on every page (step 3 previously hid all controls), true run cancellation via
`AbortController`, full state preservation on back-navigation, and back → edit
prompt → re-run.

#### Shared ops queue backend

The queue lived in React state: every visitor had their own copy and a reload wiped
it. Now `api/submissions.js` over a Redis hash (Upstash HTTP REST), with a
**signed-verdict trust boundary** — the browser sends presentation data but not the
verdict, so a tampered client cannot post rejected artwork as approved. Header
stats ("87% auto-approved", "4.2s latency") were hardcoded; they are computed from
real data now, or show "—".

#### Output quality & prompt fidelity

`imageSize: 2K` requests, server-side resolution measurement against the embosser
minimum, emboss-aware prompt directives, and prompt-fidelity scoring folded into
the existing vision call. See the section above.

#### Edge cases found by sweeping the live endpoints

- **Spaced-letter bypass.** `"a g u n on the card"` de-interspersed to `"agun"`,
  where `\bgun\b` cannot match, so it passed. Only affected terms under four
  characters. Both readings of a spaced run are now tested, with no new false
  positives on initials or abbreviations.
- **Malformed JSON returned 500.** On Vercel `req.body` is a lazy getter that
  throws on a bad payload; reading it escaped to the outer catch. Now a 400.

#### Breaking changes

- **`GEMINI_API_KEY` must be set server-side in Vercel.** Generation returns 503
  until it is.
- **The Ops Dashboard API-key field is removed.** It wrote to `localStorage` and the
  browser called Gemini directly; combined with the absent auth gate, anyone
  opening that tab could read or replace the key. Key management moved to Vercel
  env vars. Restore it locally with `VITE_ALLOW_DIRECT_PROVIDER=true`.
- **Nothing auto-approves when moderation is unconfigured or down** — everything
  routes to manual review.
