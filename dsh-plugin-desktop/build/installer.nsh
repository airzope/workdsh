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

; Set _RESULT to 1 when the 64-bit VC++ runtime used by the Office engine is
; present, and in the offline installer at least the bundled version.
; Uses $R1 and $R2.
!macro WORKDSH_FIND_VCRUNTIME _RESULT
  StrCpy ${_RESULT} 0
  ${DisableX64FSRedirection}
  ClearErrors
  GetDLLVersion "$WINDIR\System32\msvcp140_2.dll" $R1 $R2
  ${EnableX64FSRedirection}
  ${ifNot} ${Errors}
    StrCpy ${_RESULT} 1
    !ifdef WORKDSH_BUNDLED_VCREDIST_MS
      ${if} $R1 U< ${WORKDSH_BUNDLED_VCREDIST_MS}
        StrCpy ${_RESULT} 0
      ${elseIf} $R1 = ${WORKDSH_BUNDLED_VCREDIST_MS}
      ${andIf} $R2 U< ${WORKDSH_BUNDLED_VCREDIST_LS}
        StrCpy ${_RESULT} 0
      ${endIf}
    !endif
  ${endIf}
!macroend

; Warn about Windows 7 prerequisites that setup does not install. VxKex
; NEXT's own check is skipped in silent mode. Uses $R0-$R3.
!macro WORKDSH_WARN_WINDOWS7_PREREQUISITES
  StrCpy $R0 ""
  ${ifNot} ${AtLeastServicePack} 1
    StrCpy $R0 "$R0$\r$\n  - Windows 7 Service Pack 1"
  ${endIf}
  System::Call 'kernel32::GetModuleHandle(t "kernel32.dll") p .R1'
  System::Call 'kernel32::GetProcAddress(p R1, m "AddDllDirectory") p .R1'
  ${if} $R1 == 0
    StrCpy $R0 "$R0$\r$\n  - KB2533623 (DllDirectories)"
  ${endIf}
  ; KB2670838 (Platform Update) raises dxgi.dll from 6.1 to 6.2.
  ${DisableX64FSRedirection}
  ClearErrors
  GetDLLVersion "$WINDIR\System32\dxgi.dll" $R1 $R2
  ${EnableX64FSRedirection}
  ${if} ${Errors}
  ${orIf} $R1 U< 0x00060002
    StrCpy $R0 "$R0$\r$\n  - KB2670838 (Platform Update)"
  ${endIf}
  ; DSH's command tool needs Windows PowerShell 5.1; Windows 7 ships 2.0.
  ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\PowerShell\3\PowerShellEngine" "PowerShellVersion"
  StrCpy $R1 $R1 2
  ${if} $R1 != "5."
    StrCpy $R0 "$R0$\r$\n  - Windows Management Framework 5.1 (KB3191566)"
  ${endIf}
  !insertmacro WORKDSH_FIND_VCRUNTIME $R3
  ${if} $R3 != 1
    StrCpy $R0 "$R0$\r$\n  - Microsoft Visual C++ 2015-2022 x64 runtime"
  ${endIf}
  ${if} $R0 != ""
    DetailPrint "Missing Windows 7 prerequisites:$R0"
    MessageBox MB_OK|MB_ICONEXCLAMATION "WorkDSH 已安装，但这台 Windows 7 还缺少以下组件；请从 Microsoft 获取并安装，否则部分功能（命令执行、Office 渲染与 PDF 转换、界面显示）可能无法工作：$R0$\r$\n$\r$\nWorkDSH is installed, but this Windows 7 computer is missing the components below. Install them from Microsoft, or some features (command execution, Office rendering and PDF conversion, display) may not work." /SD IDOK
  ${endIf}
!macroend

!macro customInit
  ; The offline installer carries VxKex NEXT and installs it in customInstall.
  !ifndef WORKDSH_BUNDLED_VXKEX
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
  !endif
!macroend

!ifdef WORKDSH_BUNDLED_VXKEX
; Install or upgrade the bundled VxKex NEXT when it is missing or older.
; KexSetup needs administrator rights, so it runs through the UAC "runas"
; verb; its result is read back from the registry rather than an exit code.
; Uses $R0 and $R1.
!macro WORKDSH_INSTALL_BUNDLED_VXKEX
  !insertmacro WORKDSH_FIND_KEXCFG $R0
  ReadRegDWORD $R1 HKLM "Software\VXsoft\VxKex" "InstalledVersion"
  ${if} $R0 == ""
  ${orIf} $R1 U< ${WORKDSH_BUNDLED_VXKEX_VERSION}
    DetailPrint "Installing VxKex NEXT ${WORKDSH_BUNDLED_VXKEX_LABEL}"
    InitPluginsDir
    File "/oname=$PLUGINSDIR\VxKexNextSetup.exe" "${WORKDSH_BUNDLED_VXKEX}"
    ExecShellWait "runas" "$PLUGINSDIR\VxKexNextSetup.exe" "/SILENTUNATTEND"
    Delete "$PLUGINSDIR\VxKexNextSetup.exe"
    ReadRegDWORD $R1 HKLM "Software\VXsoft\VxKex" "InstalledVersion"
    DetailPrint "VxKex NEXT InstalledVersion: $R1"
  ${endIf}
!macroend

; Install the bundled Microsoft VC++ runtime when it is missing or older; the
; Office engine imports it and Windows 7 does not ship it. Uses $R0-$R2.
!macro WORKDSH_INSTALL_BUNDLED_VCREDIST
  !insertmacro WORKDSH_FIND_VCRUNTIME $R0
  ${if} $R0 != 1
    DetailPrint "Installing Microsoft Visual C++ runtime ${WORKDSH_BUNDLED_VCREDIST_LABEL}"
    InitPluginsDir
    File "/oname=$PLUGINSDIR\vc_redist.x64.exe" "${WORKDSH_BUNDLED_VCREDIST}"
    ExecShellWait "runas" "$PLUGINSDIR\vc_redist.x64.exe" "/install /quiet /norestart"
    Delete "$PLUGINSDIR\vc_redist.x64.exe"
  ${endIf}
!macroend
!endif

!macro customInstall
  ${if} ${IsWin7}
  ${orIf} ${IsWin2008R2}
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    !ifdef WORKDSH_BUNDLED_VXKEX
      !insertmacro WORKDSH_INSTALL_BUNDLED_VCREDIST
      !insertmacro WORKDSH_INSTALL_BUNDLED_VXKEX
    !endif
    !insertmacro WORKDSH_FIND_KEXCFG $R0
    ${if} $R0 == ""
      MessageBox MB_OK|MB_ICONSTOP "未检测到 VxKex NEXT，WorkDSH 无法在 Windows 7 上启动。请安装 VxKex NEXT（出现管理员授权提示时请允许），然后重新运行本安装程序。$\r$\n$\r$\nVxKex NEXT was not found, so WorkDSH cannot start on Windows 7. Install VxKex NEXT (approve the administrator prompt if one appears), then run this installer again." /SD IDOK
    ${else}
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
    !insertmacro WORKDSH_WARN_WINDOWS7_PREREQUISITES
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
