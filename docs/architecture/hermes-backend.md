# Hermes backend boundary

```text
Hermes Desktop Client (Tauri/React)
  HTTPS + Bearer + SSE
    -> Hermes API server on VM
       -> models, agent loop, tools, memory, sessions, jobs
```

## Phase A API contract

- `GET /health` checks reachability.
- `GET /v1/capabilities` discovers supported server features.
- `POST /v1/responses` streams ordinary stateful turns using Responses SSE and `previous_response_id`.
- `POST /v1/runs` creates long work; `GET /v1/runs/{id}` reads state; `GET /v1/runs/{id}/events` streams lifecycle events; `POST .../stop` and `POST .../steer` provide control.

The transport normalizes URLs, requires TLS for non-loopback hosts unless the user explicitly opts into insecure HTTP, supplies bearer and idempotency headers, maps structured errors, redacts the key, and parses fragmented CRLF/LF SSE frames. Unknown JSON fields and future event types are retained.

## Authority and security

All tools execute on the VM. The desktop has no local shell/filesystem bridge and changes no VM configuration. The API should remain on a private network or tunnel. Phase A stores credentials only in memory/sessionStorage. A Rust-side HTTP proxy and Windows Credential Manager are Phase B; no native credential code is included in this spike.

Canonical sessions, jobs, approvals, local browser control, and replacement of remaining compatibility UI are later phases. The existing frontend is preserved while `/hermes` provides the minimal native path.
