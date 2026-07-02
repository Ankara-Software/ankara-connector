; Ankara Yazılım Connector — Windows installer (Add/Remove Programs + startup tray)
; Save this file as UTF-8 with BOM. Build with: makensis /INPUTCHARSET UTF8

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define APP_VERSION "1.1.5"
!define APP_EXE "AnkaraYazilimConnector.exe"
!define CORE_EXE "ankara-connector-core.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnkaraYazilimConnector"
!define INSTALL_DIR "$PROGRAMFILES64\Ankara Yazilim\Connector"

OutFile "..\..\dist\AnkaraConnector-Setup-${APP_VERSION}.exe"
InstallDir "${INSTALL_DIR}"
RequestExecutionLevel admin
Unicode true

!define MUI_ICON "..\assets\ankara-yazilim.ico"
!define MUI_UNICON "..\assets\ankara-yazilim.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEFINISHPAGE_BITMAP "..\assets\installer-sidebar.bmp"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"

LangString STR_APP_NAME ${LANG_TURKISH} "Ankara Yazılım Connector"
LangString STR_PUBLISHER ${LANG_TURKISH} "Ankara Yazılım"
LangString STR_STARTMENU ${LANG_TURKISH} "Ankara Yazılım"
LangString STR_UNINSTALL ${LANG_TURKISH} "Connector Kaldır"
LangString STR_SECTION_CORE ${LANG_TURKISH} "Ana bileşenler"

Name "$(STR_APP_NAME)"

Section "$(STR_SECTION_CORE)" SecCore
  SetOutPath "$INSTDIR"
  File "..\..\dist\${APP_EXE}"
  File "..\..\dist\${CORE_EXE}"
  File "..\..\dist\ankara-yazilim.ico"
  File "..\..\dist\AnkaraYazilimConnector.ps1"

  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "$(STR_APP_NAME)"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "$(STR_PUBLISHER)"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "EstimatedSize" 98000

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\$(STR_STARTMENU)"
  CreateShortcut "$SMPROGRAMS\$(STR_STARTMENU)\$(STR_APP_NAME).lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortcut "$SMPROGRAMS\$(STR_STARTMENU)\$(STR_UNINSTALL).lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMSTARTUP\$(STR_APP_NAME).lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  Exec "$INSTDIR\${APP_EXE}"
SectionEnd

Section "Uninstall"
  Delete "$SMSTARTUP\$(STR_APP_NAME).lnk"
  Delete "$SMPROGRAMS\$(STR_STARTMENU)\$(STR_APP_NAME).lnk"
  Delete "$SMPROGRAMS\$(STR_STARTMENU)\$(STR_UNINSTALL).lnk"
  RMDir "$SMPROGRAMS\$(STR_STARTMENU)"

  ExecWait 'taskkill /F /IM ${APP_EXE} /T'
  ExecWait 'taskkill /F /IM ${CORE_EXE} /T'

  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\${CORE_EXE}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  RMDir "$PROGRAMFILES64\Ankara Yazilim"

  DeleteRegKey HKLM "${UNINSTALL_KEY}"
SectionEnd
