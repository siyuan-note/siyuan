import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
/// #if !MOBILE
import {exportLayout} from "../layout/util";
/// #endif
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {hideMessage, showMessage} from "./message";
import {Dialog} from "./index";
import {isMobile} from "../util/functions";
import {confirmDialog} from "./confirmDialog";
import {escapeHtml} from "../util/escape";
import {getWorkspaceName} from "../util/noRelyPCFunction";
import {needSubscribe} from "../util/needSubscribe";
import {redirectToCheckAuth, setNoteBook} from "../util/pathName";
import {getAllModels} from "../layout/getAll";
import {reloadProtyle} from "../protyle/util/reload";
import {Tab} from "../layout/Tab";
import {setEmpty} from "../mobile/util/setEmpty";
import {hideAllElements, hideElements} from "../protyle/ui/hideElements";
import {App} from "../index";
import {saveScroll} from "../protyle/scroll/saveScroll";
import {isInAndroid, isInIOS, setStorageVal} from "../protyle/util/compatibility";
import {Plugin} from "../plugin";

const updateTitle = (rootID: string, tab: Tab, protyle?: IProtyle) => {
    fetchPost("/api/block/getDocInfo", {
        id: rootID
    }, (response) => {
        tab.updateTitle(response.data.name);
        if (protyle && protyle.title) {
            protyle.title.setTitle(response.data.name);
        }
    });
};

export const reloadSync = (
    app: App,
    data: { upsertRootIDs: string[], removeRootIDs: string[] },
    hideMsg = true,
    // 同步的时候需要更新只读状态 https://github.com/siyuan-note/siyuan/issues/11517
    // 调整大纲的时候需要使用现有状态 https://github.com/siyuan-note/siyuan/issues/11808
    updateReadonly = true
) => {
    if (hideMsg) {
        hideMessage();
    }
    /// #if MOBILE
    if (window.siyuan.mobile.popEditor) {
        if (data.removeRootIDs.includes(window.siyuan.mobile.popEditor.protyle.block.rootID)) {
            hideElements(["dialog"]);
        } else {
            reloadProtyle(window.siyuan.mobile.popEditor.protyle, false, updateReadonly);
        }
    }
    if (window.siyuan.mobile.editor) {
        if (data.removeRootIDs.includes(window.siyuan.mobile.editor.protyle.block.rootID)) {
            setEmpty(app);
        } else {
            reloadProtyle(window.siyuan.mobile.editor.protyle, false, updateReadonly);
            fetchPost("/api/block/getDocInfo", {
                id: window.siyuan.mobile.editor.protyle.block.rootID
            }, (response) => {
                setTitle(response.data.name);
                window.siyuan.mobile.editor.protyle.title.setTitle(response.data.name);
            });
        }
    }
    setNoteBook(() => {
        window.siyuan.mobile.files.init(false);
    });
    /// #else
    const allModels = getAllModels();
    allModels.editor.forEach(item => {
        if (data.upsertRootIDs.includes(item.editor.protyle.block.rootID)) {
            fetchPost("/api/block/getDocInfo", {
                id: item.editor.protyle.block.rootID,
            }, (response) => {
                item.editor.protyle.wysiwyg.renderCustom(response.data.ial);
                reloadProtyle(item.editor.protyle, false, updateReadonly);
                updateTitle(item.editor.protyle.block.rootID, item.parent, item.editor.protyle);
            });
        } else if (data.removeRootIDs.includes(item.editor.protyle.block.rootID)) {
            item.parent.parent.removeTab(item.parent.id, false, false);
            delete window.siyuan.storage[Constants.LOCAL_FILEPOSITION][item.editor.protyle.block.rootID];
            setStorageVal(Constants.LOCAL_FILEPOSITION, window.siyuan.storage[Constants.LOCAL_FILEPOSITION]);
        }
    });
    allModels.graph.forEach(item => {
        if (item.type === "local" && data.removeRootIDs.includes(item.rootId)) {
            item.parent.parent.removeTab(item.parent.id, false, false);
        } else if (item.type !== "local" || data.upsertRootIDs.includes(item.rootId)) {
            item.searchGraph(false);
            if (item.type === "local") {
                updateTitle(item.rootId, item.parent);
            }
        }
    });
    allModels.outline.forEach(item => {
        if (item.type === "local" && data.removeRootIDs.includes(item.blockId)) {
            item.parent.parent.removeTab(item.parent.id, false, false);
        } else if (item.type !== "local" || data.upsertRootIDs.includes(item.blockId)) {
            fetchPost("/api/outline/getDocOutline", {
                id: item.blockId,
            }, response => {
                item.update(response);
            });
            if (item.type === "local") {
                updateTitle(item.blockId, item.parent);
            }
        }
    });
    allModels.backlink.forEach(item => {
        if (item.type === "local" && data.removeRootIDs.includes(item.rootId)) {
            item.parent.parent.removeTab(item.parent.id, false, false);
        } else {
            item.refresh();
            if (item.type === "local") {
                updateTitle(item.rootId, item.parent);
            }
        }
    });
    allModels.files.forEach(item => {
        setNoteBook(() => {
            item.init(false);
        });
    });
    allModels.bookmark.forEach(item => {
        item.update();
    });
    allModels.tag.forEach(item => {
        item.update();
    });
    // NOTE asset 无法获取推送地址，先不处理
    allModels.search.forEach(item => {
        item.parent.panelElement.querySelector("#searchInput").dispatchEvent(new CustomEvent("input"));
    });
    allModels.custom.forEach(item => {
        if (item.update) {
            item.update();
        }
    });
    /// #endif
};

export const lockScreen = (app: App) => {
    if (window.siyuan.config.readonly) {
        return;
    }
    app.plugins.forEach(item => {
        item.eventBus.emit("lock-screen");
    });
    /// #if BROWSER
    fetchPost("/api/system/logoutAuth", {}, () => {
        redirectToCheckAuth();
    });
    /// #else
    ipcRenderer.send(Constants.SIYUAN_SEND_WINDOWS, {cmd: "lockscreen"});
    /// #endif
};

export const kernelError = () => {
    if (document.querySelector("#errorLog")) {
        return;
    }
    let iosReStart = "";
    if (isInIOS()) {
        iosReStart = `<div class="fn__hr"></div><div class="fn__flex"><div class="fn__flex-1"></div><button class="b3-button">${window.siyuan.languages.retry}</button></div>`;
    }
    const dialog = new Dialog({
        disableClose: true,
        title: `💔 ${window.siyuan.languages.kernelFault0} <small>v${Constants.SIYUAN_VERSION}</small>`,
        width: isMobile() ? "92vw" : "520px",
        content: `<div class="b3-dialog__content">
<div class="ft__breakword">
    <div>${window.siyuan.languages.kernelFault1}</div>
    <div class="fn__hr"></div>
    <div>${window.siyuan.languages.kernelFault2}</div>
    ${iosReStart}
</div>
</div>`
    });
    dialog.element.id = "errorLog";
    dialog.element.setAttribute("data-key", Constants.DIALOG_KERNELFAULT);
    const restartElement = dialog.element.querySelector(".b3-button");
    if (restartElement) {
        restartElement.addEventListener("click", () => {
            dialog.destroy();
            window.webkit.messageHandlers.startKernelFast.postMessage("startKernelFast");
        });
    }
};

export const exitSiYuan = () => {
    hideAllElements(["util"]);
    /// #if MOBILE
    if (window.siyuan.mobile.editor) {
        saveScroll(window.siyuan.mobile.editor.protyle);
    }
    /// #endif
    fetchPost("/api/system/exit", {force: false}, (response) => {
        if (response.code === 1) { // 同步执行失败
            const msgId = showMessage(response.msg, response.data.closeTimeout, "error");
            const buttonElement = document.querySelector(`#message [data-id="${msgId}"] button`);
            if (buttonElement) {
                buttonElement.addEventListener("click", () => {
                    fetchPost("/api/system/exit", {force: true}, () => {
                        /// #if !BROWSER
                        ipcRenderer.send(Constants.SIYUAN_QUIT, location.port);
                        /// #else
                        if (isInIOS() || isInAndroid()) {
                            window.location.href = "siyuan://api/system/exit";
                        }
                        /// #endif
                    });
                });
            }
        } else if (response.code === 2) { // 提示新安装包
            hideMessage();
            confirmDialog(window.siyuan.languages.tip, response.msg, () => {
                fetchPost("/api/system/exit", {
                    force: true,
                    execInstallPkg: 2 //  0：默认检查新版本，1：不执行新版本安装，2：执行新版本安装
                }, () => {
                    /// #if !BROWSER
                    // 桌面端退出拉起更新安装时有时需要重启两次 https://github.com/siyuan-note/siyuan/issues/6544
                    // 这里先将主界面隐藏
                    setTimeout(() => {
                        ipcRenderer.send(Constants.SIYUAN_CMD, "hide");
                    }, 2000);
                    // 然后等待一段时间后再退出，避免界面主进程退出以后内核子进程被杀死
                    setTimeout(() => {
                        ipcRenderer.send(Constants.SIYUAN_QUIT, location.port);
                    }, 4000);
                    /// #endif
                });
            }, () => {
                fetchPost("/api/system/exit", {
                    force: true,
                    execInstallPkg: 1 //  0：默认检查新版本，1：不执行新版本安装，2：执行新版本安装
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
            if (isInIOS() || isInAndroid()) {
                window.location.href = "siyuan://api/system/exit";
            }
            /// #endif
        }
    });
};

export const transactionError = () => {
    if (document.getElementById("transactionError")) {
        return;
    }
    const dialog = new Dialog({
        disableClose: true,
        title: `${window.siyuan.languages.stateExcepted} v${Constants.SIYUAN_VERSION}`,
        content: `<div class="b3-dialog__content" id="transactionError">${window.siyuan.languages.rebuildIndexTip}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--text">${window.siyuan.languages._kernel[97]}</button>
    <div class="fn__space"></div>
    <button class="b3-button">${window.siyuan.languages.rebuildIndex}</button>
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
    fetchPost("/api/filetree/refreshFiletree", {}, () => {
        if (cb) {
            cb()
        }
    });
}

let statusTimeout: number;
export const progressStatus = (data: IWebSocketData) => {
    const statusElement = document.querySelector("#status") as HTMLElement;
    if (!statusElement) {
        return;
    }

    if (isMobile()) {
        if (!document.querySelector("#keyboardToolbar").classList.contains("fn__none")) {
            return;
        }
        clearTimeout(statusTimeout);
        statusElement.innerHTML = data.msg;
        statusElement.style.bottom = "0";
        statusTimeout = window.setTimeout(() => {
            statusElement.style.bottom = "";
        }, 7000);
    } else {
        const msgElement = statusElement.querySelector(".status__msg");
        if (msgElement) {
            clearTimeout(statusTimeout);
            msgElement.innerHTML = data.msg;
            statusTimeout = window.setTimeout(() => {
                msgElement.innerHTML = "";
            }, 7000);
        }
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
    <div>${data.msg}</div>
</div>`;
    } else if (data.code === 1) {
        if (progressElement.lastElementChild) {
            progressElement.lastElementChild.lastElementChild.innerHTML = data.msg;
        } else {
            progressElement.innerHTML = `<div class="b3-dialog__scrim" style="opacity: 1"></div>
<div class="b3-dialog__loading">
    <div style="margin: 8px 0;height: 8px;border-radius: var(--b3-border-radius);overflow: hidden;background-color:#fff;"><div style="background-color: var(--b3-theme-primary);height: 8px;background-image: linear-gradient(-45deg, rgba(255, 255, 255, 0.2) 25%, transparent 25%, transparent 50%, rgba(255, 255, 255, 0.2) 50%, rgba(255, 255, 255, 0.2) 75%, transparent 75%, transparent);animation: stripMove 450ms linear infinite;background-size: 50px 50px;"></div></div>
    <div>${data.msg}</div>
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
            window.siyuan.menus.menu.element.getAttribute("data-name") === "statusBackgroundTask") {
            window.siyuan.menus.menu.remove();
        }
    } else {
        backgroundTaskElement.classList.remove("fn__none");
        backgroundTaskElement.setAttribute("data-tasks", JSON.stringify(tasks));
        backgroundTaskElement.innerHTML = tasks[0].action + "<div><div></div></div>";
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

export const setTitle = (title: string) => {
    const dragElement = document.getElementById("drag");
    const workspaceName = getWorkspaceName();
    if (title === window.siyuan.languages.siyuanNote) {
        const versionTitle = `${workspaceName} - ${window.siyuan.languages.siyuanNote} v${Constants.SIYUAN_VERSION}`;
        document.title = versionTitle;
        if (dragElement) {
            dragElement.textContent = versionTitle;
            dragElement.setAttribute("title", versionTitle);
        }
    } else {
        title = title || window.siyuan.languages.untitled;
        document.title = `${title} - ${workspaceName} - ${window.siyuan.languages.siyuanNote} v${Constants.SIYUAN_VERSION}`;
        if (!dragElement) {
            return;
        }
        dragElement.setAttribute("title", title);
        dragElement.innerHTML = escapeHtml(title);
    }
};

export const downloadProgress = (data: { id: string, percent: number }) => {
    const bazzarSideElement = document.querySelector("#configBazaarReadme .item__side");
    if (!bazzarSideElement) {
        return;
    }
    if (data.id !== JSON.parse(bazzarSideElement.getAttribute("data-obj")).repoURL) {
        return;
    }
    const btnElement = bazzarSideElement.querySelector('[data-type="install"]') as HTMLElement;
    if (btnElement) {
        if (data.percent >= 1) {
            btnElement.parentElement.classList.add("fn__none");
            btnElement.parentElement.nextElementSibling.classList.add("fn__none");
        } else {
            btnElement.classList.add("b3-button--progress");
            btnElement.parentElement.nextElementSibling.firstElementChild.classList.add("b3-button--progress");
            btnElement.innerHTML = `<span style="width: ${data.percent * 100}%"></span>`;
            btnElement.parentElement.nextElementSibling.firstElementChild.innerHTML = `<span style="width: ${data.percent * 100}%"></span>`;
        }
    }
};

export const processSync = (data?: IWebSocketData, plugins?: Plugin[]) => {
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
