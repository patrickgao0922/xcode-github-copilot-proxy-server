# xcode-github-copilot-proxy-server

A local HTTP proxy that connects **Xcode Intelligence** (Xcode 16+, Xcode 26) to **GitHub Copilot Enterprise**, translating between Xcode's OpenAI-compatible API and the GitHub Copilot backend.

## Features

- **Xcode 16** — chat completions (`/v1/chat/completions`) and FIM code completions (`/v1/completions`)
- **Xcode 26 agentic mode** — Anthropic-format messages (`/v1/messages`) and OpenAI Responses API (`/v1/responses`)
- **Automatic Copilot token management** — fetches and refreshes the short-lived Copilot bearer token (~30 min TTL, auto-renewed 5 min before expiry)
- **Traffic logging** — independently log all four traffic directions (Xcode requests, Xcode responses, Copilot requests, Copilot responses) with full headers to a local JSONL file
- **macOS launchd service** — run as a background service that starts at login
- Binds to `127.0.0.1` only — no external exposure

## Prerequisites

- Node.js 22+
- GitHub account with a **Copilot Enterprise** licence on github.com

## Setup

```bash
git clone <repo> && cd xcode-github-copilot-proxy-server
npm install
cp config.example.json config.json

# Authenticate via GitHub OAuth device flow
npm run auth
```

`npm run auth` opens GitHub's device flow in your browser. Sign in with your enterprise GitHub account — SSO is handled automatically. The resulting OAuth token is written to `config.json` automatically.

## Configuration (`config.json`)

```json
{
  "githubToken": "ghu_...",     // set automatically by `npm run auth`
  "port": 23800,                // default: 23800
  "logLevel": "info",           // trace | debug | info | warn | error | silent
  "copilot": {
    "editorVersion": "vscode/1.96.0",
    "pluginVersion": "copilot-chat/0.24.0",
    "tokenRefreshBufferSecs": 300
  },
  "traffic": {
    "logFile": "logs/traffic.log",  // relative to project root
    "logXcodeRequest": false,        // log requests from Xcode (headers + body)
    "logXcodeResponse": false,       // log responses to Xcode (headers + SSE chunks)
    "logCopilotRequest": false,      // log requests to GitHub Copilot (headers + body)
    "logCopilotResponse": false      // log responses from GitHub Copilot (headers + SSE chunks)
  }
}
```

> **Security**: `config.json` and `logs/` are gitignored. Never commit them.

### Traffic Log Format

Each line in `logs/traffic.log` is a JSON object:

```json
{
  "timestamp": "2026-03-08T10:00:00.000Z",
  "requestId": "abc-123",
  "direction": "xcode-request",
  "method": "POST",
  "url": "/v1/chat/completions",
  "headers": { "content-type": "application/json", "..." : "..." },
  "body": "{\"model\":\"gpt-4o\",...}"
}
```

For streaming traffic, each chunk is a separate entry with `chunk`, `chunkIndex`, and `streamDone` fields. All entries for a single round-trip share the same `requestId`.

## Auth

Authentication uses the **GitHub OAuth device flow** — the same method used by VS Code's Copilot extension. It works with Copilot Individual, Business, and Enterprise accounts, and handles enterprise SSO automatically.

```bash
npm run auth
```

You will see output like:
```
──────────────────────────────────────────────────
  Open:  https://github.com/login/device
  Enter: ABCD-1234
──────────────────────────────────────────────────
```

Open the URL, enter the code, and authorize. The OAuth token (`ghu_...`) is saved to `config.json`. Re-run `npm run auth` whenever the token is revoked or expires.

> **Note**: The token is stored in `config.json`, which is gitignored. Never commit it.

## Running

```bash
# Development (auto-reload on file changes)
npm run dev

# Production
npm run build
npm start
```

### Console output

The proxy logs every request/response to stdout regardless of traffic config:

```
→ POST /v1/chat/completions [model: gpt-4o]
← POST /v1/chat/completions 200 [in: 1234 tokens | out: 56 tokens | total: 1290 tokens]

→ POST /v1/messages [model: claude-opus-4-5]
← POST /v1/messages 200

[tokenManager] Copilot token acquired, expires at 2026-03-08T10:30:00.000Z, api=https://api.business.githubcopilot.com
```

## Configuring Xcode

**Xcode 16:**
Settings → Intelligence → Model Provider → Custom → URL: `http://127.0.0.1:23800`

**Xcode 26:**
Same as above. In Agentic Mode:
- *Claude Agent* automatically uses `/v1/messages` (Anthropic API)
- *Codex Agent* automatically uses `/v1/responses` (OpenAI Responses API)

## Verification

```bash
# 1. Verify GitHub OAuth token can fetch a Copilot token
curl -s -H "Authorization: Bearer $(jq -r .githubToken config.json)" \
  https://api.github.com/copilot_internal/v2/token | jq '{token_prefix: .token[:20], expires_at}'

# 2. List available models
curl -s http://127.0.0.1:23800/v1/models | jq '.data[].id'

# 3. Chat completions (streaming)
curl -s http://127.0.0.1:23800/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Say hello in one word"}],"stream":true}'

# 4. FIM completions
curl -s http://127.0.0.1:23800/v1/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","prompt":"func add(a: Int, b: Int)","suffix":" -> Int { }","max_tokens":20}'

# 5. Anthropic messages (Xcode 26 agentic)
curl -s http://127.0.0.1:23800/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","max_tokens":50,"messages":[{"role":"user","content":"Hello"}],"stream":true}'
```

## macOS Background Service (launchd)

1. Build the project: `npm run build`
2. Edit `com.github.copilot.proxy.plist` — replace `YOUR_USER` with your macOS username and update the `node` path (`which node`)
3. Install and start:

```bash
cp com.github.copilot.proxy.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.github.copilot.proxy.plist
launchctl start com.github.copilot.proxy
```

Logs: `/tmp/copilot-proxy.log` (stdout) and `/tmp/copilot-proxy-error.log` (stderr)

To stop:
```bash
launchctl stop com.github.copilot.proxy
launchctl unload ~/Library/LaunchAgents/com.github.copilot.proxy.plist
```

## Project Structure

```
scripts/
└── auth.ts                   GitHub OAuth device flow — writes token to config.json
src/
├── index.ts                  Entry point
├── server.ts                 Fastify app factory
├── config.ts                 JSON config loader (Zod-validated)
├── auth/
│   ├── githubClient.ts       GitHub OAuth token → Copilot token exchange
│   └── tokenManager.ts       Token cache + auto-refresh
├── proxy/
│   ├── copilotClient.ts      undici wrappers for Copilot API
│   ├── streamPassthrough.ts  SSE pipe helper
│   └── headers.ts            Copilot upstream headers builder
├── logging/
│   └── trafficLogger.ts      JSONL traffic log file writer
├── routes/
│   ├── models.ts             GET  /v1/models
│   ├── chatCompletions.ts    POST /v1/chat/completions
│   ├── completions.ts        POST /v1/completions
│   ├── messages.ts           POST /v1/messages (Anthropic)
│   ├── messagesCountTokens.ts POST /v1/messages/count_tokens
│   └── responses.ts          POST /v1/responses (Codex Agent)
└── translate/
    ├── anthropicToOpenai.ts  Anthropic req → OpenAI req
    ├── openaiToAnthropic.ts  OpenAI resp → Anthropic resp
    └── sseTranslate.ts       OpenAI SSE → Anthropic/Responses SSE
```
