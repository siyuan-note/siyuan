/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
/// #if !MOBILE
import {exportLayout} from "../../layout/util";
/// #endif
import {exitSiYuan} from "../../dialog/processSystem";

/** 应用 / 关于 / 访问授权等 Tab 中的 system.* 设置项 save */
export const sendAppSetting = (controlId: string, value: unknown) => {
    switch (controlId) {
        case "system.autoLaunch2": {
            const autoLaunchMode = value as Config.ISystem["autoLaunch2"];
            fetchPost("/api/system/setAutoLaunch", {autoLaunch: autoLaunchMode}, () => {
                window.siyuan.config.system.autoLaunch2 = autoLaunchMode;
                /// #if !BROWSER
                ipcRenderer.send(Constants.SIYUAN_AUTO_LAUNCH, {
                    openAtLogin: 0 !== autoLaunchMode,
                    openAsHidden: 2 === autoLaunchMode,
                });
                /// #endif
            });
            break;
        }
        case "system.lockScreenMode": {
            const lockScreenMode = (value ? 1 : 0) as Config.ISystem["lockScreenMode"];
            fetchPost("/api/system/setFollowSystemLockScreen", {lockScreenMode}, () => {
                window.siyuan.config.system.lockScreenMode = lockScreenMode;
            });
            break;
        }
        case "system.networkServe": {
            const networkServe = Boolean(value) as Config.ISystem["networkServe"];
            fetchPost("/api/system/setNetworkServe", {networkServe}, () => {
                /// #if MOBILE
                void exitSiYuan();
                /// #else
                void exportLayout({
                    errorExit: true,
                    cb: exitSiYuan,
                });
                /// #endif
            });
            break;
        }
        case "system.networkServeTLS": {
            const networkServeTLS = Boolean(value) as Config.ISystem["networkServeTLS"];
            fetchPost("/api/system/setNetworkServeTLS", {networkServeTLS}, () => {
                /// #if MOBILE
                void exitSiYuan();
                /// #else
                void exportLayout({
                    errorExit: true,
                    cb: exitSiYuan,
                });
                /// #endif
            });
            break;
        }
        case "system.downloadInstallPkg": {
            const downloadInstallPkg = Boolean(value) as Config.ISystem["downloadInstallPkg"];
            fetchPost("/api/system/setDownloadInstallPkg", {downloadInstallPkg}, () => {
                window.siyuan.config.system.downloadInstallPkg = downloadInstallPkg;
            });
            break;
        }
        default:
            console.warn(`[config] sendAppSetting: unhandled controlId "${controlId}"`);
            break;
    }
};
