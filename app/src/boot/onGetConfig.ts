import {exportLayout, JSONToLayout, resetLayout, resizeDrag, resizeTabs} from "../layout/util";
import {hotKey2Electron, setStorageVal} from "../protyle/util/compatibility";
/// #if !BROWSER
import {dialog, getCurrentWindow} from "@electron/remote";
import {ipcRenderer, OpenDialogReturnValue, webFrame} from "electron";
import * as fs from "fs";
import * as path from "path";
import {afterExport} from "../protyle/export/util";
import {onWindowsMsg} from "../window/onWindowsMsg";
/// #endif
import {Constants} from "../constants";
import {appearance} from "../config/appearance";
import {globalShortcut} from "../boot/globalShortcut";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {addGA, initAssets, setInlineStyle} from "../util/assets";
import {renderSnippet} from "../config/util/snippets";
import {openFileById} from "../editor/util";
import {focusByRange} from "../protyle/util/selection";
import {exitSiYuan} from "../dialog/processSystem";
import {getSearch, isWindow, isSiyuanUrl, getIdFromSiyuanUrl} from "../util/functions";
import {initStatus} from "../layout/status";
import {showMessage} from "../dialog/message";
import {replaceLocalPath} from "../editor/rename";
import {setTabPosition} from "../window/setHeader";
import {initBar} from "../layout/topBar";
import {setProxy} from "../config/util/setProxy";
import {openChangelog} from "./openChangelog";

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
    if (!window.siyuan.config.readonly &&
        (!matchKeymap1 || !matchKeymap2 || !matchKeymap3 || !matchKeymap4 || !matchKeymap5 || !matchKeymap6 ||
            !hasKeymap1 || !hasKeymap2 || !hasKeymap3 || !hasKeymap4 || !hasKeymap5 || !hasKeymap6)) {
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
        port: location.port
    });
    ipcRenderer.send(Constants.SIYUAN_HOTKEY, {
        languages: window.siyuan.languages["_trayMenu"],
        id: getCurrentWindow().id,
        hotkey: hotKey2Electron(window.siyuan.config.keymap.general.toggleWin.custom)
    });
    webFrame.setZoomFactor(window.siyuan.storage[Constants.LOCAL_ZOOM]);
    /// #endif
    if (!window.siyuan.config.uiLayout || (window.siyuan.config.uiLayout && !window.siyuan.config.uiLayout.left)) {
        window.siyuan.config.uiLayout = Constants.SIYUAN_EMPTY_LAYOUT;
    }
    globalShortcut();
    fetchPost("/api/system/getEmojiConf", {}, response => {
        window.siyuan.emojis = response.data as IEmoji[];
        try {
            JSONToLayout(isStart);
            openChangelog();
            if (window.JSAndroid) {
                window.openFileByURL(window.JSAndroid.getBlockURL());
            }
        } catch (e) {
            resetLayout();
        }
    });
    initBar();
    setProxy();
    initStatus();
    initWindow();
    appearance.onSetappearance(window.siyuan.config.appearance);
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
    addGA();
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
                ipcRenderer.send(Constants.SIYUAN_CONFIG_TRAY, {
                    id: getCurrentWindow().id,
                    languages: window.siyuan.languages["_trayMenu"],
                });
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
    }, false, true);
    /// #endif
};

export const initWindow = () => {
    /// #if !BROWSER
    const currentWindow = getCurrentWindow();
    currentWindow.on("focus", winOnFocus);
    currentWindow.on("blur", () => {
        document.body.classList.add("body--blur");
    });
    if (!isWindow()) {
        ipcRenderer.on(Constants.SIYUAN_OPENURL, (event, url) => {
            if (!isSiyuanUrl(url)) {
                return;
            }
            const id = getIdFromSiyuanUrl(url);
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
    }
    ipcRenderer.on(Constants.SIYUAN_SEND_WINDOWS, (e, ipcData: IWebSocketData) => {
        onWindowsMsg(ipcData);
    });
    ipcRenderer.on(Constants.SIYUAN_EXPORT_CLOSE, () => {
        window.siyuan.printWin.destroy();
    });
    ipcRenderer.on(Constants.SIYUAN_EXPORT_PDF, (e, ipcData) => {
        dialog.showOpenDialog({
            title: window.siyuan.languages.export + " PDF",
            properties: ["createDirectory", "openDirectory"],
        }).then(async (result: OpenDialogReturnValue) => {
            if (result.canceled) {
                window.siyuan.printWin.destroy();
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
                marginTop: ipcData.pdfOptions.margins.top,
                marginRight: ipcData.pdfOptions.margins.right,
                marginBottom: ipcData.pdfOptions.margins.bottom,
                marginLeft: ipcData.pdfOptions.margins.left,
            };
            setStorageVal(Constants.LOCAL_EXPORTPDF, window.siyuan.storage[Constants.LOCAL_EXPORTPDF]);
            try {
                if (window.siyuan.config.export.pdfFooter.trim()) {
                    const response = await fetchSyncPost("/api/template/renderSprig", {template:window.siyuan.config.export.pdfFooter});
                    ipcData.pdfOptions.displayHeaderFooter = true;
                    ipcData.pdfOptions.headerTemplate = "<span></span>";
                    ipcData.pdfOptions.footerTemplate = `<div style="text-align:center;width:100%;font-size:8px;line-height:12px;">
${response.data.replace("%pages", "<span class=totalPages></span>").replace("%page", "<span class=pageNumber></span>")}
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
                        window.siyuan.printWin.destroy();
                        fetchPost("/api/export/processPDF", {
                            id: ipcData.rootId,
                            merge: ipcData.mergeSubdocs,
                            path: pdfFilePath,
                            removeAssets: ipcData.removeAssets,
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
                    window.siyuan.printWin.destroy();
                });
            } catch (e) {
                showMessage("Export PDF failed: " + e, 0, "error", msgId);
                window.siyuan.printWin.destroy();
            }
            window.siyuan.printWin.hide();
        });
    });
    window.addEventListener("beforeunload", () => {
        currentWindow.off("focus", winOnFocus);
    }, false);
    if (isWindow()) {
        document.body.insertAdjacentHTML("beforeend", `<div class="toolbar__window">
<div class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.pin}" id="pinWindow">
    <svg>
        <use xlink:href="#iconPin"></use>
    </svg>
</div></div>`);
        const pinElement = document.getElementById("pinWindow");
        pinElement.addEventListener("click", () => {
            pinElement.classList.toggle("toolbar__item--active");
            if (pinElement.classList.contains("toolbar__item--active")) {
                pinElement.setAttribute("aria-label", window.siyuan.languages.unpin);
                currentWindow.setAlwaysOnTop(true, "pop-up-menu");
            } else {
                pinElement.setAttribute("aria-label", window.siyuan.languages.pin);
                currentWindow.setAlwaysOnTop(false);
            }
        });
    }
    if ("darwin" === window.siyuan.config.system.os) {
        document.getElementById("drag")?.addEventListener("dblclick", () => {
            if (currentWindow.isMaximized()) {
                currentWindow.unmaximize();
            } else {
                currentWindow.maximize();
            }
        });
        const toolbarElement = document.getElementById("toolbar");
        currentWindow.on("enter-full-screen", () => {
            if (isWindow()) {
                setTabPosition();
            } else {
                toolbarElement.style.paddingLeft = "0";
            }
        });
        currentWindow.on("leave-full-screen", () => {
            if (isWindow()) {
                setTabPosition();
            } else {
                toolbarElement.setAttribute("style", "");
            }
        });

        if (currentWindow.isFullScreen() && !isWindow()) {
            toolbarElement.style.paddingLeft = "0";
        }
        return;
    }
    document.body.classList.add("body--win32");

    // 添加窗口控件
    const controlsHTML = `<div class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min}" id="minWindow">
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
    if (isWindow()) {
        document.querySelector(".toolbar__window").insertAdjacentHTML("beforeend", controlsHTML);
    } else {
        document.getElementById("windowControls").innerHTML = controlsHTML;
    }
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
        if (isWindow()) {
            currentWindow.destroy();
        } else {
            winOnClose(currentWindow);
        }
    });
    /// #else
    if (!isWindow()) {
        document.querySelector(".toolbar").classList.add("toolbar--browser");
    }
    window.addEventListener("beforeunload", () => {
        exportLayout(false);
    }, false);
    window.addEventListener("pagehide", () => {
        exportLayout(false);
    }, false);
    /// #endif
};
