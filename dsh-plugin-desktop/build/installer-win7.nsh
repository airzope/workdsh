; Windows 7 x64 offline installer: the standard installer plus the pinned
; VxKex NEXT setup and the Microsoft VC++ runtime. Both are installed only when
; missing or older. scripts/package-win7.ts stages and verifies them first and
; generates their definitions.
!include "${BUILD_RESOURCES_DIR}\.win7\offline-payload.nsh"
!include "installer.nsh"
