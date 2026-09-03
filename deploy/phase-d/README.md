# Phase D deployment

`install-vm-adapter.sh` installs the stdio adapter. Configure `HERMES_CUA_DRIVER_CMD=/opt/hermes/bin/win-cua-mcp`. The adapter uses `HERMES_API_KEY` when exported or reads `API_SERVER_KEY` from the canonical root-readable `$HERMES_HOME/config.yaml`. Both sides derive the bridge key with HMAC-SHA256 and the fixed domain `hermes-desktop/phase-d-bridge/v1`; no bridge secret is copied, stored, logged, or returned. Restart Hermes after changing its API key.

The SSH enrollment account must use `restrict,port-forwarding,permitlisten="127.0.0.1:18765"`; keep `GatewayPorts no`, disable PTY/agent/X11 forwarding, and pin the VM host key in the app key directory's `phase-d/known_hosts`. The desktop adds `-R 127.0.0.1:18765:127.0.0.1:18765` only when Phase D is enabled.

The Windows installer bundles the official Cua 0.23.2 x64 runtime from the `trycua/cua` GitHub release. CI verifies the upstream archive SHA-256 (`27a41831d5dda71082b58154ff87966a9ad8131ce66e8060da2d860558655c13`) before packaging it. `HERMES_CUA_DRIVER_EXE` remains an explicit development override.

Windows interactive-session E2E (UIA/capture/click, RDP disconnect, reboot persistence) must be run on a Windows Session 1+ test host and cannot be exercised by the Linux CI build.

The optional fixed-command API bootstrap is not enabled yet: the repository does not define an authoritative VM API-key source or a privilege boundary for `hermes-desktop-enroll`. Adding a helper that merely prints `HERMES_API_KEY` to every key-authenticated SSH session would widen credential access. Until the VM service provides a single-use, scoped enrollment token/helper, enter the API key once in the native app; it goes directly to Windows Credential Manager.
