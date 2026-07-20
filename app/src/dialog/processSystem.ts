import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
/// #if !MOBILE
import {exportLayout} from "../layout/util";
import {getDockByType} from "../layout/tabUtil";
import {Files} from "../layout/dock/Files";
/// #endif
import {getAllEditor} from "../layout/getAll";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {hideMessage, showMessage} from "./message";
import {Dialog} from "./index";
import {isMobile} from "../util/functions";
import {confirmDialog} from "./confirmDialog";
import {escapeHtml} from "../util/escape";
import {needSubscribe} from "../util/needSubscribe";
import {hideAllElements} from "../protyle/ui/hideElements";
import {App} from "../index";
import {saveScroll} from "../protyle/scroll/saveScroll";
import {isInAndroid, isInHarmony, isInIOS, setStorageVal} from "../protyle/util/compatibility";
import {Plugin} from "../plugin";

export const setRefDynamicText = (data: {
    "blockID": string,
    "defBlockID": string,
    "refText": string,
    "rootID": string
}) => {
    getAllEditor().forEach(editor => {
        // 不能对比 rootId，否则嵌入块中的锚文本无法更新
        editor.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${data.blockID}"] span[data-type~="block-ref"][data-subtype="d"][data-id="${data.defBlockID}"]`).forEach(item => {
            item.innerHTML = data.refText;
        });
    });
};

export const setDefRefCount = (data: {
    "blockID": string,
    "refCount": number,
    "rootRefCount": number,
    "rootID": string
}) => {
    getAllEditor().forEach(editor => {
        if (editor.protyle.block.rootID === data.rootID && editor.protyle.title) {
            const attrElement = editor.protyle.title.element.querySelector(".protyle-attr");
            const countElement = attrElement.querySelector(".protyle-attr--refcount");
            if (countElement) {
                if (data.rootRefCount === 0) {
                    countElement.remove();
                } else {
                    countElement.textContent = data.rootRefCount.toString();
                }
            } else if (data.rootRefCount > 0) {
                attrElement.insertAdjacentHTML("beforeend", `<div class="protyle-attr--refcount popover__block">${data.rootRefCount}</div>`);
            }
        }
        if (data.rootID === data.blockID) {
            return;
        }
        // 不能对比 rootId，否则嵌入块中的锚文本无法更新
        editor.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${data.blockID}"]`).forEach(item => {
            // 不能直接查询，否则列表中会获取到第一个列表项的 attr https://github.com/siyuan-note/siyuan/issues/12738
            const countElement = item.lastElementChild?.querySelector(".protyle-attr--refcount");
            if (countElement) {
                if (data.refCount === 0) {
                    countElement.remove();
                } else {
                    countElement.textContent = data.refCount.toString();
                }
            } else if (data.refCount > 0) {
                const attrElement = item.lastElementChild;
                if (attrElement.childElementCount > 0) {
                    attrElement.lastElementChild.insertAdjacentHTML("afterend", `<div class="protyle-attr--refcount popover__block">${data.refCount}</div>`);
                } else {
                    attrElement.innerHTML = `<div class="protyle-attr--refcount popover__block">${data.refCount}</div>${Constants.ZWSP}`;
                }
            }
            if (data.refCount === 0) {
                item.removeAttribute("refcount");
            } else {
                item.setAttribute("refcount", data.refCount.toString());
            }
        });
    });

    let liElement;
    /// #if MOBILE
    liElement = window.siyuan.mobile.docks.file.element.querySelector(`li[data-node-id="${data.rootID}"]`);
    /// #else
    liElement = (getDockByType("file")?.data["file"] as Files)?.element.querySelector(`li[data-node-id="${data.rootID}"]`);
    /// #endif
    if (liElement) {
        const counterElement = liElement.querySelector(".counter");
        if (counterElement) {
            if (data.rootRefCount === 0) {
                counterElement.remove();
            } else {
                counterElement.textContent = data.rootRefCount.toString();
            }
        } else if (data.rootRefCount > 0) {
            liElement.insertAdjacentHTML("beforeend", `<span class="popover__block counter b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.ref}">${data.rootRefCount}</span>`);
        }
    }
};

export const lockScreen = async (app: App) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return;
    }
    app.plugins.forEach(item => {
        item.eventBus.emit("lock-screen");
    });
    /// #if !MOBILE
    exportLayout({
        errorExit: false,
        cb() {
            fetchPost("/api/system/logoutAuth");
        }
    });
    /// #else
    if (window.siyuan.mobile.editor) {
        await saveScroll(window.siyuan.mobile.editor.protyle);
        fetchPost("/api/system/logoutAuth");
    }
    /// #endif

};

// forceQuit 用于内核已断连、无法走 /api/system/exit 的场景：绕过内核 HTTP，直接通知宿主（Electron 主进程 /
// 移动端原生容器）退出。浏览器/Docker 等纯 Web 环境无宿主可调，只能关闭当前页。
export const forceQuit = () => {
    /// #if !BROWSER
    ipcRenderer.send(Constants.SIYUAN_QUIT, location.port);
    /// #else
    if (isInAndroid()) {
        window.JSAndroid.exit();
        return;
    }
    if (isInIOS()) {
        window.webkit.messageHandlers.exit.postMessage("");
        return;
    }
    if (isInHarmony()) {
        window.JSHarmony.exit();
        return;
    }
    window.close();
    /// #endif
};

const installNewVersion = (installPkgPath: string, setCurrentWorkspace: boolean) => {
    if (!installPkgPath) {
        showMessage(window.siyuan.languages._kernel[104], 7000, "error");
        return;
    }
    /// #if !BROWSER
    ipcRenderer.invoke(Constants.SIYUAN_INSTALL_UPDATE, {
        port: location.port,
        setCurrentWorkspace,
    }).then((accepted: boolean) => {
        if (!accepted) {
            showMessage(window.siyuan.languages._kernel[104], 7000, "error");
        }
    }).catch(() => {
        showMessage(window.siyuan.languages._kernel[104], 7000, "error");
    });
    /// #else
    fetchPost("/api/system/exit", {
        force: true,
        setCurrentWorkspace,
        execInstallPkg: 1,
    }, () => {
        if (isInAndroid()) {
            window.JSAndroid.exit();
            return;
        }
        if (isInIOS()) {
            window.webkit.messageHandlers.exit.postMessage("");
            return;
        }
        if (isInHarmony()) {
            window.JSHarmony.exit();
        }
    });
    /// #endif
};

export const exitSiYuan = async (setCurrentWorkspace = true) => {
    hideAllElements(["util"]);
    /// #if MOBILE
    if (window.siyuan.mobile.editor) {
        await saveScroll(window.siyuan.mobile.editor.protyle);
    }
    /// #endif
    fetchPost("/api/system/exit", {force: false, setCurrentWorkspace}, (response) => {
        if (response.code === 1) { // 同步执行失败
            const msgId = showMessage(response.msg, response.data.closeTimeout, "error");
            const buttonElement = document.querySelector(`#message [data-id="${msgId}"] button`);
            if (buttonElement) {
                buttonElement.addEventListener("click", () => {
                    if (response.data.installPkgPath) {
                        installNewVersion(response.data.installPkgPath, setCurrentWorkspace);
                        return;
                    }
                    fetchPost("/api/system/exit", {force: true, setCurrentWorkspace}, () => {
                        /// #if !BROWSER
                        ipcRenderer.send(Constants.SIYUAN_QUIT, location.port);
                        /// #else
                        if (isInAndroid()) {
                            window.JSAndroid.exit();
                            return;
                        }
                        if (isInIOS()) {
                            window.webkit.messageHandlers.exit.postMessage("");
                            return;
                        }
                        if (isInHarmony()) {
                            window.JSHarmony.exit();
                            return;
                        }
                        /// #endif
                    });
                });
            }
        } else if (response.code === 2) { // 提示新安装包
            hideMessage();

            /// #if !BROWSER
            if ("std" === window.siyuan.config.system.container) {
                ipcRenderer.send(Constants.SIYUAN_SHOW_WINDOW);
            }
            /// #endif

            confirmDialog(window.siyuan.languages.updateVersion, response.msg, () => {
                installNewVersion(response.data.installPkgPath, setCurrentWorkspace);
            }, () => {
                fetchPost("/api/system/exit", {
                    force: true,
                    setCurrentWorkspace,
                    execInstallPkg: 1 // 0：默认检查新版本，1：不返回安装包，2：返回安装包路径并退出
                }, () => {
                    /// #if !BROWSER
                    ipcRenderer.send(Constants.SIYUAN_QUIT, location.port);
                    /// #endif
                });
            });
        } else { // 正常退出
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_QUIT, location.port);
            /// #else
            if (isInAndroid()) {
                window.JSAndroid.exit();
                return;
            }
            if (isInIOS()) {
                window.webkit.messageHandlers.exit.postMessage("");
                return;
            }

            if (isInHarmony()) {
                window.JSHarmony.exit();
                return;
            }
            /// #endif
        }
    });
};

export const transactionError = (msg?: string) => {
    if (document.getElementById("transactionError")) {
        return;
    }
    const dialog = new Dialog({
        disableClose: true,
        title: `${window.siyuan.languages.stateExcepted} v${Constants.SIYUAN_VERSION}`,
        content: `<div class="b3-dialog__content" style="max-height: calc(100vh - 182px)" id="transactionError">
    ${window.siyuan.languages.rebuildIndexTip}
    ${msg ? `<div class="fn__hr"></div>${escapeHtml(msg.trim())}` : ""}
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--text">${window.siyuan.languages._kernel[97]}</button>
    <div class="fn__space"></div>
    <button class="b3-button">${window.siyuan.languages.rebuildDataIndex}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_STATEEXCEPTED);
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        /// #if MOBILE
        exitSiYuan();
        /// #else
        exportLayout({
            errorExit: true,
            cb: exitSiYuan
        });
        /// #endif
    });
    btnsElement[1].addEventListener("click", () => {
        refreshFileTree();
        dialog.destroy();
    });
};

export const refreshFileTree = (cb?: () => void) => {
    window.siyuan.storage[Constants.LOCAL_FILEPOSITION] = {};
    setStorageVal(Constants.LOCAL_FILEPOSITION, window.siyuan.storage[Constants.LOCAL_FILEPOSITION]);
    fetchPost("/api/system/rebuildDataIndex", {}, () => {
        if (cb) {
            cb();
        }
    });
};

let statusTimeout: number;
export const progressStatus = (data: IWebSocketData) => {
    const msgElement = document.querySelector("#status .status__msg");
    if (msgElement) {
        clearTimeout(statusTimeout);
        msgElement.innerHTML = data.msg;
        statusTimeout = window.setTimeout(() => {
            msgElement.innerHTML = "";
        }, 12000);
    }
};

export const progressLoading = (data: IWebSocketData) => {
    let progressElement = document.getElementById("progress");
    if (!progressElement) {
        document.body.insertAdjacentHTML("beforeend", `<div id="progress" style="z-index: ${++window.siyuan.zIndex}"></div>`);
        progressElement = document.getElementById("progress");
    }
    // code 0: 有进度；1: 无进度；2: 关闭
    if (data.code === 2) {
        progressElement.remove();
        return;
    }
    if (data.code === 0) {
        progressElement.innerHTML = `<div class="b3-dialog__scrim" style="opacity: 1"></div>
<div class="b3-dialog__loading">
    <div style="text-align: right">${data.data.current}/${data.data.total}</div>
    <div style="margin: 8px 0;height: 8px;border-radius: var(--b3-border-radius);overflow: hidden;background-color:#fff;"><div style="width: ${data.data.current / data.data.total * 100}%;transition: var(--b3-transition);background-color: var(--b3-theme-primary);height: 8px;"></div></div>
    <div class="ft__breakword">${escapeHtml(data.msg)}</div>
</div>`;
    } else if (data.code === 1) {
        if (progressElement.lastElementChild) {
            progressElement.lastElementChild.lastElementChild.innerHTML = escapeHtml(data.msg);
        } else {
            progressElement.innerHTML = `<div class="b3-dialog__scrim" style="opacity: 1"></div>
<div class="b3-dialog__loading">
    <div style="margin: 8px 0;height: 8px;border-radius: var(--b3-border-radius);overflow: hidden;background-color:#fff;"><div style="background-color: var(--b3-theme-primary);height: 8px;background-image: linear-gradient(-45deg, rgba(255, 255, 255, 0.2) 25%, transparent 25%, transparent 50%, rgba(255, 255, 255, 0.2) 50%, rgba(255, 255, 255, 0.2) 75%, transparent 75%, transparent);animation: stripMove 450ms linear infinite;background-size: 50px 50px;"></div></div>
    <div class="ft__breakword">${escapeHtml(data.msg)}</div>
</div>`;
        }
    }
};

export const progressBackgroundTask = (tasks: { action: string }[]) => {
    const backgroundTaskElement = document.querySelector(".status__backgroundtask");
    if (!backgroundTaskElement) {
        return;
    }
    if (tasks.length === 0) {
        backgroundTaskElement.classList.add("fn__none");
        if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
            window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_STATUS_BACKGROUND_TASK) {
            window.siyuan.menus.menu.remove();
        }
    } else {
        backgroundTaskElement.classList.remove("fn__none");
        backgroundTaskElement.setAttribute("data-tasks", JSON.stringify(tasks));
        backgroundTaskElement.innerHTML = tasks[0].action + '<div class="fn__progress"><div></div></div>';
    }
};

export const bootSync = () => {
    fetchPost("/api/sync/getBootSync", {}, response => {
        if (response.code === 1) {
            const dialog = new Dialog({
                width: isMobile() ? "92vw" : "50vw",
                title: "🌩️ " + window.siyuan.languages.bootSyncFailed,
                content: `<div class="b3-dialog__content">${response.msg}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.syncNow}</button>
</div>`
            });
            dialog.element.setAttribute("data-key", Constants.DIALOG_BOOTSYNCFAILED);
            const btnsElement = dialog.element.querySelectorAll(".b3-button");
            btnsElement[0].addEventListener("click", () => {
                dialog.destroy();
            });
            btnsElement[1].addEventListener("click", () => {
                if (btnsElement[1].getAttribute("disabled")) {
                    return;
                }
                btnsElement[1].setAttribute("disabled", "disabled");
                fetchPost("/api/sync/performBootSync", {}, (syncResponse) => {
                    if (syncResponse.code === 0) {
                        dialog.destroy();
                    }
                    btnsElement[1].removeAttribute("disabled");
                });
            });
        }
    });
};

export const downloadProgress = (data: { id: string, percent: number }) => {
    const bazaarSideElement = document.querySelector("#configBazaarReadme .item__side");
    if (!bazaarSideElement) {
        return;
    }
    if (data.id !== bazaarSideElement.getAttribute("data-repourl")) {
        return;
    }
    const installBtnElement = bazaarSideElement.querySelector('[data-type="install"]') as HTMLElement;
    const updateBtnElement = bazaarSideElement.querySelector('[data-type="install-t"]') as HTMLElement;
    if (!installBtnElement && !updateBtnElement) {
        return;
    }
    const progressHTML = `<span style="width: ${data.percent * 100}%"></span>`;
    if (data.percent >= 1) {
        installBtnElement?.parentElement.classList.add("fn__none");
        updateBtnElement?.parentElement.classList.add("fn__none");
    } else {
        if (installBtnElement) {
            installBtnElement.classList.add("b3-button--progress");
            installBtnElement.innerHTML = progressHTML;
        }
        if (updateBtnElement) {
            updateBtnElement.classList.add("b3-button--progress");
            updateBtnElement.innerHTML = progressHTML;
        }
    }
};

export const processSync = (data?: IWebSocketData, plugins?: Plugin[]) => {
    if (data?.code === 1) {
        window.dispatchEvent(new CustomEvent("siyuan-sync-success"));
    }
    /// #if MOBILE
    const menuSyncUseElement = document.querySelector("#menuSyncNow use");
    const barSyncUseElement = document.querySelector("#toolbarSync use");
    if (!data) {
        if (!window.siyuan.config.sync.enabled || (0 === window.siyuan.config.sync.provider && needSubscribe(""))) {
            menuSyncUseElement?.setAttribute("xlink:href", "#iconCloudOff");
            barSyncUseElement.setAttribute("xlink:href", "#iconCloudOff");
        } else {
            menuSyncUseElement?.setAttribute("xlink:href", "#iconCloudSucc");
            barSyncUseElement.setAttribute("xlink:href", "#iconCloudSucc");
        }
        return;
    }
    menuSyncUseElement?.parentElement.classList.remove("fn__rotate");
    barSyncUseElement.parentElement.classList.remove("fn__rotate");
    if (data.code === 0) {  // syncing
        menuSyncUseElement?.parentElement.classList.add("fn__rotate");
        barSyncUseElement.parentElement.classList.add("fn__rotate");
        menuSyncUseElement?.setAttribute("xlink:href", "#iconRefresh");
        barSyncUseElement.setAttribute("xlink:href", "#iconRefresh");
    } else if (data.code === 2) {    // error
        menuSyncUseElement?.setAttribute("xlink:href", "#iconCloudError");
        barSyncUseElement.setAttribute("xlink:href", "#iconCloudError");
    } else if (data.code === 1) {   // success
        menuSyncUseElement?.setAttribute("xlink:href", "#iconCloudSucc");
        barSyncUseElement.setAttribute("xlink:href", "#iconCloudSucc");
    }
    /// #else
    const iconElement = document.querySelector("#barSync");
    if (!iconElement) {
        return;
    }
    const useElement = iconElement.querySelector("use");
    if (!data) {
        iconElement.classList.remove("toolbar__item--active");
        if (!window.siyuan.config.sync.enabled || (0 === window.siyuan.config.sync.provider && needSubscribe(""))) {
            useElement.setAttribute("xlink:href", "#iconCloudOff");
        } else {
            useElement.setAttribute("xlink:href", "#iconCloudSucc");
        }
        return;
    }
    iconElement.firstElementChild.classList.remove("fn__rotate");
    if (data.code === 0) {  // syncing
        iconElement.classList.add("toolbar__item--active");
        iconElement.firstElementChild.classList.add("fn__rotate");
        useElement.setAttribute("xlink:href", "#iconRefresh");
    } else if (data.code === 2) {    // error
        iconElement.classList.remove("toolbar__item--active");
        useElement.setAttribute("xlink:href", "#iconCloudError");
    } else if (data.code === 1) {   // success
        iconElement.classList.remove("toolbar__item--active");
        useElement.setAttribute("xlink:href", "#iconCloudSucc");
    }
    /// #endif
    plugins.forEach((item) => {
        if (data.code === 0) {
            item.eventBus.emit("sync-start", data);
        } else if (data.code === 1) {
            item.eventBus.emit("sync-end", data);
        } else if (data.code === 2) {
            item.eventBus.emit("sync-fail", data);
        }
    });
};
