// PDF/Word 导出：预览窗口由渲染进程请求创建，主进程只负责建窗与转发导出请求。
import * as electron from "electron";
import {paths, writeLog} from "../shared/runtime";
import {appIconPath, desktopUserAgent, LOCAL_PAGE_WEB_PREFERENCES} from "../shared/desktopDefaults";
import {getWindowByContentId} from "../window/windowLookup";
import {installNavigationPolicy} from "../window/windowNavigation";
import {getWindowKernelTarget} from "../window/windowRegistry";
import {rememberWindowKernelTarget} from "../window/windowLifecycle";
import {createLocalKernelTarget} from "../kernel/kernelEndpoint";
import {Channel} from "../shared/channels";

const registerExportPreview = (): void => {
    electron.ipcMain.on(Channel.SIYUAN_EXPORT_PDF, (event, data) => {
        if (getWindowKernelTarget(event.sender.id)?.mode === "remote") {
            writeLog("ignored local PDF export in remote kernel mode");
            return;
        }
        data.webContentsId = event.sender.id;
        getWindowByContentId(data.parentWindowId)?.webContents.send(Channel.SIYUAN_EXPORT_PDF, data);
    });

    electron.ipcMain.on(Channel.SIYUAN_EXPORT_NEWWINDOW, (event, data) => {
        const kernelTarget = getWindowKernelTarget(event.sender.id);
        if (kernelTarget?.mode === "remote") {
            writeLog("ignored local PDF export window for remote kernel");
            return;
        }
        const senderWindow = getWindowByContentId(event.sender.id);
        if (!senderWindow) {
            return;
        }
        // 导出预览窗口取主窗口所在显示器尺寸的 80% https://github.com/siyuan-note/siyuan/issues/10554
        const wndBounds = senderWindow.getBounds();
        const wndScreen = electron.screen.getDisplayNearestPoint({x: wndBounds.x, y: wndBounds.y});
        const printWin = new electron.BrowserWindow({
            title: "SiYuan",
            show: true,
            width: Math.floor(wndScreen.size.width * 0.8),
            height: Math.floor(wndScreen.size.height * 0.8),
            resizable: true,
            frame: "darwin" === process.platform,
            icon: appIconPath(),
            titleBarStyle: "hidden",
            webPreferences: {
                ...LOCAL_PAGE_WEB_PREFERENCES,
                // 桌面端禁止自动播放多媒体 https://github.com/siyuan-note/siyuan/issues/7587
                autoplayPolicy: "user-gesture-required",
            },
        });
        printWin.center();
        const target = kernelTarget || createLocalKernelTarget();
        rememberWindowKernelTarget(printWin, target);
        printWin.webContents.userAgent = desktopUserAgent(paths.appVer, printWin.webContents.userAgent);
        printWin.loadURL(data);
        installNavigationPolicy(printWin, "export", target);
    });
};

export {registerExportPreview};
