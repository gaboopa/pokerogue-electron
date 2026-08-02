!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
Var InstallerProgressBar
Var InstallerStatusLabel
Var InstallerPercentLabel
Var InstallerStepsLabel
Var InstallerProgressTimerStarted

!macro preInit
  StrCpy $InstallerProgressTimerStarted "0"
!macroend

!macro customHeader
  Function InstallerStartApp
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "PokeRogue Offline Setup"
  !define MUI_WELCOMEPAGE_TEXT "Hi, it takes a bit of time, but I'm functioning fine. I heard your double-clicking!"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW InstallerWelcomePageShow
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW InstallerProgressPageShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE InstallerProgressPageLeave
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "InstallerStartApp"
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW InstallerFinishPageShow
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customInstall
  Call InstallerShowFinishing
!macroend

Function InstallerWelcomePageShow
  GetDlgItem $0 $HWNDPARENT 1006
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Starting PokeRogue Offline Setup"
FunctionEnd

Function InstallerProgressPageShow
  ; MUI creates the install page as a #32770 dialog. Resolve that dialog first
  ; so the progress control remains valid across NSIS/electron-builder versions.
  StrCpy $0 $HWNDPARENT
  GetDlgItem $InstallerProgressBar $0 1004
  ${If} $InstallerProgressBar == 0
    FindWindow $0 "#32770" "" $HWNDPARENT
    ${If} $0 == 0
      StrCpy $0 $HWNDPARENT
    ${EndIf}
    GetDlgItem $InstallerProgressBar $0 1004
  ${EndIf}

  ; Keep the requested explanation in the wizard header.
  GetDlgItem $1 $HWNDPARENT 1037
  SendMessage $1 ${WM_SETTEXT} 0 "STR:Installing"
  GetDlgItem $1 $HWNDPARENT 1038
  SendMessage $1 ${WM_SETTEXT} 0 "STR:You are now installing an electron-based wrapper for the online game PokeRogue! This install is entirely offline gameplay."
  ; Leave the native install-page text control untouched: NSIS updates it
  ; with the file currently being extracted.
  GetDlgItem $1 $0 1006
  SendMessage $1 ${WM_GETFONT} 0 0 $2

  ; The native progress bar stays in its standard location. These compact
  ; controls sit above it, avoiding the clipping caused by moving a large
  ; multiline label over the bar.
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "Installing application files", i ${WS_CHILD}|${WS_VISIBLE}|${SS_LEFT}, i 18, i 18, i 460, i 20, p $0, p 0, p 0, p 0) p.r3'
  StrCpy $InstallerStatusLabel $3
  SendMessage $InstallerStatusLabel ${WM_SETFONT} $2 1

  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "[Done] Starting    [Done] Preparing$\r$\n[Now] Installing   [    ] Finishing", i ${WS_CHILD}|${WS_VISIBLE}|${SS_LEFT}, i 18, i 42, i 500, i 40, p $0, p 0, p 0, p 0) p.r3'
  StrCpy $InstallerStepsLabel $3
  SendMessage $InstallerStepsLabel ${WM_SETFONT} $2 1

  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "0%", i ${WS_CHILD}|${WS_VISIBLE}|${SS_RIGHT}, i 520, i 18, i 70, i 20, p $0, p 0, p 0, p 0) p.r3'
  StrCpy $InstallerPercentLabel $3
  SendMessage $InstallerPercentLabel ${WM_SETFONT} $2 1

  StrCpy $InstallerProgressTimerStarted "1"
  nsDialogs::CreateTimer InstallerUpdateProgress 100
  Call InstallerUpdateProgress
FunctionEnd

Function InstallerUpdateProgress
  ${If} $InstallerProgressBar == ""
    Return
  ${EndIf}
  SendMessage $InstallerProgressBar ${PBM_GETPOS} 0 0 $0
  ${If} $0 > 100
    StrCpy $0 100
  ${EndIf}
  ${If} $InstallerPercentLabel != ""
    SendMessage $InstallerPercentLabel ${WM_SETTEXT} 0 "STR:$0%"
  ${EndIf}
  ${If} $0 < 5
    SendMessage $InstallerStatusLabel ${WM_SETTEXT} 0 "STR:Installing application files"
    SendMessage $InstallerStepsLabel ${WM_SETTEXT} 0 "STR:[Done] Starting    [Done] Preparing$\r$\n[Now] Installing   [    ] Finishing"
  ${ElseIf} $0 < 75
    SendMessage $InstallerStatusLabel ${WM_SETTEXT} 0 "STR:Installing application files"
    SendMessage $InstallerStepsLabel ${WM_SETTEXT} 0 "STR:[Done] Starting    [Done] Preparing$\r$\n[Now] Installing   [    ] Finishing"
  ${ElseIf} $0 < 96
    SendMessage $InstallerStatusLabel ${WM_SETTEXT} 0 "STR:Installing offline game content"
    SendMessage $InstallerStepsLabel ${WM_SETTEXT} 0 "STR:[Done] Starting    [Done] Preparing$\r$\n[Now] Installing   [    ] Finishing"
  ${ElseIf} $0 < 100
    SendMessage $InstallerStatusLabel ${WM_SETTEXT} 0 "STR:Creating shortcuts"
    SendMessage $InstallerStepsLabel ${WM_SETTEXT} 0 "STR:[Done] Starting    [Done] Preparing$\r$\n[Done] Installing   [Now] Finishing"
  ${Else}
    Call InstallerShowFinishing
  ${EndIf}
FunctionEnd

Function InstallerShowFinishing
  ${If} $InstallerStatusLabel != ""
    SendMessage $InstallerStatusLabel ${WM_SETTEXT} 0 "STR:Finishing setup"
  ${EndIf}
  ${If} $InstallerStepsLabel != ""
    SendMessage $InstallerStepsLabel ${WM_SETTEXT} 0 "STR:[Done] Starting    [Done] Preparing$\r$\n[Done] Installing   [Now] Finishing"
  ${EndIf}
  ${If} $InstallerPercentLabel != ""
    SendMessage $InstallerPercentLabel ${WM_SETTEXT} 0 "STR:100%"
  ${EndIf}
FunctionEnd

Function InstallerProgressPageLeave
  ${If} $InstallerProgressTimerStarted == "1"
    nsDialogs::KillTimer InstallerUpdateProgress
    StrCpy $InstallerProgressTimerStarted "0"
  ${EndIf}
  ${If} $InstallerStepsLabel != ""
    System::Call 'user32::DestroyWindow(p $InstallerStepsLabel)'
    StrCpy $InstallerStepsLabel ""
  ${EndIf}
  ${If} $InstallerPercentLabel != ""
    System::Call 'user32::DestroyWindow(p $InstallerPercentLabel)'
    StrCpy $InstallerPercentLabel ""
  ${EndIf}
  ${If} $InstallerStatusLabel != ""
    System::Call 'user32::DestroyWindow(p $InstallerStatusLabel)'
    StrCpy $InstallerStatusLabel ""
  ${EndIf}
  StrCpy $InstallerProgressBar ""
FunctionEnd

Function InstallerFinishPageShow
  GetDlgItem $0 $HWNDPARENT 1006
  SendMessage $0 ${WM_SETTEXT} 0 "STR:PokeRogue Offline is installed"
FunctionEnd
!endif
