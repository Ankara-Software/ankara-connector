; Ankara Yazılım Connector — Windows installer (Add/Remove Programs + startup tray)

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define APP_NAME "Ankara Yazılım Connector"
!define APP_PUBLISHER "Ankara Yazılım"
!define APP_VERSION "1.1.2"
!define APP_EXE "AnkaraYazilimConnector.exe"
!define CORE_EXE "ankara-connector-core.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnkaraYazilimConnector"
!define INSTALL_DIR "$PROGRAMFILES64\Ankara Yazılım\Connector"

Name "${APP_NAME}"
OutFile "..\..\dist\AnkaraConnector-Setup-${APP_VERSION}.exe"
InstallDir "${INSTALL_DIR}"
RequestExecutionLevel admin
Unicode true

!define MUI_ICON "..\assets\ankara-yazilim.ico"
!define MUI_UNICON "..\assets\ankara-yazilim.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"

Section "Ana bileşenler" SecCore
  SetOutPath "$INSTDIR"
  File "..\..\dist\${APP_EXE}"
  File "..\..\dist\${CORE_EXE}"
  File "..\..\dist\ankara-yazilim.ico"
  File "..\..\dist\AnkaraYazilimConnector.ps1"

  ; Add/Remove Programs
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "EstimatedSize" 98000

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Start menu + run at logon (tray)
  CreateDirectory "$SMPROGRAMS\Ankara Yazılım"
  CreateShortcut "$SMPROGRAMS\Ankara Yazılım\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortcut "$SMPROGRAMS\Ankara Yazılım\Connector Kaldır.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMSTARTUP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  ; Launch after install
  Exec "$INSTDIR\${APP_EXE}"
SectionEnd

Section "Uninstall"
  Delete "$SMSTARTUP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\Ankara Yazılım\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\Ankara Yazılım\Connector Kaldır.lnk"
  RMDir "$SMPROGRAMS\Ankara Yazılım"

  ; Stop running processes
  ExecWait 'taskkill /F /IM ${APP_EXE} /T'
  ExecWait 'taskkill /F /IM ${CORE_EXE} /T'

  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\${CORE_EXE}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  RMDir "$PROGRAMFILES64\Ankara Yazılım"

  DeleteRegKey HKLM "${UNINSTALL_KEY}"
SectionEnd
