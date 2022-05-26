Caption "${PRODUCT_NAME} ${VERSION}"

!macro preInit
    nsExec::Exec 'TASKKILL /F /IM "SiYuan.exe"'
    nsExec::Exec 'TASKKILL /F /IM "SiYuan-Kernel.exe"'
    nsExec::Exec 'TASKKILL /F /IM "SiYuan Kernel.exe"'
!macroend

!macro customInstallMode
    MessageBox MB_ICONEXCLAMATION|MB_OKCANCEL "进行安装或卸载时会删除安装目录下所有文件，请务必确认工作空间没有放置在安装路径下！是否继续？$\n$\n\
        When installing or uninstalling, all files in the installation directory will be deleted, please make sure that the workspace is not placed in the installation path! Do you want to continue?$\n" IDOK yes IDCANCEL no
    no:
        Abort
    yes:
!macroend
