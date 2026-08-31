# Hermes Desktop Client (Phase A)

Independent Windows desktop client derived from the OpenJarvis frontend at upstream commit `72033b8`. It is not an official OpenJarvis product.

## Product boundary

Hermes on the remote VM is the sole agent runtime. This client does not package or launch OpenJarvis Python/Rust agents, `jarvis serve`, Ollama, models, tools, memory, or automation. Existing OpenJarvis UI remains temporarily available during the spike; the Hermes-native route is `/hermes`.

## Run

```bash
cd frontend
npm ci
npm run dev
# open http://localhost:5173/hermes
```

Enter the Hermes API base URL and API key. Setup validates `/health` and authenticated `/v1/capabilities`, then enables stateful Responses API chat. Remote HTTP requires explicit opt-in; HTTPS is the default.

## Security

Phase A keeps the key in JavaScript memory and `sessionStorage`, never `localStorage`. Closing the browser session removes it. A Rust proxy backed by Windows Credential Manager is intentionally deferred to Phase B. Prefer a private network or tunnel and do not expose Hermes publicly.

## Verification

Run `npm test` and `npm run build` in `frontend/`. Windows is the only supported packaging target (NSIS/MSI).
