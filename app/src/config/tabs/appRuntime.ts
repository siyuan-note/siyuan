import {config as configApi} from "../util/configApi";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {Constants} from "../../constants";
/// #if !MOBILE
import {exportLayout} from "../../layout/util";
/// #endif
import {exitSiYuan} from "../../dialog/processSystem";
/// #if !BROWSER && !MOBILE
import {getSettingsOwnerApp, getSettingsWindowHost} from "../setting/windowContext";
import {flushSettingSaves, settingSaveFailures} from "../setting/pending";
import {showMessage} from "../../dialog/message";
/// #endif

/** 应用 / 关于 / 访问授权等 Tab 中的 system.* 设置项 save */
export const sendAppSetting = (controlId: string, value: unknown) => {
    switch (controlId) {
        case "system.autoLaunch2": {
            const autoLaunchMode = value as Config.ISystem["autoLaunch2"];
            configApi.set("system.autoLaunch2", autoLaunchMode, () => {
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
            configApi.set("system.lockScreenMode", lockScreenMode, () => {
                window.siyuan.config.system.lockScreenMode = lockScreenMode;
            });
            break;
        }
        case "system.networkServe": {
            const networkServe = Boolean(value) as Config.ISystem["networkServe"];
            configApi.set("system.networkServe", networkServe, () => {
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
            configApi.set("system.networkServeTLS", networkServeTLS, () => {
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
            configApi.set("system.downloadInstallPkg", downloadInstallPkg, () => {
                window.siyuan.config.system.downloadInstallPkg = downloadInstallPkg;
            });
            break;
        }
        case "system.updateChannel": {
            const updateChannel = value as Config.TUpdateChannel;
            configApi.set("system.updateChannel", updateChannel, () => {
                window.siyuan.config.system.updateChannel = updateChannel;
            });
            break;
        }
        case "system.settingsWindow": {
            const settingsWindow = Boolean(value) as Config.ISystem["settingsWindow"];
            /// #if !BROWSER && !MOBILE
            const previousFailures = settingSaveFailures();
            /// #endif
            const saved = configApi.set("system.settingsWindow", settingsWindow, () => {
                window.siyuan.config.system.settingsWindow = settingsWindow;
            });
            /// #if !BROWSER && !MOBILE
            void saved.then(async () => {
                await flushSettingSaves(previousFailures);
                if (window.siyuan.config.system.settingsWindow !== settingsWindow) return;
                const host = getSettingsWindowHost();
                if (host) {
                    if (host.isActive()) await host.reopenSettings(settingsWindow);
                    return;
                }
                const {openSetting} = await import("../index");
                if (window.siyuan.config.system.settingsWindow === settingsWindow) {
                    openSetting(getSettingsOwnerApp(), "app");
                }
            }).catch(error => {
                console.error("Could not switch settings interface", error);
                showMessage(window.siyuan.languages.settingsPendingSaveError, 6000, "error");
            });
            /// #endif
            break;
        }
        default:
            console.warn(`[config] sendAppSetting: unhandled controlId "${controlId}"`);
            break;
    }
};
