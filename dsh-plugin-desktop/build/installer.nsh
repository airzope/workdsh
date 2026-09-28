; Check the exact app process before launching the quit handoff. This preserves
; the #469 fix: unrelated helpers under $INSTDIR must never block an upgrade.
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 != 0
    Goto dsh_installer_app_stopped
  ${endIf}

  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 dsh_installer_scoped_fallback
    ; Newer versions receive this through Electron's single-instance channel.
    ; 2.0.2 ignores it, so the scoped builder fallback remains necessary for
    ; the first upgrade to a version that supports orderly shutdown.
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --dsh-installer-quit'
    StrCpy $R1 0

  dsh_installer_wait_for_exit:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 != 0
      Goto dsh_installer_app_stopped
    ${endIf}
    IntOp $R1 $R1 + 1
    ; Slow disks, antivirus hooks, and a large physical runtime can keep the
    ; process alive after Cordis disposal begins. Give the orderly handoff a
    ; full 30 seconds before escalating to the scoped forced-close path.
    ${if} $R1 < 60
      Sleep 500
      Goto dsh_installer_wait_for_exit
    ${endIf}

  dsh_installer_scoped_fallback:
    ; The patched builder macros match WorkDSH.exe, not every executable
    ; below $INSTDIR. They handle pre-handoff releases and stubborn processes.
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK dsh_installer_stop_app
    Quit

  dsh_installer_stop_app:
    DetailPrint "$(appClosing)"
    ; KILL_PROCESS's tasklist fallback excludes $pid. The installer never has
    ; the application executable name, so zero is a safe sentinel here.
    StrCpy $pid 0
    !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 0
    Sleep 500
    StrCpy $R1 0

  dsh_installer_wait_for_fallback:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 != 0
      Goto dsh_installer_app_stopped
    ${endIf}
    IntOp $R1 $R1 + 1
    ${if} $R1 > 1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY dsh_installer_wait_for_fallback
      Quit
    ${endIf}
    Sleep 1000
    !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1
    Sleep 500
    Goto dsh_installer_wait_for_fallback

  dsh_installer_app_stopped:
!macroend

; Windows 7 x64 runs WorkDSH through VxKex NEXT, which supplies the newer
; Windows APIs imported by Electron and the bundled Node.js and Python.
; KexCfg.exe is VxKex's supported configuration interface. It writes the Image
; File Execution Options filter key for this exact executable, directly when
; elevated or through VxKex's SYSTEM elevation task otherwise. Renderers and
; runtime children inherit VxKex through its propagation, which must stay on.
!define WORKDSH_VXKEX_DOWNLOAD "https://github.com/YuZhouRen86/VxKex-NEXT/releases"

; Set _RESULT to the VxKex directory holding KexCfg.exe, or "" when absent.
!macro WORKDSH_FIND_KEXCFG _RESULT
  SetRegView 64
  ReadRegStr ${_RESULT} HKLM "Software\VXsoft\VxKex" "KexDir"
  ${ifNot} ${FileExists} "${_RESULT}\KexCfg.exe"
    StrCpy ${_RESULT} ""
  ${endIf}
!macroend

; Set _RESULT to 1 when VxKex is enabled for this installed executable.
; Uses $R2-$R4 as scratch registers.
!macro WORKDSH_FIND_VXKEX_REGISTRATION _RESULT
  StrCpy ${_RESULT} 0
  StrCpy $R2 0
  ${do}
    EnumRegKey $R3 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\${APP_EXECUTABLE_FILENAME}" $R2
    ${if} $R3 == ""
      ${exitDo}
    ${endIf}
    ReadRegStr $R4 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\${APP_EXECUTABLE_FILENAME}\$R3" "FilterFullPath"
    ${if} $R4 == "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ; KexCfg sets FLG_APPLICATION_VERIFIER only while KexDll is enabled.
      ReadRegDWORD $R4 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\${APP_EXECUTABLE_FILENAME}\$R3" "GlobalFlag"
      IntOp $R4 $R4 & 0x100
      ${if} $R4 != 0
        StrCpy ${_RESULT} 1
      ${endIf}
      ${exitDo}
    ${endIf}
    IntOp $R2 $R2 + 1
  ${loop}
!macroend

!macro customInit
  ${if} ${IsWin7}
  ${orIf} ${IsWin2008R2}
    Push $R0
    !insertmacro WORKDSH_FIND_KEXCFG $R0
    ${if} $R0 == ""
      ${if} ${Cmd} `MessageBox MB_YESNO|MB_ICONSTOP "WorkDSH 在 Windows 7 上需要 VxKex NEXT，但未检测到它。请先安装最新版 VxKex NEXT，然后重新运行本安装程序。$\r$\n$\r$\nWorkDSH requires VxKex NEXT on Windows 7, but it was not found. Install the latest VxKex NEXT, then run this installer again.$\r$\n$\r$\n是否打开 VxKex NEXT 下载页？ / Open the VxKex NEXT download page?" /SD IDNO IDYES`
        ExecShell "open" "${WORKDSH_VXKEX_DOWNLOAD}"
      ${endIf}
      SetErrorLevel 2
      Quit
    ${endIf}
    Pop $R0
  ${endIf}
!macroend

!macro customInstall
  ${if} ${IsWin7}
  ${orIf} ${IsWin2008R2}
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    !insertmacro WORKDSH_FIND_KEXCFG $R0
    ${if} $R0 != ""
      DetailPrint "Enabling VxKex NEXT for $INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ; Keep the user's version-spoof choices. Propagation and the Chromium
      ; app-specific fixes are required by WorkDSH, so they are always reset.
      ExecWait '"$R0\KexCfg.exe" /EXE:"$INSTDIR\${APP_EXECUTABLE_FILENAME}" /ENABLE:1 /DISABLEFORCHILD:0 /DISABLEAPPSPECIFIC:0' $R1
      DetailPrint "KexCfg.exe exited with $R1"
      ; The elevation task applies the change asynchronously; allow it 10 seconds.
      ${for} $R1 1 20
        !insertmacro WORKDSH_FIND_VXKEX_REGISTRATION $R0
        ${if} $R0 == 1
          ${exitFor}
        ${endIf}
        Sleep 500
      ${next}
      ${if} $R0 != 1
        MessageBox MB_OK|MB_ICONEXCLAMATION "安装程序无法确认已为 WorkDSH 启用 VxKex NEXT。请右键单击 $INSTDIR\${APP_EXECUTABLE_FILENAME}，选择“属性” > “VxKex”，勾选“为此程序启用 VxKex NEXT”。$\r$\n$\r$\nSetup could not confirm that VxKex NEXT is enabled for WorkDSH. Right-click $INSTDIR\${APP_EXECUTABLE_FILENAME}, choose Properties > VxKex, and check $\"Enable VxKex NEXT for this program$\"." /SD IDOK
      ${endIf}
    ${endIf}
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  ${endIf}
!macroend

!macro customUnInstall
  ; An upgrade reinstalls into the same path; KexCfg may apply changes
  ; asynchronously, so removing the registration here could race the new one.
  ${ifNot} ${isUpdated}
    ${if} ${IsWin7}
    ${orIf} ${IsWin2008R2}
      Push $R0
      Push $R1
      Push $R2
      Push $R3
      Push $R4
      !insertmacro WORKDSH_FIND_KEXCFG $R0
      ${if} $R0 != ""
        !insertmacro WORKDSH_FIND_VXKEX_REGISTRATION $R1
        ${if} $R1 == 1
          ; An all-default configuration makes KexCfg delete the IFEO subkey.
          ExecWait '"$R0\KexCfg.exe" /EXE:"$INSTDIR\${APP_EXECUTABLE_FILENAME}" /ENABLE:0 /DISABLEFORCHILD:0 /DISABLEAPPSPECIFIC:0 /WINVERSPOOF:NONE /STRONGSPOOF:0'
        ${endIf}
      ${endIf}
      Pop $R4
      Pop $R3
      Pop $R2
      Pop $R1
      Pop $R0
    ${endIf}
  ${endIf}
!macroend
