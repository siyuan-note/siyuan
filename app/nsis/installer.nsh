!include WinVer.nsh
!include FileFunc.nsh
Caption "${PRODUCT_NAME} ${VERSION}"

!define MARKDOWN_PROG_ID "org.b3log.siyuan.markdown"
!define SIYUAN_PATH_SCRIPT "${__FILEDIR__}\path.ps1"

!macro UpdateKernelPath Operation
    Push $R9
    InitPluginsDir
    File /oname=$PLUGINSDIR\siyuan-path.ps1 "${SIYUAN_PATH_SCRIPT}"
    ${If} $installMode == "all"
        nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\siyuan-path.ps1" -Operation ${Operation} -Scope Machine -KernelDirectory "$INSTDIR\resources\kernel"'
    ${Else}
        nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\siyuan-path.ps1" -Operation ${Operation} -Scope User -KernelDirectory "$INSTDIR\resources\kernel"'
    ${EndIf}
    Pop $R9
    ${If} $R9 == 0
        System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x001a, p 0, w "Environment", i 2, i 5000, p 0)'
    ${EndIf}
    Pop $R9
!macroend

!macro RegisterMarkdownOpenWith
    # 只加入打开方式，不修改扩展名默认值或用户的 UserChoice。
    WriteRegStr SHELL_CONTEXT "Software\Classes\${MARKDOWN_PROG_ID}" "" "SiYuan Markdown"
    WriteRegStr SHELL_CONTEXT "Software\Classes\${MARKDOWN_PROG_ID}\DefaultIcon" "" '"$INSTDIR\resources\markdown.ico",0'
    WriteRegStr SHELL_CONTEXT "Software\Classes\${MARKDOWN_PROG_ID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --markdown "%1"'
    WriteRegNone SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "${MARKDOWN_PROG_ID}"
    WriteRegNone SHELL_CONTEXT "Software\Classes\.markdown\OpenWithProgids" "${MARKDOWN_PROG_ID}"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro UnregisterMarkdownOpenWith
    # 旧安装器不得移除已指向其他安装目录的登记，也不清理其他应用的键。
    Push $R9
    ReadRegStr $R9 SHELL_CONTEXT "Software\Classes\${MARKDOWN_PROG_ID}\shell\open\command" ""
    ${If} $R9 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --markdown "%1"'
        DeleteRegValue SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "${MARKDOWN_PROG_ID}"
        DeleteRegValue SHELL_CONTEXT "Software\Classes\.markdown\OpenWithProgids" "${MARKDOWN_PROG_ID}"
        DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids"
        DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.markdown\OpenWithProgids"
        DeleteRegKey SHELL_CONTEXT "Software\Classes\${MARKDOWN_PROG_ID}"
        System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
    ${EndIf}
    Pop $R9
!macroend

!macro WriteInstallLog Stage
    Push "${Stage}"
    Call AppendInstallLog
!macroend

Function AppendInstallLog
    Exch $R9
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    Push $6
    Push $7

    ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
    ClearErrors
    FileOpen $7 "$TEMP\SiYuan-install.log" a
    IfErrors installLogDone
    FileSeek $7 0 END
    FileWrite $7 "$2-$1-$0 $4:$5:$6 $R9$\r$\n"
    FileClose $7

installLogDone:
    ClearErrors
    Pop $7
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    Pop $R9
FunctionEnd

!macro StopSiYuanProcess ProcessName
    nsProcess::_FindProcess /NOUNLOAD "${ProcessName}"
    Pop $R8
    ${If} $R8 == 0
        nsProcess::_KillProcess /NOUNLOAD "${ProcessName}"
        Pop $R8
        !insertmacro WriteInstallLog "process-stop version=${VERSION} process=${ProcessName} result=$R8"
    ${EndIf}
!macroend

Function StopSiYuanProcesses
    Push $R7
    Push $R8
    Push $R9

stopSiYuanRetry:
    # 使用安装器内的插件关闭进程，避免依赖外部命令。
    !insertmacro StopSiYuanProcess "SiYuan.exe"
    !insertmacro StopSiYuanProcess "SiYuan-Kernel.exe"
    StrCpy $R9 0

stopSiYuanWait:
    nsProcess::_FindProcess /NOUNLOAD "SiYuan.exe"
    Pop $R8
    nsProcess::_FindProcess /NOUNLOAD "SiYuan-Kernel.exe"
    Pop $R7
    # 只有明确返回未找到进程时才继续安装，检测失败不能视为进程已退出。
    ${If} $R8 == 603
    ${AndIf} $R7 == 603
        !insertmacro WriteInstallLog "process-cleanup-complete version=${VERSION} app-result=$R8 kernel-result=$R7"
        Goto stopSiYuanDone
    ${EndIf}

    IntOp $R9 $R9 + 1
    ${If} $R9 < 10
        Sleep 200
        Goto stopSiYuanWait
    ${EndIf}

    !insertmacro WriteInstallLog "process-cleanup-blocked version=${VERSION} app-result=$R8 kernel-result=$R7"
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY stopSiYuanRetry
    nsProcess::_Unload
    SetErrorLevel 1
    Quit

stopSiYuanDone:
    nsProcess::_Unload
    Pop $R9
    Pop $R8
    Pop $R7
FunctionEnd

!ifndef BUILD_UNINSTALLER
    # 安装阶段按进程名再次检查，避免安装目录前缀命中工作空间或安装器自身。
    !macro customCheckAppRunning
        Call StopSiYuanProcesses
    !macroend
!endif

!macro preInit
    SetOutPath "$TEMP"
    ${IfNot} ${AtLeastWin10}
        !insertmacro WriteInstallLog "installer-rejected-unsupported-windows version=${VERSION}"
        MessageBox MB_ICONEXCLAMATION "非常抱歉，思源笔记无法在低于 Windows 10 的系统上进行安装$\n$\n\
            Sorry, SiYuan cannot be installed on systems below Windows 10$\n"
        Quit
    ${EndIf}

    !insertmacro WriteInstallLog "installer-start version=${VERSION} package=$EXEPATH"
    !ifndef BUILD_UNINSTALLER
        Call StopSiYuanProcesses
    !endif
!macroend

!macro customInit
    ${FindIt} "$INSTDIR" "data" $R0
    ${If} -1 != $R0
        !insertmacro WriteInstallLog "installer-rejected-workspace-data version=${VERSION} target=$INSTDIR detected=$R0"
        MessageBox MB_ICONSTOP "检测到安装路径下包含了工作空间数据 $R0，请将工作空间文件夹移到其他位置后再试。$\n$\n\
            The workspace data $R0 was detected in the installation path, please move the workspace folder to another location and try again.$\n"
        Quit
    ${EndIf}
    !insertmacro WriteInstallLog "installer-ready version=${VERSION} target=$INSTDIR"
!macroend

!macro customUnInit
    ${un.FindIt} "$INSTDIR" "data" $R0
    ${If} -1 != $R0
        MessageBox MB_ICONSTOP "检测到安装路径下包含了工作空间数据 $R0，请将工作空间文件夹移到其他位置后再试。$\n$\n\
            The workspace data $R0 was detected in the installation path, please move the workspace folder to another location and try again.$\n"
        Quit
    ${EndIf}
!macroend

!macro customInstall
    !insertmacro RegisterMarkdownOpenWith
    !insertmacro WriteInstallLog "payload-extracted version=${VERSION} target=$INSTDIR"
    RMDir /r "$PROFILE\AppData\Local\siyuan-updater"
    nsExec::ExecToLog '"$SYSDIR\cmd.exe" /c mklink /H "$INSTDIR\resources\kernel\siyuan.exe" "$INSTDIR\resources\kernel\SiYuan-Kernel.exe" 2>nul || ver>nul'
    !insertmacro UpdateKernelPath Add
    !insertmacro WriteInstallLog "install-complete version=${VERSION} target=$INSTDIR"
!macroend

!macro customUnInstall
    ${IfNot} ${isUpdated}
        !insertmacro UnregisterMarkdownOpenWith
    ${EndIf}
    ${IfNot} ${isUpdated}
        # 真正卸载时清理共用安装包，更新安装期间保留缓存。
        RMDir /r "$PROFILE\.config\siyuan\install"
        IfFileExists "$PROFILE\.config\siyuan\*.*" 0 skipConfigDelete
            MessageBox MB_YESNO "是否需要彻底删除全局配置（$PROFILE\.config\siyuan\）？$\n$\n\
                Do you want to delete the global configuration ($PROFILE\.config\siyuan\)?$\n" \
                /SD IDYES IDYES AcceptedRMConf IDNO SkippedRMConf
                AcceptedRMConf:
                    RMDir /r "$PROFILE\.config\siyuan\"
                SkippedRMConf:
        skipConfigDelete:
    ${EndIf}

    ${IfNot} ${isUpdated}
        IfFileExists "$PROFILE\SiYuan\*.*" 0 skipWorkspaceDelete
            MessageBox MB_YESNO "是否需要彻底删除默认工作空间（$PROFILE\SiYuan\）？$\n$\n\
                Do you want to completely delete the default workspace ($PROFILE\SiYuan\)?$\n" \
                /SD IDNO IDYES AcceptedRMWorkspace IDNO SkippedRMWrokspace
                AcceptedRMWorkspace:
                    RMDir /r "$PROFILE\SiYuan\"
                SkippedRMWrokspace:
        skipWorkspaceDelete:
    ${EndIf}

    RMDir /r "$PROFILE\AppData\Local\siyuan-updater"
    !insertmacro UpdateKernelPath Remove
!macroend

# https://nsis.sourceforge.io/FindIt:_Simple_search_for_file_/_directory
!macro un.FindIt In For Result
Push "${In}"
Push "${For}"
 Call un.FindIt
Pop "${Result}"
!macroend
!define un.FindIt "!insertmacro un.FindIt"

Function un.FindIt
Exch $R0
Exch
Exch $R1
Push $R2
Push $R3
Push $R4
Push $R5
Push $R6

 StrCpy $R6 -1
 StrCpy $R3 1

 Push $R1

 nextDir:
  Pop $R1
  IntOp $R3 $R3 - 1
  ClearErrors
   FindFirst $R5 $R2 "$R1\*.*"

 nextFile:
  StrCmp $R2 "." gotoNextFile
  StrCmp $R2 ".." gotoNextFile

  StrCmp $R2 $R0 0 isDir
   StrCpy $R6 "$R1\$R2"
   loop:
    StrCmp $R3 0 done
     Pop $R1
     IntOp $R3 $R3 - 1
     Goto loop

 isDir:

  IfFileExists "$R1\$R2\*.*" 0 gotoNextFile
  IntOp $R3 $R3 + 1
  Push "$R1\$R2"

 gotoNextFile:
  FindNext $R5 $R2
  IfErrors 0 nextFile

 done:
  FindClose $R5
  StrCmp $R3 0 0 nextDir
  StrCpy $R0 $R6

Pop $R6
Pop $R5
Pop $R4
Pop $R3
Pop $R2
Pop $R1
Exch $R0
FunctionEnd

# 只能重复实现一遍，因为 un.FindIt 只能用在卸载过程中，这是 nsis 的命名限制
!macro FindIt In For Result
Push "${In}"
Push "${For}"
 Call FindIt
Pop "${Result}"
!macroend
!define FindIt "!insertmacro FindIt"

Function FindIt
Exch $R0
Exch
Exch $R1
Push $R2
Push $R3
Push $R4
Push $R5
Push $R6

 StrCpy $R6 -1
 StrCpy $R3 1

 Push $R1

 nextDir:
  Pop $R1
  IntOp $R3 $R3 - 1
  ClearErrors
   FindFirst $R5 $R2 "$R1\*.*"

 nextFile:
  StrCmp $R2 "." gotoNextFile
  StrCmp $R2 ".." gotoNextFile

  StrCmp $R2 $R0 0 isDir
   StrCpy $R6 "$R1\$R2"
   loop:
    StrCmp $R3 0 done
     Pop $R1
     IntOp $R3 $R3 - 1
     Goto loop

 isDir:

  IfFileExists "$R1\$R2\*.*" 0 gotoNextFile
  IntOp $R3 $R3 + 1
  Push "$R1\$R2"

 gotoNextFile:
  FindNext $R5 $R2
  IfErrors 0 nextFile

 done:
  FindClose $R5
  StrCmp $R3 0 0 nextDir
  StrCpy $R0 $R6

Pop $R6
Pop $R5
Pop $R4
Pop $R3
Pop $R2
Pop $R1
Exch $R0
FunctionEnd
