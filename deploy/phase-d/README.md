# Phase D deployment

`install-vm-adapter.sh` installs the stdio adapter. Configure `HERMES_CUA_DRIVER_CMD=/opt/hermes/bin/win-cua-mcp` and ensure the adapter inherits the same root-readable `HERMES_API_KEY` as the Hermes API service. Both sides derive the bridge key with HMAC-SHA256 and the fixed domain `hermes-desktop/phase-d-bridge/v1`; no bridge secret is copied, stored, logged, or returned. Restart Hermes after changing its API key.

The SSH enrollment account must use `restrict,port-forwarding,permitlisten="127.0.0.1:18765"`; keep `GatewayPorts no`, disable PTY/agent/X11 forwarding, and pin the VM host key in the app key directory's `phase-d/known_hosts`. The desktop adds `-R 127.0.0.1:18765:127.0.0.1:18765` only when Phase D is enabled.

The Windows app requires cua-driver 0.23.2 available as `cua-driver.exe` (or `HERMES_CUA_DRIVER_EXE`). Installer bundling is intentionally not attempted without an authoritative upstream Windows artifact URL and SHA-256 checksum; no unverified download or PowerShell fallback is provided.

Windows interactive-session E2E (UIA/capture/click, RDP disconnect, reboot persistence) must be run on a Windows Session 1+ test host and cannot be exercised by the Linux CI build.

The optional fixed-command API bootstrap is not enabled yet: the repository does not define an authoritative VM API-key source or a privilege boundary for `hermes-desktop-enroll`. Adding a helper that merely prints `HERMES_API_KEY` to every key-authenticated SSH session would widen credential access. Until the VM service provides a single-use, scoped enrollment token/helper, enter the API key once in the native app; it goes directly to Windows Credential Manager.
