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
  GetDlgItem $InstallerProgressBar $HWNDPARENT 1004
  GetDlgItem $InstallerStatusLabel $HWNDPARENT 1006
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "Starting$\r$\nPreparing$\r$\nInstalling$\r$\nFinishing", i ${WS_CHILD}|${WS_VISIBLE}, i 18, i 78, i 112, i 92, p $HWNDPARENT, p 0, p 0, p 0) p.r0'
  StrCpy $InstallerStepsLabel $0
  SendMessage $InstallerStatusLabel ${WM_GETFONT} 0 0 $2
  SendMessage $InstallerStepsLabel ${WM_SETFONT} $2 1
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "0%", i ${WS_CHILD}|${WS_VISIBLE}|${SS_RIGHT}, i 410, i 188, i 52, i 18, p $HWNDPARENT, p 0, p 0, p 0) p.r0'
  StrCpy $InstallerPercentLabel $0
  SendMessage $InstallerPercentLabel ${WM_SETFONT} $2 1
  System::Call 'user32::SetWindowPos(p $InstallerStatusLabel, p 0, i 145, i 78, i 317, i 28, i 0x0004)'
  System::Call 'user32::SetWindowPos(p $InstallerProgressBar, p 0, i 145, i 188, i 258, i 16, i 0x0004)'
  SendMessage $InstallerStatusLabel ${WM_SETTEXT} 0 "STR:Preparing installation"
  SendMessage $InstallerStepsLabel ${WM_SETTEXT} 0 "STR:[Done] Starting$\r$\n[Now]  Preparing$\r$\n[    ]  Installing$\r$\n[    ]  Finishing"
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
  SendMessage $InstallerPercentLabel ${WM_SETTEXT} 0 "STR:$0%"
  ${If} $0 < 5
    SendMessage $InstallerStatusLabel ${WM_SETTEXT} 0 "STR:Preparing installation"
    SendMessage $InstallerStepsLabel ${WM_SETTEXT} 0 "STR:[Done] Starting$\r$\n[Now]  Preparing$\r$\n[    ]  Installing$\r$\n[    ]  Finishing"
  ${ElseIf} $0 < 75
    SendMessage $InstallerStatusLabel ${WM_SETTEXT} 0 "STR:Installing application files"
    SendMessage $InstallerStepsLabel ${WM_SETTEXT} 0 "STR:[Done] Starting$\r$\n[Done] Preparing$\r$\n[Now]  Installing$\r$\n[    ]  Finishing"
  ${ElseIf} $0 < 96
    SendMessage $InstallerStatusLabel ${WM_SETTEXT} 0 "STR:Installing offline game content"
    SendMessage $InstallerStepsLabel ${WM_SETTEXT} 0 "STR:[Done] Starting$\r$\n[Done] Preparing$\r$\n[Now]  Installing$\r$\n[    ]  Finishing"
  ${ElseIf} $0 < 100
    SendMessage $InstallerStatusLabel ${WM_SETTEXT} 0 "STR:Creating shortcuts"
    SendMessage $InstallerStepsLabel ${WM_SETTEXT} 0 "STR:[Done] Starting$\r$\n[Done] Preparing$\r$\n[Done] Installing$\r$\n[Now]  Finishing"
  ${Else}
    Call InstallerShowFinishing
  ${EndIf}
FunctionEnd

Function InstallerShowFinishing
  ${If} $InstallerStatusLabel != ""
    SendMessage $InstallerStatusLabel ${WM_SETTEXT} 0 "STR:Finishing setup"
  ${EndIf}
  ${If} $InstallerStepsLabel != ""
    SendMessage $InstallerStepsLabel ${WM_SETTEXT} 0 "STR:[Done] Starting$\r$\n[Done] Preparing$\r$\n[Done] Installing$\r$\n[Now]  Finishing"
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
  StrCpy $InstallerProgressBar ""
  StrCpy $InstallerStatusLabel ""
FunctionEnd

Function InstallerFinishPageShow
  GetDlgItem $0 $HWNDPARENT 1006
  SendMessage $0 ${WM_SETTEXT} 0 "STR:PokeRogue Offline is installed"
FunctionEnd
!endif
