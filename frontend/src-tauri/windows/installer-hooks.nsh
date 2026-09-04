!macro NSIS_HOOK_PREINSTALL
  ; Stop the existing app and Phase D daemon before files are replaced.
  ; Without this, cua-driver.exe remains locked and NSIS asks the user to
  ; Abort/Retry/Ignore on every upgrade.
  nsExec::ExecToLog 'taskkill /F /IM openjarvis-desktop.exe'
  nsExec::ExecToLog 'taskkill /F /IM cua-driver.exe'
  Sleep 750
!macroend