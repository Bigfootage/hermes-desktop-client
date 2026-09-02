# Phase D deployment

`install-vm-adapter.sh` installs the stdio adapter and a 0600 256-bit bridge secret. Copy that same hex secret into the Windows Credential Manager entry `Hermes Desktop Client/phase-d-bridge` during enrollment. Configure `HERMES_CUA_DRIVER_CMD=/opt/hermes/bin/win-cua-mcp` and restart Hermes.

The SSH enrollment account must use `restrict,port-forwarding,permitlisten="127.0.0.1:18765"`; keep `GatewayPorts no`, disable PTY/agent/X11 forwarding, and pin the VM host key in the app key directory's `phase-d/known_hosts`. The desktop adds `-R 127.0.0.1:18765:127.0.0.1:18765` only when Phase D is enabled.

The Windows app requires cua-driver 0.23.2 available as `cua-driver.exe` (or `HERMES_CUA_DRIVER_EXE`). Installer bundling is intentionally not attempted without an authoritative upstream Windows artifact URL and SHA-256 checksum; no unverified download or PowerShell fallback is provided.

Windows interactive-session E2E (UIA/capture/click, RDP disconnect, reboot persistence) must be run on a Windows Session 1+ test host and cannot be exercised by the Linux CI build.
