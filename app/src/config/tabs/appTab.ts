/// #if !BROWSER
import {ipcRenderer} from "electron";
import * as path from "path";
/// #endif
import type {SettingTabBuilder} from "../setting/builder";
import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
/// #if !MOBILE
import {exportLayout} from "../../layout/util";
/// #endif
import {exitSiYuan} from "../../dialog/processSystem";
import {showMessage} from "../../dialog/message";
import {isBrowser} from "../../util/functions";
import {isMac, saveExportFile} from "../../protyle/util/compatibility";
import {afterExport} from "../../protyle/export/util";
import {genConfigItemMainHtml, genConfigItemName} from "../render/fragments";
import {sendAppSetting} from "./appRuntime";

const genImportUploadButtonHtml = (inputId: string, label: string): string =>
    `<button class="b3-button b3-button--outline fn__flex-center fn__size200" style="position: relative">
    <input id="${inputId}" class="b3-form__upload" type="file">
    <svg><use xlink:href="#iconDownload"></use></svg>
    ${label}
</button>`;

const registerAppGeneralGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("general", window.siyuan.languages.configGroupGeneral);

    if (!isBrowser() && !window.siyuan.config.system.isMicrosoftStore && window.siyuan.config.system.container === "std" && window.siyuan.config.system.os !== "linux") {
        group.select("system.autoLaunch2", {
            title: window.siyuan.languages.autoLaunch,
            desc: window.siyuan.languages.autoLaunchTip,
            options: [
                {value: 0, label: window.siyuan.languages.autoLaunchMode0},
                {value: 1, label: window.siyuan.languages.autoLaunchMode1},
                ...(!isMac() ? [{value: 2, label: window.siyuan.languages.autoLaunchMode2}] : []),
            ],
            save: (value) => sendAppSetting("system.autoLaunch2", value),
        });
    }
    group.slot({
        key: "networkProxy",
        keywords: [
            window.siyuan.languages.networkProxy,
            window.siyuan.languages.about17,
            window.siyuan.languages.directConnection,
            "SOCKS5",
            "HTTPS",
            "HTTP",
            "user:pass@IP",
            "Port",
            window.siyuan.languages.confirm,
        ],
        html: genNetworkProxyHtml,
        afterMount: mountNetworkProxy,
    });
};

const genNetworkProxyHtml = (): string => {
    const proxy = window.siyuan.config.system.networkProxy;
    return `<div class="b3-label config-item">
    ${genConfigItemName(window.siyuan.languages.networkProxy)}
    <div class="b3-label__text">
        ${window.siyuan.languages.about17}
    </div>
    <div class="b3-label__text fn__flex config-wrap" style="overflow: visible !important;">
        <select id="networkProxyScheme" class="b3-select">
            <option value="" ${proxy.scheme === "" ? "selected" : ""}>${window.siyuan.languages.directConnection}</option>
            <option value="socks5" ${proxy.scheme === "socks5" ? "selected" : ""}>SOCKS5</option>
            <option value="https" ${proxy.scheme === "https" ? "selected" : ""}>HTTPS</option>
            <option value="http" ${proxy.scheme === "http" ? "selected" : ""}>HTTP</option>
        </select>
        <span class="fn__space"></span>
        <input id="networkProxyHost" placeholder="user:pass@IP" class="b3-text-field fn__block" value="${Lute.EscapeHTMLStr(proxy.host)}"/>
        <span class="fn__space"></span>
        <input id="networkProxyPort" placeholder="Port" class="b3-text-field fn__block" value="${Lute.EscapeHTMLStr(proxy.port)}" type="number"/>
        <span class="fn__space"></span>
        <button id="networkProxyConfirm" class="b3-button fn__size200 b3-button--outline">${window.siyuan.languages.confirm}</button>
    </div>
</div>`;
};

const mountNetworkProxy = (root: HTMLElement) => {
    root.querySelector("#networkProxyConfirm")?.addEventListener("click", () => {
        const scheme = (root.querySelector("#networkProxyScheme") as HTMLSelectElement)?.value as Config.TSystemNetworkProxyScheme;
        const host = (root.querySelector("#networkProxyHost") as HTMLInputElement)?.value;
        const port = (root.querySelector("#networkProxyPort") as HTMLInputElement)?.value;
        fetchPost("/api/system/setNetworkProxy", {scheme, host, port}, async () => {
            Object.assign(window.siyuan.config.system.networkProxy, {scheme, host, port});
            /// #if !BROWSER
            ipcRenderer.invoke(Constants.SIYUAN_GET, {
                cmd: "setProxy",
                proxyURL: `${window.siyuan.config.system.networkProxy.scheme}://${window.siyuan.config.system.networkProxy.host}:${window.siyuan.config.system.networkProxy.port}`,
            }).then(() => {
                exportLayout({
                    errorExit: false,
                    cb() {
                        window.location.reload();
                    },
                });
            });
            /// #endif
        });
    });
};

const registerAppDataGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("data", window.siyuan.languages.configGroupData);

    group.button({
        id: "exportData",
        title: `${window.siyuan.languages.export} Data`,
        desc: window.siyuan.languages.exportDataTip,
        label: window.siyuan.languages.export,
        icon: "iconUpload",
        afterMount: mountExportData,
    });
    group.slot({
        key: "importData",
        keywords: [window.siyuan.languages.import, window.siyuan.languages.importDataTip],
        html: () => `<div class="fn__flex b3-label config-item config-wrap">
    ${genConfigItemMainHtml(`${window.siyuan.languages.import} Data`, window.siyuan.languages.importDataTip)}
    <span class="fn__space"></span>
    ${genImportUploadButtonHtml("importData", window.siyuan.languages.import)}
</div>`,
        afterMount: (root) => {
            root.querySelector("#importData")?.addEventListener("change", (event: Event) => {
                const target = event.target as HTMLInputElement;
                const formData = new FormData();
                formData.append("file", target.files[0]);
                fetchPost("/api/import/importData", formData);
            });
        },
    });
    group.button({
        id: "exportConf",
        title: window.siyuan.languages.exportConf,
        desc: window.siyuan.languages.exportConfTip,
        label: window.siyuan.languages.export,
        icon: "iconUpload",
        afterMount: (root) => {
            root.querySelector("#exportConf")?.addEventListener("click", () => {
                fetchPost("/api/system/exportConf", {}, (response) => {
                    void saveExportFile(response.data.zip);
                });
            });
        },
    });
    group.slot({
        key: "importConf",
        keywords: [window.siyuan.languages.importConf, window.siyuan.languages.importConfTip],
        html: () => `<div class="fn__flex b3-label config-item config-wrap">
    ${genConfigItemMainHtml(window.siyuan.languages.importConf, window.siyuan.languages.importConfTip)}
    <span class="fn__space"></span>
    ${genImportUploadButtonHtml("importConf", window.siyuan.languages.import)}
</div>`,
        afterMount: (root) => {
            root.querySelector("#importConf")?.addEventListener("change", (event: Event) => {
                const target = event.target as HTMLInputElement;
                const formData = new FormData();
                formData.append("file", target.files[0]);
                fetchPost("/api/system/importConf", formData, (response) => {
                    if (response.code !== 0) {
                        showMessage(response.msg);
                        return;
                    }
                    showMessage(window.siyuan.languages.imported);
                    /// #if MOBILE
                    void exitSiYuan();
                    /// #else
                    void exportLayout({
                        errorExit: true,
                        cb: exitSiYuan,
                    });
                    /// #endif
                });
            });
        },
    });
};

const mountExportData = (root: HTMLElement) => {
    root.querySelector("#exportData")?.addEventListener("click", async () => {
        /// #if BROWSER
        fetchPost("/api/export/exportData", {}, (response) => {
            saveExportFile(response.data.zip);
        });
        /// #else
        const result = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
            cmd: "showOpenDialog",
            title: window.siyuan.languages.export + " " + "Data",
            properties: ["createDirectory", "openDirectory"],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return;
        }
        const msgId = showMessage(window.siyuan.languages.exporting, -1);
        fetchPost("/api/export/exportDataInFolder", {
            folder: result.filePaths[0],
        }, (response) => {
            afterExport(path.join(result.filePaths[0], response.data.name), msgId);
        });
        /// #endif
    });
};

const registerAppMaintenanceGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("maintenance", window.siyuan.languages.configGroupMaintenance);

    group.button({
        id: "reloadUI",
        title: window.siyuan.languages.reloadUI,
        desc: window.siyuan.languages.reloadUITip,
        label: window.siyuan.languages.reloadUI,
        icon: "iconRefresh",
        afterMount: (root) => {
            root.querySelector("#reloadUI")?.addEventListener("click", () => {
                fetchPost("/api/ui/reloadUI", {});
            });
        },
    });
    group.button({
        id: "vacuumDataIndex",
        title: window.siyuan.languages.vacuumDataIndex,
        desc: window.siyuan.languages.vacuumDataIndexTip,
        label: window.siyuan.languages.vacuumDataIndex,
        icon: "iconRefresh",
        afterMount: (root) => {
            root.querySelector("#vacuumDataIndex")?.addEventListener("click", () => {
                fetchPost("/api/system/vacuumDataIndex", {});
            });
        },
    });
    group.button({
        id: "rebuildDataIndex",
        title: window.siyuan.languages.rebuildDataIndex,
        desc: window.siyuan.languages.rebuildDataIndexTip,
        label: window.siyuan.languages.rebuildDataIndex,
        icon: "iconRefresh",
        afterMount: (root) => {
            root.querySelector("#rebuildDataIndex")?.addEventListener("click", () => {
                fetchPost("/api/system/rebuildDataIndex", {});
            });
        },
    });
    group.button({
        id: "clearTempFiles",
        title: window.siyuan.languages.clearTempFiles,
        desc: window.siyuan.languages.clearTempFilesTip,
        label: window.siyuan.languages.purge,
        icon: "iconTrashcan",
        afterMount: (root) => {
            root.querySelector("#clearTempFiles")?.addEventListener("click", () => {
                fetchPost("/api/system/clearTempFiles", {});
            });
        },
    });
    group.button({
        id: "exportLog",
        title: window.siyuan.languages.systemLog,
        desc: window.siyuan.languages.systemLogTip,
        label: window.siyuan.languages.export,
        icon: "iconUpload",
        afterMount: (root) => {
            root.querySelector("#exportLog")?.addEventListener("click", () => {
                fetchPost("/api/system/exportLog", {}, (response) => {
                    void saveExportFile(response.data.zip);
                });
            });
        },
    });
};

export const registerAppTab = (tab: SettingTabBuilder) => {
    registerAppGeneralGroup(tab);
    registerAppDataGroup(tab);
    registerAppMaintenanceGroup(tab);
};
