!include WinVer.nsh
Caption "${PRODUCT_NAME} ${VERSION}"

!macro preInit
    nsExec::Exec 'TASKKILL /F /IM "SiYuan.exe"'
    nsExec::Exec 'TASKKILL /F /IM "SiYuan-Kernel.exe"'
!macroend

!macro customInstallMode
    ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONEXCLAMATION "即将停止对 Windows 7/8 和 Server 2012 的支持，建议升级到 Windows 10 或者更高版本。$\n$\n\
        Support for Windows 7/8 and Server 2012 will be stopped soon, it is recommended to upgrade to Windows 10 or higher version.$\n"
    ${EndIf}

    MessageBox MB_ICONEXCLAMATION|MB_OKCANCEL "进行安装或卸载时会删除安装目录下所有文件，请务必确认工作空间没有放置在安装路径下！是否继续？$\n$\n\
        When installing or uninstalling, all files in the installation directory will be deleted, please make sure that the workspace is not placed in the installation path! Do you want to continue?$\n" IDOK yes IDCANCEL no
    no:
        Quit
    yes:
!macroend
