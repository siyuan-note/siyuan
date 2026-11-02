import * as electron from "electron";
import {writeLog} from "../shared/runtime";
import {APP_PAGE, CHECK_AUTH_PAGE, SETTINGS_PAGE, WINDOW_PAGE} from "../shared/pagePaths";
import {isAllowedRemoteExternalURL} from "../remote/remoteKernel";
import type {BrowserWindow, WebContents} from "electron";
import type {KernelTarget} from "../shared/types";

// 外部链接统一从这里打开：远端内核下只允许 http/https，其余协议只记录不执行。
const openExternalURL = (url: string, remoteMode = false): void => {
    if (remoteMode && !isAllowedRemoteExternalURL(url)) {
        writeLog("blocked external protocol in remote kernel mode [url=" + url + "]");
        return;
    }
    electron.shell.openExternal(url);
};

const getWindowPathname = (window: BrowserWindow | null | undefined): string => {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
        return "";
    }
    try {
        return new URL(window.webContents.getURL()).pathname;
    } catch (error) {
        return "";
    }
};

const setProxy = (proxyURL: string, webContents: WebContents, proxyMode?: string): Promise<void> => {
    if (proxyMode === "system" || (!proxyMode && proxyURL.startsWith("://"))) {
        console.log("network proxy [system]");
        return webContents.session.setProxy({mode: "system"});
    }
    if (proxyMode === "direct") {
        console.log("network proxy [direct]");
        return webContents.session.setProxy({mode: "direct"});
    }
    console.log("network proxy [" + proxyURL + "]");
    return webContents.session.setProxy({proxyRules: proxyURL});
};

// 挂上导航策略：只有本窗口自身的页面留在应用内，其他链接交给系统浏览器。
const installNavigationPolicy = (currentWindow: BrowserWindow, windowType: string,
    target: Pick<KernelTarget, "origin" | "mode">): void => {
    const kernelOrigin = target.origin;
    const remoteMode = target.mode === "remote";
    currentWindow.webContents.on("will-navigate", (event) => {
        try {
            const targetURL = new URL(event.url);
            if (targetURL.origin === kernelOrigin && (
                windowType === "app" && [APP_PAGE, CHECK_AUTH_PAGE].includes(targetURL.pathname) ||
                windowType === "app" && !remoteMode && targetURL.pathname === "/" ||
                windowType === "window" && [WINDOW_PAGE, CHECK_AUTH_PAGE].includes(targetURL.pathname) ||
                windowType === "settings" && [SETTINGS_PAGE, CHECK_AUTH_PAGE].includes(targetURL.pathname) ||
                windowType === "export" && targetURL.pathname.startsWith("/export/temp/")
            )) {
                return;
            }
        } catch (e) {
            // 无法解析为 URL 的链接同样交给系统浏览器。
        }
        // 不属于本窗口页面的链接交给系统浏览器。
        event.preventDefault();
        openExternalURL(event.url, remoteMode);
    });
};

export {openExternalURL, getWindowPathname, setProxy, installNavigationPolicy};
