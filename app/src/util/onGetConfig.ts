import {openSearch} from "../search/spread";
import {exportLayout, JSONToLayout, resetLayout, resizeDrag, resizeTabs} from "../layout/util";
import {hotKey2Electron, setStorageVal, updateHotkeyTip} from "../protyle/util/compatibility";
/// #if !BROWSER
import {dialog, getCurrentWindow} from "@electron/remote";
import {ipcRenderer, OpenDialogReturnValue} from "electron";
import * as fs from "fs";
import * as path from "path";
import {afterExport} from "../protyle/export/util";
import {destroyPrintWindow} from "../protyle/export";
/// #endif
import {Constants} from "../constants";
import {appearance} from "../config/appearance";
import {globalShortcut} from "./globalShortcut";
import {fetchPost} from "./fetch";
import {mountHelp, newDailyNote} from "./mount";
import {MenuItem} from "../menus/Menu";
import {addGA, initAssets, setInlineStyle, setMode} from "./assets";
import {renderSnippet} from "../config/util/snippets";
import {getOpenNotebookCount} from "./pathName";
import {openFileById} from "../editor/util";
import {focusByRange} from "../protyle/util/selection";
import {exitSiYuan} from "../dialog/processSystem";
import {openSetting} from "../config";
import {getSearch} from "./functions";
import {initStatus} from "../layout/status";
import {syncGuide} from "../sync/syncGuide";
import {showMessage} from "../dialog/message";
import {editor} from "../config/editor";
import {goBack, goForward} from "./backForward";
import {replaceLocalPath} from "../editor/rename";
import {openHistory} from "../history/history";
import {openCard} from "../card/openCard";

const matchKeymap = (keymap: Record<string, IKeymapItem>, key1: "general" | "editor", key2?: "general" | "insert" | "heading" | "list" | "table") => {
    if (key1 === "general") {
        if (!window.siyuan.config.keymap[key1]) {
            window.siyuan.config.keymap[key1] = keymap;
            return false;
        }
    } else {
        if (!window.siyuan.config.keymap[key1]) {
            window.siyuan.config.keymap[key1] = JSON.parse(JSON.stringify(Constants.SIYUAN_KEYMAP.editor));
            return false;
        }
        if (!window.siyuan.config.keymap[key1][key2]) {
            window.siyuan.config.keymap[key1][key2] = keymap;
            return false;
        }
    }
    let match = true;
    Object.keys(keymap).forEach(key => {
        if (key1 === "general") {
            if (!window.siyuan.config.keymap[key1][key] || window.siyuan.config.keymap[key1][key].default !== keymap[key].default) {
                match = false;
                window.siyuan.config.keymap[key1][key] = keymap[key];
            }
        } else {
            if (!window.siyuan.config.keymap[key1][key2][key] || window.siyuan.config.keymap[key1][key2][key].default !== keymap[key].default) {
                match = false;
                window.siyuan.config.keymap[key1][key2][key] = keymap[key];
            }
        }
    });
    return match;
};

const hasKeymap = (keymap: Record<string, IKeymapItem>, key1: "general" | "editor", key2?: "general" | "insert" | "heading" | "list" | "table") => {
    let match = true;
    if (key1 === "editor") {
        if (Object.keys(window.siyuan.config.keymap[key1][key2]).length !== Object.keys(Constants.SIYUAN_KEYMAP[key1][key2]).length) {
            Object.keys(window.siyuan.config.keymap[key1][key2]).forEach(item => {
                if (!Constants.SIYUAN_KEYMAP[key1][key2][item]) {
                    match = false;
                    delete window.siyuan.config.keymap[key1][key2][item];
                }
            });
        }
    } else {
        if (Object.keys(window.siyuan.config.keymap[key1]).length !== Object.keys(Constants.SIYUAN_KEYMAP[key1]).length) {
            Object.keys(window.siyuan.config.keymap[key1]).forEach(item => {
                if (!Constants.SIYUAN_KEYMAP[key1][item]) {
                    match = false;
                    delete window.siyuan.config.keymap[key1][item];
                }
            });
        }
    }
    return match;
};

export const setProxy = () => {
    /// #if !BROWSER
    if ("" === window.siyuan.config.system.networkProxy.scheme) {
        console.log("network proxy [system]");
        return;
    }

    const session = getCurrentWindow().webContents.session;
    session.closeAllConnections().then(() => {
        const proxyURL = `${window.siyuan.config.system.networkProxy.scheme}://${window.siyuan.config.system.networkProxy.host}:${window.siyuan.config.system.networkProxy.port}`;
        session.setProxy({proxyRules: proxyURL}).then(
            () => console.log("network proxy [" + proxyURL + "]"),
        );
    });
    /// #endif
};

export const onGetConfig = (isStart: boolean) => {
    const matchKeymap1 = matchKeymap(Constants.SIYUAN_KEYMAP.general, "general");
    const matchKeymap2 = matchKeymap(Constants.SIYUAN_KEYMAP.editor.general, "editor", "general");
    const matchKeymap3 = matchKeymap(Constants.SIYUAN_KEYMAP.editor.insert, "editor", "insert");
    const matchKeymap4 = matchKeymap(Constants.SIYUAN_KEYMAP.editor.heading, "editor", "heading");
    const matchKeymap5 = matchKeymap(Constants.SIYUAN_KEYMAP.editor.list, "editor", "list");
    const matchKeymap6 = matchKeymap(Constants.SIYUAN_KEYMAP.editor.table, "editor", "table");

    const hasKeymap1 = hasKeymap(Constants.SIYUAN_KEYMAP.general, "general");
    const hasKeymap2 = hasKeymap(Constants.SIYUAN_KEYMAP.editor.general, "editor", "general");
    const hasKeymap3 = hasKeymap(Constants.SIYUAN_KEYMAP.editor.insert, "editor", "insert");
    const hasKeymap4 = hasKeymap(Constants.SIYUAN_KEYMAP.editor.heading, "editor", "heading");
    const hasKeymap5 = hasKeymap(Constants.SIYUAN_KEYMAP.editor.list, "editor", "list");
    const hasKeymap6 = hasKeymap(Constants.SIYUAN_KEYMAP.editor.table, "editor", "table");
    if (!window.siyuan.config.readonly && (!matchKeymap1 || !matchKeymap2 || !matchKeymap3 || !matchKeymap4 || !matchKeymap5 || !matchKeymap6) &&
        (!hasKeymap1 || !hasKeymap2 || !hasKeymap3 || !hasKeymap4 || !hasKeymap5 || !hasKeymap6)) {
        fetchPost("/api/setting/setKeymap", {
            data: window.siyuan.config.keymap
        }, () => {
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_HOTKEY, {
                languages: window.siyuan.languages["_trayMenu"],
                id: getCurrentWindow().id,
                hotkey: hotKey2Electron(window.siyuan.config.keymap.general.toggleWin.custom)
            });
            /// #endif
        });
    }
    /// #if !BROWSER
    ipcRenderer.send(Constants.SIYUAN_INIT, {
        languages: window.siyuan.languages["_trayMenu"],
        workspaceDir: window.siyuan.config.system.workspaceDir,
        id: getCurrentWindow().id,
    });
    ipcRenderer.send(Constants.SIYUAN_HOTKEY, {
        languages: window.siyuan.languages["_trayMenu"],
        id: getCurrentWindow().id,
        hotkey: hotKey2Electron(window.siyuan.config.keymap.general.toggleWin.custom)
    });
    /// #endif
    if (!window.siyuan.config.uiLayout || (window.siyuan.config.uiLayout && !window.siyuan.config.uiLayout.left)) {
        window.siyuan.config.uiLayout = Constants.SIYUAN_EMPTY_LAYOUT;
    }
    globalShortcut();
    fetchPost("/api/system/getEmojiConf", {}, response => {
        window.siyuan.emojis = response.data as IEmoji[];
        try {
            JSONToLayout(isStart);
        } catch (e) {
            resetLayout();
        }
    });
    initBar();
    initStatus();
    initWindow();
    appearance.onSetappearance(window.siyuan.config.appearance, false);
    initAssets();
    renderSnippet();
    setInlineStyle();
    let resizeTimeout = 0;
    window.addEventListener("resize", () => {
        window.clearTimeout(resizeTimeout);
        resizeTimeout = window.setTimeout(() => {
            resizeTabs();
            resizeDrag();
        }, 200);
    });
    if (window.siyuan.config.newbie) {
        mountHelp();
    }
    addGA();
};

const initBar = () => {
    document.querySelector(".toolbar").innerHTML = `<div id="toolbarVIP" class="fn__flex"></div>
<div id="barSync" class="toolbar__item b3-tooltips b3-tooltips__se" aria-label="${window.siyuan.config.sync.stat || (window.siyuan.languages.syncNow + " " + updateHotkeyTip(window.siyuan.config.keymap.general.syncNow.custom))}">
    <svg><use xlink:href="#iconCloud"></use></svg>
</div>
<div id="barHistory" class="toolbar__item b3-tooltips b3-tooltips__se" aria-label="${window.siyuan.languages.dataHistory} ${updateHotkeyTip(window.siyuan.config.keymap.general.dataHistory.custom)}">
    <svg><use xlink:href="#iconHistory"></use></svg>
</div>
<div id="barDailyNote" data-menu="true" aria-label="${window.siyuan.languages.dailyNote} ${updateHotkeyTip(window.siyuan.config.keymap.general.dailyNote.custom)}" class="toolbar__item b3-tooltips b3-tooltips__se${window.siyuan.config.readonly ? " fn__none" : ""}">
    <svg><use xlink:href="#iconCalendar"></use></svg>
</div>
<div id="barRiffCard" data-menu="true" aria-label="${window.siyuan.languages.riffCard} ${updateHotkeyTip(window.siyuan.config.keymap.general.riffCard.custom)}" class="toolbar__item b3-tooltips b3-tooltips__se${window.siyuan.config.readonly ? " fn__none" : ""}">
    <svg><use xlink:href="#iconRiffCard"></use></svg>
</div>
<button id="barBack" data-menu="true" class="toolbar__item toolbar__item--disabled b3-tooltips b3-tooltips__se" aria-label="${window.siyuan.languages.goBack} ${updateHotkeyTip(window.siyuan.config.keymap.general.goBack.custom)}">
    <svg><use xlink:href="#iconBack"></use></svg>
</button>
<button id="barForward" data-menu="true" class="toolbar__item toolbar__item--disabled b3-tooltips b3-tooltips__se" aria-label="${window.siyuan.languages.goForward} ${updateHotkeyTip(window.siyuan.config.keymap.general.goForward.custom)}">
    <svg><use xlink:href="#iconForward"></use></svg>
</button>
<div class="fn__flex-1 fn__ellipsis" id="drag"><span class="fn__none">开发版，使用前请进行备份 Development version, please backup before use</span></div>
<div id="barSearch" class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.globalSearch} ${updateHotkeyTip(window.siyuan.config.keymap.general.globalSearch.custom)}">
    <svg><use xlink:href="#iconSearch"></use></svg>
</div>
<div id="barReadonly" class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.use} ${window.siyuan.config.editor.readOnly ? window.siyuan.languages.editMode : window.siyuan.languages.editReadonly} ${updateHotkeyTip(window.siyuan.config.keymap.general.editMode.custom)}">
    <svg><use xlink:href="#icon${window.siyuan.config.editor.readOnly ? "Preview" : "Edit"}"></use></svg>
</div>
<div id="barMode" class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.appearanceMode}">
    <svg><use xlink:href="#icon${window.siyuan.config.appearance.modeOS ? "Mode" : (window.siyuan.config.appearance.mode === 0 ? "Light" : "Dark")}"></use></svg>
</div>
<div id="barSetting" class="toolbar__item b3-tooltips b3-tooltips__sw${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.config} ${updateHotkeyTip(window.siyuan.config.keymap.general.config.custom)}">
    <svg><use xlink:href="#iconSettings"></use></svg>
</div>
<div id="barTopHelp" class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.openBy} ${window.siyuan.languages.help}">
    <svg><use xlink:href="#iconHelp"></use></svg>
</div>
<div class="fn__flex" id="windowControls"></div>`;
    document.querySelector(".toolbar").addEventListener("click", (event: MouseEvent) => {
        let target = event.target as HTMLElement;
        while (!target.classList.contains("toolbar")) {
            if (target.id === "barBack") {
                goBack();
                event.stopPropagation();
                break;
            } else if (target.id === "barForward") {
                goForward();
                event.stopPropagation();
                break;
            } else if (target.id === "barSync") {
                syncGuide(target);
                event.stopPropagation();
                break;
            } else if (target.id === "barReadonly") {
                editor.setMode();
                event.stopPropagation();
                break;
            } else if (target.id === "barMode") {
                window.siyuan.menus.menu.remove();
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.themeLight,
                    icon: "iconLight",
                    current: window.siyuan.config.appearance.mode === 0 && !window.siyuan.config.appearance.modeOS,
                    click: () => {
                        setMode(0);
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.themeDark,
                    current: window.siyuan.config.appearance.mode === 1 && !window.siyuan.config.appearance.modeOS,
                    icon: "iconDark",
                    click: () => {
                        setMode(1);
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.themeOS,
                    current: window.siyuan.config.appearance.modeOS,
                    icon: "iconMode",
                    click: () => {
                        setMode(2);
                    }
                }).element);
                window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY + 18});
                event.stopPropagation();
                break;
            } else if (target.id === "barHistory") {
                openHistory();
                event.stopPropagation();
                break;
            } else if (target.id === "barSetting") {
                openSetting();
                event.stopPropagation();
                break;
            } else if (target.id === "barTopHelp") {
                mountHelp();
                event.stopPropagation();
                break;
            } else if (target.id === "toolbarVIP") {
                const dialogSetting = openSetting();
                dialogSetting.element.querySelector('.b3-tab-bar [data-name="account"]').dispatchEvent(new CustomEvent("click"));
                event.stopPropagation();
                break;
            } else if (target.id === "barSearch") {
                openSearch(window.siyuan.config.keymap.general.globalSearch.custom);
                event.stopPropagation();
                break;
            } else if (target.id === "barRiffCard") {
                openCard();
                event.stopPropagation();
                break;
            } else if (target.id === "barDailyNote") {
                if (getOpenNotebookCount() < 2) {
                    newDailyNote();
                } else {
                    window.siyuan.menus.menu.remove();
                    window.siyuan.notebooks.forEach(item => {
                        if (!item.closed) {
                            window.siyuan.menus.menu.append(new MenuItem({
                                label: item.name,
                                click: () => {
                                    fetchPost("/api/filetree/createDailyNote", {
                                        notebook: item.id,
                                        app: Constants.SIYUAN_APPID,
                                    });
                                    window.siyuan.storage[Constants.LOCAL_DAILYNOTEID] = item.id;
                                    setStorageVal(Constants.LOCAL_DAILYNOTEID, window.siyuan.storage[Constants.LOCAL_DAILYNOTEID]);
                                }
                            }).element);
                        }
                    });
                    window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY + 18});
                }
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
    setProxy();
};

const winOnFocus = () => {
    if (getSelection().rangeCount > 0) {
        const range = getSelection().getRangeAt(0);
        const startNode = range.startContainer.childNodes[range.startOffset] as HTMLElement;
        if (startNode && startNode.nodeType !== 3 && (startNode.tagName === "TEXTAREA" || startNode.tagName === "INPUT")) {
            startNode.focus();
        } else {
            focusByRange(getSelection().getRangeAt(0));
        }
    }
    exportLayout(false);
    window.siyuan.altIsPressed = false;
    window.siyuan.ctrlIsPressed = false;
    window.siyuan.shiftIsPressed = false;
    document.body.classList.remove("body--blur");
};

const winOnClose = (currentWindow: Electron.BrowserWindow, close = false) => {
    /// #if !BROWSER
    exportLayout(false, () => {
        if (window.siyuan.config.appearance.closeButtonBehavior === 1 && !close) {
            // 最小化
            if ("windows" === window.siyuan.config.system.os) {
                ipcRenderer.send(Constants.SIYUAN_CONFIG_TRAY, getCurrentWindow().id);
            } else {
                if (currentWindow.isFullScreen()) {
                    currentWindow.once("leave-full-screen", () => currentWindow.hide());
                    currentWindow.setFullScreen(false);
                } else {
                    currentWindow.hide();
                }
            }
        } else {
            exitSiYuan();
        }
    });
    /// #endif
};

const initWindow = () => {
    /// #if !BROWSER
    const currentWindow = getCurrentWindow();
    currentWindow.on("focus", winOnFocus);
    currentWindow.on("blur", () => {
        document.body.classList.add("body--blur");
    });
    ipcRenderer.on(Constants.SIYUAN_OPENURL, (event, url) => {
        if (!/^siyuan:\/\/blocks\/\d{14}-\w{7}/.test(url)) {
            return;
        }
        const id = url.substr(16, 22);
        fetchPost("/api/block/checkBlockExist", {id}, existResponse => {
            if (existResponse.data) {
                openFileById({
                    id,
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                    zoomIn: getSearch("focus", url) === "1"
                });
                ipcRenderer.send(Constants.SIYUAN_SHOW, getCurrentWindow().id);
            }
        });
    });
    ipcRenderer.on(Constants.SIYUAN_SAVE_CLOSE, (event, close) => {
        winOnClose(currentWindow, close);
    });
    ipcRenderer.on(Constants.SIYUAN_EXPORT_CLOSE, () => {
        destroyPrintWindow();
    });
    ipcRenderer.on(Constants.SIYUAN_EXPORT_PDF, (e, ipcData) => {
        dialog.showOpenDialog({
            title: window.siyuan.languages.export + " PDF",
            properties: ["createDirectory", "openDirectory"],
        }).then((result: OpenDialogReturnValue) => {
            if (result.canceled) {
                destroyPrintWindow();
                return;
            }
            const msgId = showMessage(window.siyuan.languages.exporting, -1);
            window.siyuan.storage[Constants.LOCAL_EXPORTPDF] = {
                removeAssets: ipcData.removeAssets,
                keepFold: ipcData.keepFold,
                mergeSubdocs: ipcData.mergeSubdocs,
                landscape: ipcData.pdfOptions.landscape,
                marginType: ipcData.pdfOptions.marginType,
                pageSize: ipcData.pdfOptions.pageSize,
                scale: ipcData.pdfOptions.scale,
            };
            setStorageVal(Constants.LOCAL_EXPORTPDF, window.siyuan.storage[Constants.LOCAL_EXPORTPDF]);
            try {
                if (window.siyuan.config.export.addFooter) {
                    ipcData.pdfOptions.displayHeaderFooter = true;
                    ipcData.pdfOptions.headerTemplate = "<span></span>";
                    ipcData.pdfOptions.footerTemplate = `<div style="width:100%;margin:0 ${ipcData.left};display: flex;line-height:12px;">
    <div style="flex: 1"></div>
    <svg viewBox="0 0 32 32" style="height: 10px;width: 10px;">
      <path fill="#d23e31" d="M8.667 2.812c-0.221 0.219-0.396 0.417-0.39 0.438s-0.004 0.030-0.022 0.020c-0.047-0.029-0.397 0.337-0.362 0.376 0.016 0.018 0.011 0.022-0.013 0.008-0.045-0.025-0.244 0.173-0.244 0.243 0 0.023-0.013 0.033-0.029 0.023-0.037-0.023-0.127 0.074-0.096 0.104 0.013 0.013 0.002 0.023-0.023 0.023-0.060 0-0.234 0.174-0.234 0.234 0 0.025-0.010 0.036-0.023 0.024-0.024-0.024-0.336 0.264-0.753 0.692-0.7 0.72-1.286 1.291-1.304 1.274-0.012-0.012-0.021 0.009-0.021 0.046s-0.017 0.055-0.038 0.042c-0.035-0.021-0.055 0.029-0.042 0.105 0.002 0.016-0.017 0.024-0.043 0.019s-0.043 0.013-0.037 0.041c0.006 0.028-0.006 0.041-0.025 0.029s-0.128 0.075-0.24 0.193c-0.316 0.333-0.72 0.734-1.024 1.017-0.152 0.142-0.265 0.258-0.251 0.258s-0.030 0.047-0.1 0.105c-0.249 0.205-0.689 0.678-0.729 0.783-0.014 0.037-0.052 0.067-0.084 0.067s-0.059 0.027-0.059 0.059-0.014 0.051-0.030 0.041c-0.039-0.024-0.738 0.647-0.706 0.678 0.013 0.013 0.002 0.024-0.024 0.024s-0.134 0.090-0.239 0.2c-0.502 0.524-0.802 0.831-0.814 0.831-0.007 0-0.16 0.147-0.341 0.326l-0.328 0.326-0 9.032c-0 6.176 0.012 9.055 0.039 9.106 0.058 0.108 0.118 0.089 0.247-0.076 0.063-0.081 0.128-0.139 0.143-0.129s0.029-0.013 0.029-0.049 0.009-0.057 0.021-0.045c0.020 0.020 2.899-2.819 4.934-4.866 0.173-0.174 0.796-0.796 1.384-1.381s1.058-1.082 1.044-1.104c-0.013-0.022-0.008-0.029 0.012-0.017 0.052 0.032 0.25-0.159 0.218-0.21-0.015-0.024-0.008-0.031 0.016-0.016 0.043 0.027 0.199-0.114 0.199-0.181 0-0.020 0.009-0.028 0.021-0.017 0.071 0.072 0.863-0.833 0.842-0.963-0.012-0.074-0.022-4.185-0.022-9.136s-0.013-9.001-0.029-8.999-0.209 0.183-0.429 0.402zM22.214 2.895c-0.268 0.268-0.487 0.51-0.487 0.54s-0.011 0.042-0.023 0.029c-0.018-0.019-1.229 1.165-2.765 2.703-0.084 0.084-0.771 0.774-1.527 1.532l-1.374 1.379v9.15c0 5.033 0.009 9.15 0.021 9.15 0.042 0 0.203-0.183 0.181-0.206-0.013-0.013 0.001-0.023 0.031-0.024s0.166-0.124 0.302-0.275c0.136-0.15 0.358-0.377 0.492-0.505s0.487-0.478 0.783-0.78c0.296-0.302 0.647-0.654 0.78-0.783 0.679-0.66 1.153-1.132 1.139-1.132-0.009 0 0.141-0.16 0.333-0.356s0.362-0.35 0.378-0.341 0.029-0.015 0.029-0.051 0.011-0.055 0.023-0.042c0.029 0.029 0.129-0.067 0.129-0.125 0-0.023 0.013-0.036 0.029-0.027 0.027 0.016 0.23-0.17 0.21-0.192-0.005-0.006 0.003-0.014 0.019-0.018 0.053-0.014 0.116-0.088 0.099-0.117-0.010-0.016 0.011-0.029 0.045-0.029s0.051-0.017 0.038-0.038c-0.013-0.021-0.008-0.038 0.011-0.038s0.407-0.369 0.862-0.819l0.827-0.819v-9.068c0-4.988-0.011-9.095-0.023-9.128-0.036-0.094-0.041-0.089-0.559 0.428z"></path>
      <path fill="#3b3e43" d="M9.126 2.368c0 0.021 0.026 0.038 0.057 0.038s0.057-0.017 0.057-0.038c0-0.021-0.026-0.038-0.057-0.038s-0.057 0.017-0.057 0.038zM9.228 2.431c-0.014 0.014-0.025 4.134-0.024 9.156l0.002 9.13 1.626 1.604c1.36 1.341 3.41 3.366 4.223 4.17 0.11 0.109 0.347 0.353 0.525 0.542s0.346 0.345 0.372 0.346c0.038 0.002 0.048-1.851 0.048-9.145v-9.147l-0.176-0.161c-0.097-0.088-0.282-0.269-0.411-0.4-0.204-0.207-0.758-0.763-1.557-1.561-0.123-0.123-0.465-0.47-0.759-0.769s-0.534-0.535-0.534-0.523-0.116-0.1-0.258-0.249c-0.142-0.149-0.524-0.536-0.85-0.86-0.654-0.651-0.8-0.798-1.597-1.604-0.537-0.543-0.58-0.579-0.631-0.528zM22.859 2.491c-0.013 0.047-0.023 4.164-0.023 9.149l-0 9.063 4.487 4.484c3.557 3.554 4.507 4.484 4.583 4.484h0.095v-18.218l-4.525-4.524c-2.489-2.488-4.54-4.524-4.559-4.524s-0.044 0.039-0.057 0.086z"></path>
      <path d="M22.796 2.396c-0.017 3.266-0.010 18.289 0.009 18.269 0.037-0.037 0.057-18.298 0.019-18.298-0.016 0-0.029 0.013-0.029 0.029zM9.129 11.447c0.002 4.972 0.017 9.084 0.034 9.136s0.036-4.016 0.044-9.041c0.011-7.29 0.004-9.136-0.034-9.136s-0.047 1.831-0.044 9.041zM16.018 18.234c0 5.041 0.005 7.097 0.010 4.57s0.006-6.651 0-9.165c-0.006-2.513-0.010-0.446-0.010 4.595zM21.65 21.795l-0.247 0.258 0.258-0.247c0.24-0.229 0.275-0.269 0.247-0.269-0.006 0-0.122 0.116-0.258 0.258z"></path>
      <path d="M4.113 7.332c-0.036 0.042-0.052 0.076-0.036 0.076s0.059-0.035 0.095-0.076c0.036-0.042 0.052-0.076 0.036-0.076s-0.059 0.035-0.095 0.076zM2.578 8.857c-0.014 0.023-0.012 0.041 0.006 0.041s0.005 0.017-0.026 0.038c-0.040 0.026-0.042 0.037-0.008 0.038 0.027 0 0.059-0.026 0.071-0.059 0.027-0.071-0.006-0.116-0.042-0.058zM20.098 23.32c-0.193 0.196-0.338 0.362-0.325 0.37s0.183-0.147 0.377-0.342c0.194-0.195 0.34-0.362 0.325-0.37s-0.185 0.146-0.377 0.342zM3.796 26.053l-0.112 0.124 0.124-0.112c0.068-0.062 0.124-0.117 0.124-0.124 0-0.029-0.031-0.004-0.136 0.112zM0.247 29.557c-0.038 0.042-0.060 0.076-0.050 0.076s0.059-0.035 0.107-0.076 0.071-0.076 0.050-0.076c-0.021 0-0.069 0.035-0.107 0.076z"></path>
    </svg>
    <a style="text-decoration:none;color:#4285f4;font-size: 8px;margin-left: 4px" href="https://b3log.org/siyuan">${window.siyuan.languages.exportBySiYuan}</a>
</div>`;
                }
                window.siyuan.printWin.webContents.printToPDF(ipcData.pdfOptions).then((pdfData) => {
                    fetchPost("/api/export/exportHTML", {
                        id: ipcData.rootId,
                        pdf: true,
                        removeAssets: ipcData.removeAssets,
                        merge: ipcData.mergeSubdocs,
                        savePath: result.filePaths[0]
                    }, () => {
                        const pdfFilePath = path.join(result.filePaths[0], replaceLocalPath(ipcData.rootTitle) + ".pdf");
                        fs.writeFileSync(pdfFilePath, pdfData);
                        destroyPrintWindow();
                        fetchPost("/api/export/addPDFOutline", {
                            id: ipcData.rootId,
                            merge: ipcData.mergeSubdocs,
                            path: pdfFilePath
                        }, () => {
                            afterExport(pdfFilePath, msgId);
                            if (ipcData.removeAssets) {
                                const removePromise = (dir: string) => {
                                    return new Promise(function (resolve) {
                                        //先读文件夹
                                        fs.stat(dir, function (err, stat) {
                                            if (stat) {
                                                if (stat.isDirectory()) {
                                                    fs.readdir(dir, function (err, files) {
                                                        files = files.map(file => path.join(dir, file)); // a/b  a/m
                                                        Promise.all(files.map(file => removePromise(file))).then(function () {
                                                            fs.rmdir(dir, resolve);
                                                        });
                                                    });
                                                } else {
                                                    fs.unlink(dir, resolve);
                                                }
                                            }
                                        });
                                    });
                                };
                                removePromise(path.join(result.filePaths[0], "assets"));
                            }
                        });
                    });
                }).catch((error: string) => {
                    showMessage("Export PDF error:" + error, 0, "error", msgId);
                    destroyPrintWindow();
                });
            } catch (e) {
                showMessage("Export PDF failed: " + e, 0, "error", msgId);
                destroyPrintWindow();
            }
            window.siyuan.printWin.hide();
        });
    });
    window.addEventListener("beforeunload", () => {
        currentWindow.off("focus", winOnFocus);
    }, false);
    if ("windows" !== window.siyuan.config.system.os && "linux" !== window.siyuan.config.system.os) {
        document.getElementById("drag").addEventListener("dblclick", () => {
            if (currentWindow.isMaximized()) {
                currentWindow.unmaximize();
            } else {
                currentWindow.maximize();
            }
        });
        const toolbarElement = document.getElementById("toolbar");
        currentWindow.on("enter-full-screen", () => {
            toolbarElement.style.paddingLeft = "0";
        });
        currentWindow.on("leave-full-screen", () => {
            toolbarElement.setAttribute("style", "");
        });

        if (currentWindow.isFullScreen()) {
            toolbarElement.style.paddingLeft = "0";
        }
        return;
    }
    const controlsElement = document.querySelector("#windowControls");
    document.body.classList.add("body--win32");
    controlsElement.innerHTML = `<div class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min}" id="minWindow">
    <svg>
        <use xlink:href="#iconMin"></use>
    </svg>
</div>
<div aria-label="${window.siyuan.languages.max}" class="b3-tooltips b3-tooltips__sw toolbar__item" id="maxWindow">
    <svg>
        <use xlink:href="#iconMax"></use>
    </svg>
</div>
<div aria-label="${window.siyuan.languages.restore}" class="b3-tooltips b3-tooltips__sw toolbar__item" id="restoreWindow">
    <svg>
        <use xlink:href="#iconRestore"></use>
    </svg>
</div>
<div aria-label="${window.siyuan.languages.close}" class="b3-tooltips b3-tooltips__sw toolbar__item toolbar__item--close" id="closeWindow">
    <svg>
        <use xlink:href="#iconClose"></use>
    </svg>
</div>`;
    const maxBtnElement = document.getElementById("maxWindow");
    const restoreBtnElement = document.getElementById("restoreWindow");

    restoreBtnElement.addEventListener("click", () => {
        if (currentWindow.isFullScreen()) {
            currentWindow.setFullScreen(false);
        } else {
            currentWindow.unmaximize();
        }
    });
    maxBtnElement.addEventListener("click", () => {
        currentWindow.maximize();
    });

    const toggleMaxRestoreButtons = () => {
        if (currentWindow.isMaximized() || currentWindow.isFullScreen()) {
            restoreBtnElement.style.display = "flex";
            maxBtnElement.style.display = "none";
        } else {
            restoreBtnElement.style.display = "none";
            maxBtnElement.style.display = "flex";
        }
    };
    toggleMaxRestoreButtons();
    currentWindow.on("maximize", toggleMaxRestoreButtons);
    currentWindow.on("unmaximize", toggleMaxRestoreButtons);
    currentWindow.on("enter-full-screen", () => {
        restoreBtnElement.style.display = "flex";
        maxBtnElement.style.display = "none";
    });
    currentWindow.on("leave-full-screen", toggleMaxRestoreButtons);
    const minBtnElement = document.getElementById("minWindow");
    const closeBtnElement = document.getElementById("closeWindow");
    minBtnElement.addEventListener("click", () => {
        if (minBtnElement.classList.contains("window-controls__item--disabled")) {
            return;
        }
        currentWindow.minimize();
    });
    closeBtnElement.addEventListener("click", () => {
        winOnClose(currentWindow);
    });
    /// #else
    document.querySelector(".toolbar").classList.add("toolbar--browser");
    window.addEventListener("beforeunload", () => {
        exportLayout(false);
    }, false);
    window.addEventListener("pagehide", () => {
        exportLayout(false);
    }, false);
    /// #endif
};
