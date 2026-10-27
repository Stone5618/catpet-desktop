Unicode true
!include "MUI2.nsh"

!define APPNAME "猫猫桌宠"
!define VERSION "1.0.0"
!define PUBLISHER "Stone5618"

Name "${APPNAME}"
OutFile "dist\CatPet-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\CatPet"
InstallDirRegKey HKCU "Software\CatPet" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "assets\cat.ico"
UninstallIcon "assets\cat.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Install"
  SetOutPath "$INSTDIR"
  File "bin\CatPet.exe"
  SetOutPath "$INSTDIR\assets"
  File /r "bin\assets\*.*"

  WriteRegStr HKCU "Software\CatPet" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\CatPet.exe"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\CatPet.exe"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CatPet" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CatPet" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CatPet" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CatPet" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CatPet" "DisplayIcon" "$INSTDIR\CatPet.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\CatPet.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\assets"
  RMDir "$INSTDIR"

  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"

  ; 自启项与用户存档一并清除，做到卸载无残留
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CatPet"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CatPet"
  DeleteRegKey HKCU "Software\CatPet"
  RMDir /r "$APPDATA\CatPet"
SectionEnd




