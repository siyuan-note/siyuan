!include WinVer.nsh
!include FileFunc.nsh
Caption "${PRODUCT_NAME} ${VERSION}"

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

!macro preInit
    ${IfNot} ${AtLeastWin10}
        !insertmacro WriteInstallLog "installer-rejected-unsupported-windows version=${VERSION}"
        MessageBox MB_ICONEXCLAMATION "非常抱歉，思源笔记无法在低于 Windows 10 的系统上进行安装$\n$\n\
            Sorry, SiYuan cannot be installed on systems below Windows 10$\n"
        Quit
    ${EndIf}

    !insertmacro WriteInstallLog "installer-start version=${VERSION} package=$EXEPATH"
    Push $R8
    Push $R7
    nsExec::Exec 'TASKKILL /F /IM "SiYuan.exe"'
    Pop $R8
    nsExec::Exec 'TASKKILL /F /IM "SiYuan-Kernel.exe"'
    Pop $R7
    !insertmacro WriteInstallLog "process-cleanup-complete version=${VERSION} app-result=$R8 kernel-result=$R7"
    Pop $R7
    Pop $R8
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
    !insertmacro WriteInstallLog "payload-extracted version=${VERSION} target=$INSTDIR"
    RMDir /r "$PROFILE\AppData\Local\siyuan-updater"
    nsExec::ExecToLog 'cmd /c mklink /H "$INSTDIR\resources\kernel\siyuan.exe" "$INSTDIR\resources\kernel\SiYuan-Kernel.exe" 2>nul || ver>nul'
    ${If} $installMode == "all"
        nsExec::ExecToLog 'powershell -NoProfile -Command "$k=\"$INSTDIR\resources\kernel\";$p=[Environment]::GetEnvironmentVariable(\"Path\",\"Machine\");if((-not $p) -or -not ($p.Split(\";\") -contains $k)){$p=\"$k;$p\";[Environment]::SetEnvironmentVariable(\"Path\",$p,\"Machine\")}else{Write-Host \"already in PATH\"}"'
    ${Else}
        nsExec::ExecToLog 'powershell -NoProfile -Command "$k=\"$INSTDIR\resources\kernel\";$p=[Environment]::GetEnvironmentVariable(\"Path\",\"User\");if((-not $p) -or -not ($p.Split(\";\") -contains $k)){$p=\"$k;$p\";[Environment]::SetEnvironmentVariable(\"Path\",$p,\"User\")}else{Write-Host \"already in PATH\"}"'
    ${EndIf}
    !insertmacro WriteInstallLog "install-complete version=${VERSION} target=$INSTDIR"
!macroend

!macro customUnInstall
    ${IfNot} ${isUpdated}
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
    ${If} $installMode == "all"
        nsExec::ExecToLog 'powershell -NoProfile -Command "$k=\"$INSTDIR\resources\kernel\";$p=[Environment]::GetEnvironmentVariable(\"Path\",\"Machine\");if($p){$a=$p.Split(\";\") | ?{$_ -and ($_ -ne $k)};$p=[string]::Join(\";\",$a);[Environment]::SetEnvironmentVariable(\"Path\",$p,\"Machine\")}"'
    ${Else}
        nsExec::ExecToLog 'powershell -NoProfile -Command "$k=\"$INSTDIR\resources\kernel\";$p=[Environment]::GetEnvironmentVariable(\"Path\",\"User\");if($p){$a=$p.Split(\";\") | ?{$_ -and ($_ -ne $k)};$p=[string]::Join(\";\",$a);[Environment]::SetEnvironmentVariable(\"Path\",$p,\"User\")}"'
    ${EndIf}
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
