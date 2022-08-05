import {openSearch} from "../search/spread";
import {exportLayout, JSONToLayout, resizeDrag, resizeTabs} from "../layout/util";
import {hotKey2Electron, updateHotkeyTip} from "../protyle/util/compatibility";
/// #if !BROWSER
import {ipcRenderer} from "electron";
import {getCurrentWindow} from "@electron/remote";
/// #endif
import {Constants} from "../constants";
import {appearance} from "../config/appearance";
import {globalShortcut} from "./globalShortcut";
import {fetchPost} from "./fetch";
import {mountHelp, newDailyNote} from "./mount";
import {MenuItem} from "../menus/Menu";
import {initAssets, loadAssets, setInlineStyle} from "./assets";
import {showMessage} from "../dialog/message";
import {needSubscribe} from "./needSubscribe";
import {goBack, goForward} from "./backForward";
import {getOpenNotebookCount} from "./pathName";
import {openFileById} from "../editor/util";
import {focusByRange} from "../protyle/util/selection";
import {exitSiYuan} from "../dialog/processSystem";
import {openSetting} from "../config";
import {getSearch} from "./functions";
import {openHistory} from "./history";
import {initStatus} from "../layout/status";

const matchKeymap = (keymap: Record<string, IKeymapItem>, key1: "general" | "editor", key2?: "general" | "insert" | "heading" | "list" | "table") => {
    if (key1 === "general") {
        if (!window.siyuan.config.keymap[key1]) {
            window.siyuan.config.keymap[key1] = keymap;
            return false;
        }
    } else {
        if (!window.siyuan.config.keymap[key1]) {
            window.siyuan.config.keymap[key1] = Constants.SIYUAN_KEYMAP.editor;
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
    const session = getCurrentWindow().webContents.session;
    if (window.siyuan.config.system.networkProxy.scheme) {
        session.closeAllConnections().then(() => {
            session.setProxy({proxyRules: `${window.siyuan.config.system.networkProxy.scheme}://${window.siyuan.config.system.networkProxy.host}:${window.siyuan.config.system.networkProxy.port}`}).then();
        });
    }
    /// #endif
};

export const onGetConfig = (isStart:boolean) => {
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
            ipcRenderer.send(Constants.SIYUAN_HOTKEY, hotKey2Electron(window.siyuan.config.keymap.general.toggleWin.custom));
            /// #endif
        });
    }
    /// #if !BROWSER
    ipcRenderer.send(Constants.SIYUAN_CONFIG_CLOSE, window.siyuan.config.appearance.closeButtonBehavior);
    ipcRenderer.send(Constants.SIYUAN_INIT);
    ipcRenderer.send(Constants.SIYUAN_HOTKEY, hotKey2Electron(window.siyuan.config.keymap.general.toggleWin.custom));
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
            fetchPost("/api/system/setUILayout", {layout: {}}, () => {
                window.location.reload();
            });
        }
    });
    initBar();
    initStatus();
    initWindow();
    appearance.onSetappearance(window.siyuan.config.appearance);
    initAssets();
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
};

const initBar = () => {
    document.querySelector(".toolbar").innerHTML = `<div id="toolbarVIP" class="fn__flex"></div>
<div id="barDailyNote" data-menu="true" aria-label="${window.siyuan.languages.dailyNote} ${updateHotkeyTip(window.siyuan.config.keymap.general.dailyNote.custom)}" class="toolbar__item b3-tooltips b3-tooltips__se${window.siyuan.config.readonly ? " fn__none" : ""}">
    <svg>
        <use xlink:href="#iconCalendar"></use>
    </svg>
</div>
<div id="barSearch" class="toolbar__item b3-tooltips b3-tooltips__se" aria-label="${window.siyuan.languages.globalSearch} ${updateHotkeyTip(window.siyuan.config.keymap.general.globalSearch.custom)}">
    <svg>
        <use xlink:href="#iconSearch"></use>
    </svg>
</div>
<div id="barThemeMode" class="toolbar__item b3-tooltips b3-tooltips__se${window.siyuan.config.appearance.mode === 1 ? " toolbar__item--active" : ""}" aria-label="${window.siyuan.config.appearance.mode === 1 ? window.siyuan.languages.themeLight : window.siyuan.languages.themeDark}">
    <svg>
        <use xlink:href="#iconMoon"></use>
    </svg>
</div>
<div id="barHistory" class="toolbar__item b3-tooltips b3-tooltips__se" aria-label="${window.siyuan.languages.dataHistory} ${updateHotkeyTip(window.siyuan.config.keymap.general.history.custom)}">
    <svg>
        <use xlink:href="#iconVideo"></use>
    </svg>
</div>
<div id="barSetting" class="toolbar__item b3-tooltips b3-tooltips__se${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.config} ${updateHotkeyTip(window.siyuan.config.keymap.general.config.custom)}">
    <svg>
        <use xlink:href="#iconSettings"></use>
    </svg>
</div>
<div id="barSync" class="toolbar__item b3-tooltips b3-tooltips__se" aria-label="${window.siyuan.config.sync.stat || (window.siyuan.languages.syncNow + " " + updateHotkeyTip(window.siyuan.config.keymap.general.syncNow.custom))}">
    <svg><use xlink:href="#iconRefresh"></use></svg>
</div>
<button id="barBack" data-menu="true" class="toolbar__item toolbar__item--disabled b3-tooltips b3-tooltips__se" aria-label="${window.siyuan.languages.goBack} ${updateHotkeyTip(window.siyuan.config.keymap.general.goBack.custom)}">
    <svg>
        <use xlink:href="#iconLeft"></use>
    </svg>
</button>
<button id="barForward" data-menu="true" class="toolbar__item toolbar__item--disabled b3-tooltips b3-tooltips__se" aria-label="${window.siyuan.languages.goForward} ${updateHotkeyTip(window.siyuan.config.keymap.general.goForward.custom)}">
    <svg>
        <use xlink:href="#iconRight"></use>
    </svg>
</button>
<div class="fn__flex-1 fn__ellipsis" id="drag"><span class="fn__none">开发版，使用前请进行备份 Development version, please backup before use</span></div>
<div class="fn__flex" style="top: -1px;z-index: 502;right: -1px;position: relative;" id="windowControls"></div>`;
    document.querySelector(".toolbar").addEventListener("click", (event: MouseEvent) => {
        let target = event.target as HTMLElement;
        while (!target.classList.contains("toolbar")) {
            if (target.id === "barBack") {
                goBack();
                event.stopPropagation();
                break;
            } else if (target.id === "barSync") {
                if (needSubscribe() || target.firstElementChild.classList.contains("fn__rotate")) {
                    return;
                }
                if (!window.siyuan.config.sync.enabled) {
                    showMessage(window.siyuan.languages._kernel[124]);
                    return;
                }
                fetchPost("/api/sync/performSync", {});
                event.stopPropagation();
                break;
            } else if (target.id === "barForward") {
                goForward();
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
            } else if (target.id === "toolbarVIP") {
                const dialogSetting = openSetting();
                dialogSetting.element.querySelector('.b3-tab-bar [data-name="account"]').dispatchEvent(new CustomEvent("click"));
                event.stopPropagation();
                break;
            } else if (target.id === "barSearch") {
                openSearch(window.siyuan.config.keymap.general.globalSearch.custom);
                event.stopPropagation();
                break;
            } else if (target.id === "barThemeMode") {
                if (target.getAttribute("disabled")) {
                    return;
                }
                if (target.classList.contains("toolbar__item--active")) {
                    target.classList.remove("toolbar__item--active");
                    target.setAttribute("aria-label", window.siyuan.languages.themeDark);
                } else {
                    target.classList.add("toolbar__item--active");
                    target.setAttribute("aria-label", window.siyuan.languages.themeLight);
                }
                target.setAttribute("disabled", "disabled");
                fetchPost("/api/system/setAppearanceMode", {
                    mode: target.classList.contains("toolbar__item--active") ? 1 : 0
                }, response => {
                    if (window.siyuan.config.appearance.themeJS) {
                        exportLayout(true);
                        return;
                    }
                    window.siyuan.config.appearance = response.data.appearance;
                    target.removeAttribute("disabled");
                    /// #if !BROWSER
                    ipcRenderer.send(Constants.SIYUAN_CONFIG_THEME, response.data.mode === 1 ? "dark" : "light");
                    /// #endif
                    loadAssets(response.data.appearance);
                });
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
                                        notebook: item.id
                                    });
                                    window.localStorage.setItem(Constants.LOCAL_DAILYNOTEID, item.id);
                                }
                            }).element);
                        }
                    });
                    window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
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
                ipcRenderer.send(Constants.SIYUAN_CONFIG_TRAY);
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
    ipcRenderer.on(Constants.SIYUAN_OPENURL, (event, url) => {
        if (!/^siyuan:\/\/blocks\/\d{14}-\w{7}/.test(url)) {
            return;
        }
        openFileById({
            id: url.substr(16, 22),
            action: [Constants.CB_GET_FOCUS],
            zoomIn: getSearch("focus", url) === "1"
        });
    });
    ipcRenderer.on(Constants.SIYUAN_SAVE_CLOSE, (event, close) => {
        winOnClose(currentWindow, close);
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
    controlsElement.innerHTML = `<div class="toolbar__item toolbar__item--win b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min}" id="minWindow">
    <svg>
        <use xlink:href="#iconMin"></use>
    </svg>
</div>
<div aria-label="${window.siyuan.languages.max}" class="b3-tooltips b3-tooltips__sw toolbar__item toolbar__item--win" id="maxWindow">
    <svg style="height: 11px">
        <use xlink:href="#iconMax"></use>
    </svg>
</div>
<div aria-label="${window.siyuan.languages.restore}" class="b3-tooltips b3-tooltips__sw toolbar__item toolbar__item--win" id="restoreWindow">
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

    currentWindow.on("blur", () => {
        document.body.classList.add("body--blur");
    });
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
    /// #endif
};
