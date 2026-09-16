# RHLF Live Intake Assistant — Proof of Concept

Live agent-assist for Richard Harris Law Firm's intake team: transcribes
RingEX calls in near-real-time (English + Spanish) and surfaces firm-approved
objection responses beside the native RingCentral Windows app.

## Architecture

```
Caller <-> RingCentral desktop app (unchanged)
              | RingCentral playback        | agent headset mic
              v                             v
        +-------------------------------------------+
        | IntakeCompanion.exe (Windows, this repo)  |
        +-------------------------------------------+
              | binary PCM frames over WSS (/audio)
              v
        +-------------------------------------------+
        | server/ (Node/TypeScript)                 |
        |  RingEX webhook -> CallTracker            |
        |  Deepgram live STT  (2 streams/call)      |
        |  ObjectionEngine  (approved playbook)     |
        +-------------------------------------------+
              | JSON over WSS (/ui)
              v
        Agent UI — embedded in companion via WebView2,
        or standalone at https://<server>/ui/?extensionId=..&token=..
```

Agents keep answering calls in the RingCentral app. The companion only
captures while the backend reports an active call for that extension — no
off-call audio is recorded.

## Components

| Path | Purpose |
|---|---|
| `server/` | Node/TS backend: webhook ingestion, call tracking, per-call STT pipelines, objection detection, UI broadcast. Currently deployed on Railway: `https://rhlf-intake-assistant-production.up.railway.app` |
| `server/ui/` | Vanilla-JS agent sidebar (served by the backend; also embedded in the companion via WebView2) |
| `server/playbook/playbook.json` | Firm-approved bilingual objection responses — seed data only, requires attorney review |
| `desktop/src/IntakeCompanion/` | C#/.NET 8 Windows tray app: process-loopback capture of RingCentral audio (Win build 20348+, endpoint-loopback fallback on Win10) + mic capture via NAudio |

## Setup

### Server

Deployed to Railway (`railway up` from `server/`). Env vars on the service:

- `DEEPGRAM_API_KEY` — required for transcription
- `AGENT_TOKEN` — shared PoC token agents enter on first run (replace with SSO/per-agent auth for production)
- `DEV_EVENTS=1` — enables `POST /dev/call-event` for testing without RingCentral; unset when real RC credentials are wired
- `PUBLIC_URL` + `RC_*` — needed for real RingEX telephony events

Local dev:

```bash
cd server
cp .env.example .env   # fill in values
npm install
npm run dev
```

Minimum for a working PoC: `AGENT_TOKEN`, `DEEPGRAM_API_KEY`. RingCentral
credentials + `PUBLIC_URL` (e.g. an HTTPS tunnel) enable real call events.

### Agent UI

Open `https://rhlf-intake-assistant-production.up.railway.app/ui/?extensionId=<ext>&token=<AGENT_TOKEN>`
(or the same URL on your local server when running `npm run dev`).

### Windows companion (build on Windows)

```powershell
cd desktop\src\IntakeCompanion
dotnet publish -c Release
.\bin\Release\net8.0-windows\win-x64\publish\IntakeCompanion.exe
```

The companion is a **WinForms tray app** that can simply be double-clicked.
On first run a setup dialog asks for extension + agent token (server defaults
to the hosted backend); settings persist to
`%APPDATA%\RHLF\IntakeCompanion\config.json`. Command-line args
(`--server/--extension/--token/--process-name/--loopback-mode`) override saved
values and are re-saved.

Closing the window hides it to the system tray (right-click menu: status,
Open assistant, Pause/Resume capture, Exit). The window embeds the backend
agent UI via WebView2 — transcript and objection suggestions appear there
during calls. If the WebView2 runtime is missing it falls back to a
status/log panel (install the Evergreen runtime for the full UI).
It reconnects automatically if the backend restarts or the network drops,
and resumes capture mid-call.

Requirements: RingCentral desktop app running. Flags:

- `--loopback-mode auto|process|endpoint` — `process` captures only
  RingCentral's audio (requires Windows build 20348+, i.e. Windows 11);
  `endpoint` captures everything on the default output device (any Win10+) —
  degraded fallback, other apps' audio is captured too. `auto` (default) picks
  process when supported.
- `--process-name <name>` — RingCentral process name (default `RingCentral`;
  verify the real name on fleet hardware, e.g. `tasklist | findstr /i ring`).
- `--diag` — show all render/capture audio endpoints in a dialog and exit.

### Windows test results (desktop box, Win10 build 19045, no RingCentral)

Verified end-to-end: companion → backend over LAN WebSocket, `callStart`/
`callEnd` control, endpoint-loopback audio frames at real-time rate, capture
stop on call end.

- Process loopback is unavailable on build 19045 → endpoint fallback engaged
  automatically. **Process-loopback isolation still unverified — needs a
  Windows 11 (build 20348+) machine.**
- Test box had no active microphone endpoint — mic path compiles and fails
  gracefully but is unverified. Needs a headset.
- Endpoint loopback emits audio only while something renders on the device —
  silence produces no frames (acceptable; STT just sees a gap).
- Fixed during testing: `BufferedWaveProvider.ReadFully` must be `false` or the
  resampler stream never ends and the app emits silence at CPU speed (~MB/s
  instead of ~32KB/s).

### Without a real RingCentral account

Inject a synthetic call event to exercise the pipeline:

```bash
curl -X POST http://localhost:8080/dev/call-event -H 'content-type: application/json' -d '{
  "body": {
    "telephonySessionId": "s-test-1",
    "parties": [
      {"id": "p-1", "direction": "Inbound", "status": {"code": "Answered"},
       "owner": {"extensionId": "101"}, "from": {"phoneNumber": "+17025550000"}},
      {"id": "p-2", "direction": "Inbound", "status": {"code": "Answered"},
       "to": {"phoneNumber": "+17025550101"}}
    ]
  }
}'
```

(End it by posting the same event with `"code": "Disconnected"` on party p-1.)

## PoC validation checklist (Phase 1 gates)

- [ ] Process loopback isolates RingCentral audio on real fleet hardware
      (Windows build >= 20348 confirmed on every agent PC)
- [ ] Mic channel = the headset the agent actually uses (default comms device)
- [ ] `callStart` timing: does the pipeline capture the first words of the call?
- [ ] Assistant pause/mute semantics: RC app mute does NOT stop mic capture —
      companion `p` key / UI button is the pause control; firm must approve
- [ ] Hold, blind/attended transfer, call flip, supervisor listen/whisper/barge
      (playback channel may contain supervisor speech — suggestions suppressed
      when caller audio is ambiguous)
- [ ] Headset unplug, device switch, app restart, sleep/wake recovery
- [ ] Audio never assigned to the wrong call or captured off-call
- [ ] Companion failure never affects the live call

## Known PoC limitations

- Webhook delivery requires a public HTTPS endpoint; WebSocket transport or
  RingCentral subscription management can replace it later.
- Shared `AGENT_TOKEN` is PoC-only; replace with SSO + per-agent auth.
- No transcript/audio is persisted — by design for now; retention policy TBD.
- Objection detection is keyword matching; swap in an LLM/classifier after
  transcript quality is validated.
- `Gone` party status (transfers/monitoring joins) currently ends assistance;
  refine if mid-call transfers must keep assisting.
- RingCentral mute is client-side: verify on real hardware whether assistant
  must mirror it and how to detect it.
