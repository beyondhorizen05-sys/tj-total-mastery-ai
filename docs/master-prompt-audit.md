# TJ master prompt audit

Source: `MASTER BUILD PROMPT FOR FABLE 5`, version 2.0, 2,169 lines, sections 0–92 (user attachment from 2026-10-07). This is a section-level inventory of the current repository, not a certification that the full prompt works. **Working** means there is an implemented path and local evidence; **Partial** means substantial requirements remain; **Missing** means there is no corresponding product flow; **Unverified** means code exists but the stated acceptance scenario has not run end to end.

2026-10-08 implementation pass: all previously Missing domains now have at least a bounded local product flow, but the complete prompt is still not delivered. Current section counts: **3 Working, 84 Partial, 0 Missing, 5 Unverified, 0 Blocked, 1 Unmet**. A working local slice stays **Partial** when the section promises broader integrations or acceptance. Desktop installer is deferred at the user's request.

Latest parallel acceptance pass: voice replies can begin at an earlier speech chunk and the UI reports capture/transcription state; first-run hands-free opt-out clears both saved listener settings; Google GET reads retry once on 429/5xx and stop on 401; software-goal evidence counts only a successful recognized test command, not a task title or model claim. Focused tests plus the complete API suite (144/144), API/web typechecks, lint and both builds pass. Live API and web return HTTP 200. These are bounded fixes; counts remain **3 Working, 84 Partial, 0 Missing, 5 Unverified, 0 Blocked, 1 Unmet** because live external accounts, provider-backed conversation and §84 end-to-end delivery were not verified.

## Current result

The web app and API launch locally. The browser shows live system data and real persisted Activity events. The capability registry separates available, setup-required and planned integrations. Core agent/task/workflow/model/memory/permission modules exist, and every formerly Missing section now has a bounded local flow. The full master specification is **not implemented**. In particular, the 15-step definition-of-done scenario in §84 has not passed; external accounts, provider credits, device acceptance, and broader functionality remain necessary.

During this audit, we fixed an empty-POST client bug that made buttons such as connector Test Connection return HTTP 400, corrected named-SSE Activity subscriptions, added real workflow creation/run/schedule controls, added connector configuration controls, stopped failed tools and agents from counting as successful workflow steps, enforced privacy and permission gates, corrected model and capability health claims, surfaced task/settings/provider errors, and connected the 3D town roster to persisted agents. The browser connector test now reports `Missing required fields: api_key` instead of `Bad Request`.

## Section-by-section status

| Section | Status | Evidence / remaining gap |
| --- | --- | --- |
| 0 Role | Partial | Engineering role is an instruction, not a product feature; product incomplete. |
| 1 Primary mission | Partial | Orchestration exists; full autonomous research-build-test-deliver scenario unverified. |
| 2 Absolute development rule | Partial | Status badges and error paths improved; comprehensive no-dummy proof absent. |
| 3 Product principles | Partial | Local storage and permission controls exist; usability and reliability need acceptance testing. |
| 4 Core architecture | Partial | Monorepo web/API/desktop wrapper exists; full subsystem map incomplete. |
| 5 Multi-model router | Partial | Provider registry, discovery, routing/fallback and usage exist; live provider failures need end-to-end verification. |
| 6 Cognitive engine | Partial | Intent, planning and critic code exists; complex outcome quality unverified. |
| 7 Multi-agent intelligence | Partial | Agent runtime/orchestrator exist; multi-step agent runs now include accrued current-run model cost in the budget gate. Complex team delivery remains unverified. |
| 8 Dynamic agent creation | Partial | Templates and agent creation exist; all automatic staffing cases unverified. |
| 9 Agent Town | Partial | Live 3D roster/status exists; rich navigation, meetings and behavior remain limited. |
| 10 Workflow engine | Partial | DAG, supported executors, runs, pause/resume and scheduler exist. An active step finishing after pause no longer overwrites paused status. Crash recovery pins the saved version and fails uncertain in-flight actions; advanced step kinds are rejected. |
| 11 Autonomy | Partial | Levels/policies exist; each promised level needs behavior tests. |
| 12 Memory architecture | Partial | Structured/keyword memory exists; stale async embeddings cannot overwrite edited or newly secret memories. Semantic retrieval still needs a configured embedding provider. |
| 13 Memory storage | Partial | SQLite/FTS storage exists; all retention/backup requirements unverified. |
| 14 Memory control | Partial | Search/add/delete UI exists; complete consent and scope controls remain. |
| 15 Self-learning | Partial | Feedback attaches to real runs/events and generates reviewable proposals from failures and denials. No autonomous sandbox/test/deploy/rollback pipeline. |
| 16 Voice AI | Partial | Local Windows hands-free setup can start and persist the actual listener independently of computer-control permission; first-run opt-out clears both saved listener choices. Multilingual ASR requires TJ wake-name before dispatch and supports a short follow-up window. Replies can start at an earlier speech chunk and the UI reports actual capture/transcription state. Human multilingual conversation, interruption and phone-call-style latency remain unverified. |
| 17 TJ Orb | Partial | Reactive visual embodiment exists; full state/voice motion acceptance unverified. |
| 18 Vision | Partial | Explicit image upload, model choice and privacy gate exist with mocked-provider tests. Live vision inference and camera streaming remain unverified. |
| 19 Computer use | Partial | Permission-gated Windows observe/click/type/write/key/scroll/open/screenshot tools exist. Local accessible screen text reads live without a model; verified writing pins the focused window handle and rejects pre-existing text as proof. A disposable visible Windows form passed an actual type-and-observe acceptance check. Explicit pixel vision needs a configured model and can send a screenshot; long autonomous tasks still need live acceptance. |
| 20 Windows mastery | Partial | Tauri wrapper and bounded shell tool exist; native OS feature set absent. |
| 21 File intelligence | Partial | Sandboxed read/write/list tools exist; document intelligence breadth absent. |
| 22 Browser/web engine | Partial | Fetch and keyed search connectors exist; full browser automation absent. |
| 23 Real-time information | Partial | Weather/search connectors require setup; broader feeds absent. |
| 24 Data intelligence | Partial | Local CSV upload produces validated statistics, missing-value counts, preview and charts, including explicitly quoted empty rows. Other formats and advanced analysis remain. |
| 25 Productivity suite | Partial | Google Calendar/Gmail read connectors and task-based weekday briefing path have mocked API tests; read requests retry once on 429/5xx and not on 401. The 08:00 scheduler needs the app running and stores local run history, with no push/email delivery. User OAuth credentials, consent flow and live account run remain. |
| 26 Development powers | Partial | Shell/files/agents exist; full development lifecycle unverified. |
| 27 Project builder | Partial | Project/task orchestration exists; build/deploy acceptance unverified. |
| 28 Creative studio | Partial | Local creative briefs, projects and validated media assets work. AI generation and editing workflows remain absent. |
| 29 Smart home/IoT/robotics | Partial | Home Assistant connector exists but needs user endpoint/token and testing. |
| 30 Health/wellness | Partial | Vault-encrypted manual/CSV wellness records, trends and clinician-question preparation work; malformed CSV quotes now fail atomically. Wearable integrations and medical assessment remain absent. |
| 31 Personal finance | Partial | Local transaction/budget analysis with encrypted records and bounded CSV import exists, including valid four-digit years 0000–0099. Bank integrations, subscriptions, portfolio tracking and execution remain absent. |
| 32 Trading/investing | Partial | User CSV historical paper backtests have risk limits, kill switch and audit; an opening gap now checks daily loss before any new signal. Market/broker integrations and all real-money execution paths remain absent. |
| 33 Business OS | Partial | Workspace-scoped CRM covers companies, contacts, deals and follow-ups, with linked-record relationship changes guarded. Accounting, marketing sync and payments remain. |
| 34 Research/knowledge | Partial | Research agent/search/memory exist; citation/evidence workflow unverified. |
| 35 Learning/education | Partial | User-authored study plans, lessons, progress and scored quizzes persist locally, with confirmed plan deletion. AI lessons and adaptive tutoring remain. |
| 36 Entertainment/media | Partial | Local watch/read/listen list, collections and bounded media preview work, including valid suffix/oversized-end byte ranges and 416 for unsatisfiable ranges. Streaming/recommendation integrations remain. |
| 37 Automation center | Partial | Persisted cron automation works at API/UI level; external trigger breadth absent. |
| 38 Connector marketplace | Partial | Catalog/config/test/status exists; OAuth catalog and searchable marketplace absent. |
| 39 Plugin/skill system | Partial | Local declarative text skills have validation, staged install/update, explicit review, enable/run/history/disable and UI; inherited object keys cannot masquerade as inputs or installed skills. General executable plugins remain unsupported. |
| 40 Universal API workbench | Partial | Saved public HTTPS requests, host-bound vault credentials, bounded responses, history, privacy and write-approval gates work. A request changed while awaiting approval now returns 409 instead of sending changed details. WebSocket, gRPC, SSE and schema-to-connector remain. |
| 41 Security architecture | Partial | Vault, sandbox, audit and permission checks exist; full security review absent. |
| 42 Permission engine | Partial | Policies, high-risk approval and local-only gating exist; broad coverage tests remain. |
| 43 Secrets vault | Working | Encrypted local vault is implemented; external security audit absent. |
| 44 High-stakes gate | Partial | High/critical connector and tool approval paths exist; every high-stakes domain is not implemented. |
| 45 Main UI | Partial | Core screens exist; many requested modules are absent. |
| 46 Application shell | Partial | Browser shell and desktop wrapper exist; packaging acceptance unverified. |
| 47 Top status bar | Partial | Live task/agent/model/health fields exist; several spec fields unavailable. |
| 48 Home/command center | Partial | Live command UI, orb, persona and town exist; full requested widgets absent. |
| 49 Universal command palette | Partial | Ctrl+K searchable palette opens real navigation and voice-listening actions. Skill execution and file search are absent. |
| 50 Chat experience | Partial | Persisted chat/model route exists; full multimodal chat absent. |
| 51 Activity stream | Working | Persisted history and named live SSE events render in browser. |
| 52 Knowledge graph UI | Partial | Read-only graph renders real persisted project, task, agent, memory, conversation and artifact links without duplicate saved relationships. A labeled, searchable keyboard-accessible node list opens source details and relationships; live browser selection passed. Entity ontology and inferred links remain absent. |
| 53 Capability registry | Partial | Honest registry exists for implemented core/connectors, not every spec capability. |
| 54 Health monitor | Partial | DB/model/process metrics exist; deeper service/network checks absent. |
| 55 Observability | Partial | Event/audit logs exist; complete traces/dashboard absent. |
| 56 Cost control | Partial | Usage costs recorded where prices known; budgets/unknown-cost handling incomplete. |
| 57 Performance | Partial | An isolated startup/API smoke baseline is recorded in docs/performance-smoke-2026-10-08.md. Secondary views now load on demand; the entry JS fell from 1,563.47 KB to 1,400.57 KB before compression. Voice, provider, UI and sustained-load targets remain unverified. |
| 58 Offline mode | Partial | Local-only privacy setting exists; full offline workflow unverified. |
| 59 Reliability | Partial | Retry/fallback/recovery code exists; failure scenarios need end-to-end tests. |
| 60 Core entities | Partial | Schemas and SQLite tables cover core agents/tasks/models/memory/workflows; domain entities absent. |
| 61 API architecture | Partial | Versioned Fastify REST routes exist; full API contract absent. |
| 62 Event bus | Working | Persisted event bus and SSE route exist; consumer completeness still limited. |
| 63 Extension architecture | Partial | Connector runtime SDK exists; general extension lifecycle absent. |
| 64 Accessibility | Partial | Semantic controls exist. Knowledge Graph nodes now have labeled, searchable keyboard controls verified in the live browser; a full keyboard/screen-reader audit remains. |
| 65 Globalization | Partial | Profile locale selects English, Urdu or Roman Urdu for primary navigation; model/voice instructions match the user's language. Deep screens remain mostly English. |
| 66 High-risk domains | Partial | Generic gates exist; finance/health/legal-specific workflows absent. |
| 67 Philosophy | Partial | Product intent reflected in UI; outcome criteria unmet. |
| 68 Repository structure | Partial | Monorepo exists; many proposed packages/apps absent. |
| 69 Implementation characteristics | Partial | TypeScript/Zod/tests/local runtime exist; other requirements unverified. |
| 70 Local development | Partial | pnpm dev/typecheck/test and ordered web/API build scripts exist; desktop toolchain not validated. |
| 71 First-run wizard | Partial | A fresh isolated browser run completed all fourteen stages and persisted profile/persona/Windows voice, privacy, project storage, model choice, computer control, autonomy, budgets, notifications and finish state across reload. The microphone stage now offers actual Windows listener start; that new opt-in and external provider/connector setup still need a fresh browser acceptance pass. |
| 72 Provider setup | Partial | Add/key/custom Base URL/test/discover/default controls exist; failed tests retain the saved provider ID for retry. All provider types are not live-tested. |
| 73 Connector setup | Partial | Config/test/status/privacy/scopes shown; first-run failure and Disconnect flows are exposed. Searchable catalog and complete external connection acceptance remain. |
| 74 Testing requirements | Partial | Unit/integration tests exist; comprehensive end-to-end tests absent. |
| 75 Security tests | Partial | Some permission/privacy tests exist; full matrix absent. |
| 76 UX acceptance | Partial | Fresh fourteen-stage browser path and reload passed with optional devices/providers skipped; full UX/device/provider acceptance remains. |
| 77 Build phases | Partial | Foundation and parts of advanced phases exist; later phases unfinished. |
| 78 All phases same project | Partial | One repo used, but all phases not complete. |
| 79 Execution loop | Unverified | Process instruction; no evidence of every loop/acceptance step. |
| 80 No-placeholder rule | Partial | Planned integrations are explicitly marked; missing feature modules remain. |
| 81 No-fake-AI rule | Partial | Real providers required for inference; all user-facing paths not audited. |
| 82 No-fake-success rule | Partial | Major failure paths fixed; full execution audit remains. |
| 83 Self-improvement rule | Partial | Evidence-backed proposals support explicit review. Isolated source changes, security checks, deployment and rollback remain absent. |
| 84 Definition of done | Unverified | The exact 15-stage project-management-app scenario has not passed. Its software-goal evidence gate now counts only a successful recognized test command; real artifact, sources and test execution remain required, and model claims alone leave the run partial. |
| 85 Automation acceptance | Unverified | Google Calendar/Gmail read paths and timezone-aware explicit weekday 8 AM schedule exist; live OAuth connection and scheduled delivery have not run. |
| 86 Permissions acceptance | Partial | Automated high-risk/local-only tests pass; full live agent approval scenario unverified. |
| 87 Provider-failure acceptance | Partial | Retry/fallback code exists; live failure/recovery scenario unverified. |
| 88 Packaging | Unverified | Tauri shell does not launch the API; installer would not deliver a complete working TJ system. Placeholder desktop scripts were replaced with real Cargo commands, but the Tauri CLI is not installed and no installer was built. |
| 89 TJ identity | Partial | Name, marks and visual system exist. Saved embodiment/relationship/style now guide direct chat, voice and specialist agents' user-facing replies; actual provider response and full brand acceptance remain unverified. |
| 90 Product motto | Partial | Prompt motto exists; not consistently surfaced across product. |
| 91 Ultimate design goal | Unverified | Requires UX acceptance beyond current evidence. |
| 92 Final command | Unmet | Complete master prompt delivery has not been demonstrated. |

## Highest priority remaining work

1. Complete a user-led pass through device grants and provider/connector setup. The no-credentials fourteen-stage browser path passed in an isolated fresh install.
2. Add a full browser test for the §84 research/build/test/artifact path using a configured model and search connector; report provider/tool failures clearly.
3. Connect Google Calendar/Gmail with the user's OAuth credentials and observe an actual scheduled briefing before claiming the §85 scenario.
4. Extend security tests around direct connector routes, workflow executors, sandbox paths, approval release and provider privacy; recent permission fixes need dedicated regression coverage.
5. Deepen the bounded local finance, wellness, education, media, business, skills, graph and trading flows to the prompt's wider acceptance requirements.

## Verification record

### Live desktop writing acceptance increment

- Opened a disposable, visible Windows form with an editable field. A text voice-command route sent a unique QA marker through `computer_write`; the route reported success, and a separate local observe call found that exact marker in the form's accessibility tree. The QA process was closed afterward, and voice listening remained off.
- A preceding hidden-window attempt reported that visible content could not be verified, and TJ did not claim success. The visible retry established the narrow acceptance case; it does not establish that arbitrary desktop applications expose readable text or that multi-step computer tasks complete reliably.

### Workflow, memory, agent and desktop-write increment

- Workflow pause/resume now keeps one live run object, preventing a completing active step from overwriting a persisted paused status. Regression confirms downstream work waits for resume.
- Memory async embedding checks current content and sensitivity before the provider call and conditionally updates after the response. Marking a memory secret clears its stored vector.
- Agent runtime budget checks include model cost accrued in the same multi-step run before another call.
- The Windows bridge returns a focused-window handle and rejects a write if focus changed before keystrokes. Verified write also rejects a changed post-write window or text already visible before typing; it reports uncertainty and warns against an automatic retry. The bridge status call returned a real handle, and focused nonfake-execution tests passed. Live typing into a selected app remains unverified.
- Combined verification passed 28 API test files and 140 tests, API typecheck, lint and production API build. A harmless empty-text bridge request with an intentionally wrong window handle was rejected before typing. The rebuilt live API and web app each returned HTTP 200.

### Parallel data, skills, graph and typing-privacy increment

- Data Intelligence now counts an explicitly quoted empty one-column CSV row while continuing to skip genuinely blank lines.
- Local Skills validation checks own properties, so inherited keys such as `constructor` cannot satisfy required/template/runtime inputs or identify an installed skill.
- Knowledge Graph removes duplicate edge IDs before applying the bounded edge limit, avoiding repeated relationships from saved `related_entities`.
- Computer type/write approval records now store a redacted text length and a generic target rather than the dictated text. The approved action uses the original text held in memory; editing its text inside an approval is rejected and requires a new request. A regression test confirmed the persisted approval omits the text while the approved action receives it.
- Focused suites for these changes passed. The combined API suite passed 27 files and 136 tests; API typecheck, lint and API build passed. After a restart, the live API and web app both returned HTTP 200. The live microphone remains off, and desktop writing still needs a safe live-app acceptance pass.

### Parallel domain integrity increment

- Finance corrected UTC date validation for four-digit years 0000–0099; a valid leap day and invalid non-leap day have regression coverage.
- Media previews now clamp oversized byte-range ends, support suffix ranges, and return 416 for unsatisfiable ranges.
- Education can delete a study plan with an explicit UI confirmation; its lessons, questions and attempts cascade, and a repeated delete returns 404.
- Business CRM now rejects contact/company and deal/contact changes that would contradict linked records.
- Wellness CSV import rejects malformed quote placement with 400 and saves no partial rows.
- Paper trading checks opening-gap losses before any new signal, exits the simulated position at the open and halts when the daily loss limit is reached.
- API Workbench pins the reviewed request through the approval wait; editing the saved request before approval completion returns 409 instead of sending the changed method or destination.
- Every change above passed its focused API tests. The combined API suite then passed 27 files and 132 tests; API/web typechecks, lint and production builds passed. After rebuilding and restarting the live API, GET status for system, finance, education, media, business, wellness, paper trading, workbench and voice all returned HTTP 200; the live web app also returned HTTP 200. These are bounded local behaviors; the wider sections remain Partial.

### Hands-free wake-gate increment

- Multilingual Fish/local-ASR listener now forwards speech to TJ only after a recognized TJ wake-name, with a 60-second natural follow-up window. Stopping listening resets that window. English, Roman Urdu and Urdu wake forms use the same matcher; Arabic comma after “ٹی جے” is recognized. The focused wake/intent suite passes. Live human-microphone acceptance remains outstanding; the current microphone stays off.
- After the latest API restart, `/api/v1/computer/status` reported the Windows bridge and speech recognition available, computer control enabled, and listening off. A text command “TJ read the screen” returned a successful local focused-window observation without a model call; its contents were not printed into this audit.

### Persona propagation increment

- Saved TJ embodiment, relationship style, address and tone now reach specialist-agent system prompts as user-facing presentation guidance while preserving each agent's role and tool permissions. Direct chat and voice already used the saved persona. A test confirms male/boyfriend settings and the user's chosen address appear in a specialist prompt. No live paid-provider response was generated.
- Full API suite passed: 27 files, 125 tests.

### Workspace loading and status-copy increment

- Secondary workspaces now use on-demand modules with an accessible loading state. The production entry JS shrank from 1,563.47 KB (428.75 KB gzip) to 1,400.57 KB (391.86 KB gzip); Settings loaded after selecting it in the live browser. This is a bundle-size observation, not a measured startup-latency result.
- Settings text now accurately says that Voice Control starts listening and that TJ remembers the choice. The live status currently reports listening off, so the page no longer implies the microphone is active merely because Fish Audio is configured.

### Knowledge graph accessibility increment

- The SVG stays available for visual exploration, and each persisted node now also has a labeled, searchable HTML control. Selecting a control updates the details and visible relationships. The live browser showed 55 nodes and 92 links; selecting the Critic node exposed its source, status and 24 relationships. Web typecheck passed.

### Bounded-domain and evidence-gate increment (2026-10-08)

- Added local working slices for vision upload, declarative skills, improvement proposals, graph, CSV data analysis, Google productivity configuration, API Workbench, education, business CRM, media, wellness, paper trading and encrypted finance. These slices do not imply the broader prompt sections are complete; most external integrations and live-provider acceptance remain unverified.
- The orchestrator now records bounded source/test evidence, prevents unsupported model claims from becoming success, preserves forward dependencies and marks failed/blocked tasks honestly. Exact §84 acceptance still needs a configured provider and full browser run.
- Finance stores transaction and budget contents under a Vault-protected AES-256-GCM key. Legacy plaintext migration uses secure deletion and WAL truncation; tests check that the migrated database file does not retain a plaintext sentinel. Preexisting external backups are outside that cleanup.
- Connector health tests now honor the network permission and local-only privacy mode while remaining usable at default autonomy. Direct connector actions evaluate both connector-use and manifest permissions, and workflow actions also evaluate connector-use. High-risk tools require approval even if their permission is lower risk; edited approval arguments cannot silently change the approved resource. Focused regression tests cover local-only denial, manifest policy denial, default health testing, and edited-target rejection.
- Full API suite: 27 files, 124 tests passed. API and web typechecks, lint and production builds passed. Live API returned HTTP 200 for system status, finance status/summary/transactions, paper settings and wellness entries. This is local verification, not external-service acceptance.

### Screen-reading and workflow recovery increment

- Everyday voice phrases such as “read the screen,” “what do you see,” and Roman Urdu/Urdu screen questions now call the local Windows accessibility observer directly, without requiring model credits. The reply names the focused window, includes up to 25 accessible controls/text entries, and says pixel-rendered text may be missed. `TJ read the screen` succeeded against the live API with listening off; the response contained actual focused-window data. Unit tests cover phrase selection.
- Explicit “visually read the screen” phrases use the screenshot/vision tool. This path can transmit screen pixels to a configured free vision provider and remains subject to the `screen.capture` permission/approval policy. The voice route now returns the model's description instead of only saying the tool completed. A route test with a stub vision tool passed; a live screenshot/provider call was not made in this increment.
- Workflow recovery now uses the definition version saved with the run. Interrupted tool/connector actions with uncertain outcomes fail rather than replaying and potentially duplicating side effects; downstream pending steps are skipped. Targeted recovery tests passed. A failed run still needs external inspection before any explicit new run.

### First-run, voice separation, and navigation increment

- The first-run provider step now exposes an optional custom Base URL, keeps a newly saved provider ID when its connection test fails, and avoids creating duplicates on retry. The connector step keeps failed-test details and entered draft values, and exposes an explicit Disconnect action to remove saved configuration. External services still require working credentials and service availability.
- The microphone step now offers a separate Windows hands-free opt-in. Continuing with it selected configures local multilingual ASR and calls the actual listener start endpoint; a startup failure keeps the stage open with an error. Voice conversation no longer requires Windows computer-control permission, while computer intents still do. The current live user's mic remains off; no live human-microphone pass was made for this new setup path.
- Ctrl+K opens a searchable command palette with working navigation and an explicit start-listening action. A live browser pass confirmed search, Enter navigation to Approvals, and the keyboard shortcut. The palette does not yet execute skills or search files because those feature modules are absent.
- The live first welcome screen was visually inspected at the in-app browser's tablet width. Its particle embodiment was enlarged within the existing layout so the visual reads more clearly without hiding the welcome text or primary button. This is still an original TJ treatment, not a frame-matched reproduction of the reference animation.
- Approvals now exposes risk, permission, affected resources, tools, rollback and cost before a decision, and shows decision failures. Capabilities and Connectors now show loading failures and retry controls instead of blank results.

### Isolated fourteen-stage browser pass and computer-write increment

- A fresh API and built web UI ran on port 4781 with a separate test database. The browser advanced through all fourteen stages, saving a named profile, female persona with installed Windows Zira voice, local-only privacy, a chosen project folder, no provider/default model, local computer control, autonomy level 3, three spending caps and notifications off. The finish action set `first_run_completed=true`; after reload the dashboard appeared without the wizard. API reads confirmed every saved value before finish. Browser microphone/camera/screen permission requests and external credentials were skipped; those paths are not included in this pass.
- A voice `type` command now uses a write-and-observe tool. When desktop accessibility cannot confirm the new text, the tool reports failure with an explicit warning against automatic retry. The agent runtime no longer marks a run complete when a tool action failed, even if the model's final text claims success. These paths have unit coverage; real desktop text entry still needs acceptance on a chosen app.
- Tool Activity events redact computer typing content. Raw voice transcripts and replies continue to reach live subscribers but are no longer persisted to the Activity database by default. Existing historical voice events were not removed.

### Voice conversation latency increment

- The local speech worker now defaults to the cached multilingual `tiny` model with one decoding beam; Settings offers the previous `base` model for higher accuracy. On the same synthetic English sentence, `base` took about 4.7–6.1 seconds of inference and `tiny` about 3.6–4.2 seconds. These are local CPU measurements, not a guarantee for human speech.
- The microphone capture remains open between utterances, ends a turn after about 480 ms of silence, and drops new clips while ASR is busy rather than letting them accumulate. Silero speech filtering and confidence checks reject tested synthetic background noise. The synthetic spoken English sample still transcribes correctly.
- Everyday conversation uses a short, streaming free-model route and queues speech as sentences become available. Explicit computer intents still use the permission-gated tool agent. Live text-only voice-command calls returned English and Roman Urdu replies in about 2–4 seconds on successful free-provider attempts; upstream free-provider latency remains variable, and empty streaming responses retry once without streaming.
- Voice model routing stays on free models by default. The `Use my selected default AI model for voice` setting is an explicit switch for later paid-model use; it applies to conversation and computer tasks. Explicit model failures do not fall back to another paid model.
- Fish cloned-voice playback now starts consuming the HTTP audio stream while it arrives. A live short preview completed successfully and microphone capture resumed afterward. Whether the selected cloned voice gives sufficiently natural Urdu pronunciation still needs the user's listening test.
- After the user restarted listening, the microphone recognized a live English farewell and TJ answered appropriately. A later short utterance reached ASR but the free model returned empty text; the conversation path now tries a second free model in that case. This fallback still needs a live acceptance check.
- This implementation still takes turns: the mic pauses during TJ speech to avoid speaker echo. It has not yet demonstrated phone-call-style full duplex, interruption handling, or measured end-to-end latency from a human microphone. The user paused voice listening during this work, then explicitly asked to restart it; live status returned `listening=true`, `model=tiny`, and the Realtek microphone.

### Current first-run and hands-free increment

- A fourteen-stage first-run UI now connects each stage to a local setting, real provider/connector test, or browser device permission test. Completing the last stage is the only path that marks first-run complete.
- The local Windows computer bridge reports the actual desktop size and focused window accessibility tree. Its tool set can observe, click, type, press supported keys, scroll, capture a screenshot, and open common apps. Every action is gated by the `computer_control_enabled` setting and TJ's permission/approval engine.
- Hands-free mode captures the Windows microphone through FFmpeg and transcribes with a local multilingual Whisper model (`tiny` fast default; `base` accuracy option). It starts with the API after the saved opt-in and does not require a button or wake word. The older `System.Speech` English wake-word listener remains a fallback when hands-free mode is off. Medium-risk spoken approvals require a fresh two-digit code; high-risk actions stay in the Approvals screen.
- The browser now shows a Voice Control button and real event alerts. Browser notifications still depend on separate browser permission. Device permission tests stop their media tracks immediately.
- Local multilingual listening reached `listening=true`, engine `local-whisper`, with the actual Realtek microphone and a ready worker. A synthetic spoken English WAV was transcribed exactly with detected language `en`; live human multilingual microphone speech remains to be checked by the user. A free OpenRouter model ran the computer operator, called the read-only screen tool, and correctly reported the focused ChatGPT app. A Roman Urdu task returned a Roman Urdu answer. Actual click/type execution has not been independently verified.
- The encrypted Fish Audio key loaded two user-owned cloned voices; a live TTS preview succeeded. Fish Audio ASR returned HTTP 402 on this account, so the app uses local Whisper for transcription. The current female persona uses the Tano clone. Windows fallback TTS may pronounce non-English text poorly. The UI's `computer_observe` accessibility tree can be sparse in apps that expose limited metadata; `computer_read_screen` can send a screenshot to an approved vision model when available.
- The first welcome visit now plays a short, warm greeting through a separately persisted welcome voice. The current welcome voice is the persona's selected Tano clone; a real Windows female voice is the fallback on a fresh setup. A saved version prevents repeated automatic playback; Replay remains available. English and Roman Urdu greeting text follow the saved locale. Live playback completed and hands-free listening resumed. Whether the tone and cloned voice feel right to the user still needs the user's listening judgment.
- First-run voice selection now lists Windows voices actually installed on the local host and the user's Fish clones. Preview and subsequent hands-free playback use the same backend voice path. Unsupported old browser-only voice IDs are rejected on save. The optional browser microphone/camera/screen permission checks no longer write misleading persistent `*_granted` flags; their UI reports a current-session test. Clearing the model selection in stage 6 now clears the saved default model.
- An explicit free model selection previously fell back to a paid model after a provider error. The router now keeps explicit selections on one model. The OpenRouter `:free` models are tagged with zero estimated token price at discovery. Gemma free was rate limited; Nemotron 3 Super free and Dots 3 Note free answered live tests. The computer operator is pinned to the successfully tested Nemotron free model on this machine.

- Live browser at `http://localhost:5174/`: Command Hub, Activity, Workflows, Connectors and Capabilities inspected. Connector Test Connection without a key returns `Missing required fields: api_key`.
- OpenRouter model discovery works. Historical Activity includes credit errors and an incompatible `:batch` model ID; the router excludes batch-only IDs from chat routing. A paid fallback was inadvertently triggered while testing an explicit free selection; the routing fix above prevents a repeat. The user's global default model remains unverified.
- `pnpm run typecheck`: passed.
- `pnpm run test`: 14 API test files, 62 tests passed in the latest full run, including free-model fallback, voice-intent routing, voice privacy, failed computer writes, workflow recovery and first-run settings checks. A subsequent focused smoke run passed 15/15 tests after adding the voice-only conversation check.
- `pnpm run lint`: passed with no errors or warnings.
- `pnpm run build`: ordered schemas → web → API production build passed; the API bundle copied the current web UI into `dist/public`. Vite reported a large JS chunk warning.
- Desktop package and full end-to-end acceptance have not been run.
- The isolated QA data folder `services/api/tests/tmp-wizard-live-20261007` remains untracked. Automatic approval review rejected its recursive deletion twice as “blocked by policy”; the QA API is stopped. No further deletion attempt was made.
