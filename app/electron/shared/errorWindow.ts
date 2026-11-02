import {app, BrowserWindow, screen} from "electron";
import * as path from "node:path";
import {paths, state, getArg} from "./runtime";
import {appIconPath, LOCAL_PAGE_WEB_PREFERENCES} from "./desktopDefaults";

type ConnectionManager = {
    show: (options: {lang?: string; error: string}) => void;
};

/** 错误窗口的可选呈现细节。 */
type ErrorWindowOptions = {emoji?: string; logPath?: string};

// 连接管理器在 app 就绪后创建；远端模式下错误交给它显示，因此只做一次登记。
let connectionManager: ConnectionManager | undefined;

const setConnectionManager = (manager: ConnectionManager): void => {
    connectionManager = manager;
};

const showErrorWindow = (titleZh: string, titleEn: string, content: string,
    {emoji = "⚠️", logPath = ""}: ErrorWindowOptions = {}): number | undefined => {
    if (connectionManager && (state.startup.remoteKernelTarget || state.startup.remoteKernelArgError)) {
        connectionManager.show({
            lang: getArg("--lang"),
            error: titleZh + "\n" + titleEn + "\n" + content.replace(/<[^>]*>/g, " "),
        });
        return undefined;
    }
    const errorHTMLPath = path.join(paths.assetsDir, "error.html");
    const errWindow = new BrowserWindow({
        width: Math.floor(screen.getPrimaryDisplay().size.width * 0.5),
        height: Math.floor(screen.getPrimaryDisplay().workAreaSize.height * 0.8),
        frame: "darwin" === process.platform,
        titleBarStyle: "hidden",
        fullscreenable: false,
        icon: appIconPath(),
        transparent: "darwin" === process.platform, // 避免深色模式关闭窗口时闪现白色背景
        webPreferences: {...LOCAL_PAGE_WEB_PREFERENCES},
    });
    errWindow.loadFile(errorHTMLPath, {
        query: {
            home: app.getPath("home"),
            v: paths.appVer,
            title: `<h2>${titleZh}</h2><h2>${titleEn}</h2>`,
            emoji,
            content,
            logPath,
            icon: appIconPath(),
        },
    });
    errWindow.show();
    return errWindow.id;
};

export {setConnectionManager, showErrorWindow};
export type {ErrorWindowOptions};
