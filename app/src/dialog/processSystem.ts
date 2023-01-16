import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
import {ipcRenderer} from "electron";
import {exportLayout} from "../layout/util";
/// #endif
import {hideMessage, showMessage} from "./message";
import {Dialog} from "./index";
import {isMobile} from "../util/functions";
import {confirmDialog} from "./confirmDialog";
import {getCurrentWindow} from "@electron/remote";
import {escapeHtml} from "../util/escape";
import {getWorkspaceName} from "../util/noRelyPCFunction";

export const lockScreen = () => {
    /// #if BROWSER
    fetchPost("/api/system/logoutAuth", {}, () => {
        window.location.href = "/";
    });
    /// #else
    ipcRenderer.send(Constants.SIYUAN_LOCK_SCREEN);
    /// #endif
};

export const lockFile = (id: string) => {
    const html = `<div class="b3-dialog__scrim"></div>
<div class="b3-dialog__container">
    <div class="b3-dialog__header" onselectstart="return false;">🔒 ${window.siyuan.languages.lockFile0} <small>v${Constants.SIYUAN_VERSION}</small></div>
    <div class="b3-dialog__content">
        <p>${window.siyuan.languages.lockFile1}</p>
        <p>${window.siyuan.languages.lockFile2}</p>
    </div>
    <div class="b3-dialog__action">
        <button class="b3-button b3-button--cancel">${window.siyuan.languages.closeTab}</button>
        <div class="fn__space"></div>
        <button class="b3-button b3-button--text">${window.siyuan.languages.retry}</button>
    </div>
</div>`;
    let logElement = document.getElementById("errorLog");
    if (logElement) {
        logElement.innerHTML = html;
    } else {
        document.body.insertAdjacentHTML("beforeend", `<div id="errorLog" class="b3-dialog b3-dialog--open">${html}</div>`);
        logElement = document.getElementById("errorLog");
    }
    logElement.querySelector(".b3-button--cancel").addEventListener("click", () => {
        /// #if !MOBILE
        getAllModels().editor.find((item) => {
            if (item.editor.protyle.block.rootID === id) {
                item.parent.parent.removeTab(item.parent.id, false, false);
                return true;
            }
        });
        logElement.remove();
        /// #endif
    });
    logElement.querySelector(".b3-button--text").addEventListener("click", () => {
        fetchPost("/api/filetree/lockFile", {id}, (response) => {
            if (response.code === 0) {
                window.location.reload();
            }
        });
    });
};

export const kernelError = () => {
    let iosReStart = "";
    if (window.siyuan.config.system.container === "ios" && window.webkit?.messageHandlers) {
        iosReStart = `<div class="fn__hr"></div><div class="fn__flex"><div class="fn__flex-1"></div><button class="b3-button">${window.siyuan.languages.retry}</button></div>`;
    }
    const html = `<div class="b3-dialog__scrim"></div>
<div class="b3-dialog__container" style="width: ${isMobile() ? "80vw" : "520px"}">
    <div class="b3-dialog__header" onselectstart="return false;">💔 ${window.siyuan.languages.kernelFault0} <small>v${Constants.SIYUAN_VERSION}</small></div>
    <div class="b3-dialog__content">
        <p>${window.siyuan.languages.kernelFault1}</p>
        <div class="fn__hr"></div>
        <p>${window.siyuan.languages.kernelFault2}</p>
        ${iosReStart}
    </div>
</div>`;
    let logElement = document.getElementById("errorLog");
    if (logElement) {
        logElement.innerHTML = html;
    } else {
        document.body.insertAdjacentHTML("beforeend", `<div id="errorLog" class="b3-dialog b3-dialog--open">${html}</div>`);
        logElement = document.getElementById("errorLog");
    }

    const restartElement = logElement.querySelector(".b3-button");
    if (restartElement && window.webkit?.messageHandlers) {
        restartElement.addEventListener("click", () => {
            logElement.remove();
            window.webkit.messageHandlers.startKernelFast.postMessage("startKernelFast");
        });
    }
};

export const exitSiYuan = () => {
    fetchPost("/api/system/exit", {force: false}, (response) => {
        if (response.code === 1) { // 同步执行失败
            const msgId = showMessage(response.msg, response.data.closeTimeout, "error");
            const buttonElement = document.querySelector(`#message [data-id="${msgId}"] button`);
            if (buttonElement) {
                buttonElement.addEventListener("click", () => {
                    fetchPost("/api/system/exit", {force: true}, () => {
                        /// #if !BROWSER
                        ipcRenderer.send(Constants.SIYUAN_QUIT, getCurrentWindow().id);
                        /// #else
                        if (["ios", "android"].includes(window.siyuan.config.system.container) && (window.webkit?.messageHandlers || window.JSAndroid)) {
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
                        getCurrentWindow().hide();
                    }, 2000);
                    // 然后等待一段时间后再退出，避免界面主进程退出以后内核子进程被杀死
                    setTimeout(() => {
                        ipcRenderer.send(Constants.SIYUAN_QUIT, getCurrentWindow().id);
                    }, 4000);
                    /// #endif
                });
            }, () => {
                fetchPost("/api/system/exit", {
                    force: true,
                    execInstallPkg: 1 //  0：默认检查新版本，1：不执行新版本安装，2：执行新版本安装
                }, () => {
                    /// #if !BROWSER
                    ipcRenderer.send(Constants.SIYUAN_QUIT, getCurrentWindow().id);
                    /// #endif
                });
            });
        } else { // 正常退出
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_QUIT, getCurrentWindow().id);
            /// #else
            if (["ios", "android"].includes(window.siyuan.config.system.container) && (window.webkit?.messageHandlers || window.JSAndroid)) {
                window.location.href = "siyuan://api/system/exit";
            }
            /// #endif
        }
    });
};

export const transactionError = (data: { code: number, data: string }) => {
    if (data.code === 1) {
        lockFile(data.data);
        return;
    }
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
        width: isMobile() ? "80vw" : "520px",
    });
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        /// #if MOBILE
        exitSiYuan();
        /// #else
        exportLayout(false, () => {
            exitSiYuan();
        });
        /// #endif
    });
    btnsElement[1].addEventListener("click", () => {
        fetchPost("/api/filetree/refreshFiletree", {});
    });
};

let progressStatusTimeoutId: number;
export const progressStatus = (data: IWebSocketData) => {
    if (isMobile()) {
        clearTimeout(progressStatusTimeoutId);
        const statusElement = document.querySelector("#status") as HTMLElement;
        statusElement.innerHTML = data.msg;
        statusElement.classList.remove("status--hide");
        if (document.querySelector("#keyboardToolbar").classList.contains("fn__none")) {
            statusElement.style.bottom = "0";
        } else {
            statusElement.style.bottom = "30px";
        }
        progressStatusTimeoutId = window.setTimeout(() => {
            statusElement.style.bottom = "";
        }, 6000);
        return;
    }
    document.querySelector("#status .status__msg").innerHTML = data.msg;
};

export const progressLoading = (data: IWebSocketData) => {
    let progressElement = document.getElementById("progress");
    if (!progressElement) {
        document.body.insertAdjacentHTML("beforeend", '<div id="progress"></div>');
        progressElement = document.getElementById("progress");
    }
    // code 0: 有进度；1: 无进度；2: 关闭
    if (data.code === 2) {
        progressElement.remove();
        return;
    }
    if (data.code === 0) {
        progressElement.innerHTML = `<div class="b3-dialog__scrim" style="z-index:400;opacity: 1"></div>
<div style="position: fixed;top: 45vh;width: 70vw;left: 15vw;color:#fff;z-index:400;">
    <div style="text-align: right">${data.data.current}/${data.data.total}</div>
    <div style="margin: 8px 0;height: 8px;border-radius: 4px;overflow: hidden;background-color:#fff;"><div style="width: ${data.data.current / data.data.total * 100}%;transition: var(--b3-transition);background-color: var(--b3-theme-primary);height: 8px;"></div></div>
    <div>${data.msg}</div>
</div>`;
    } else if (data.code === 1) {
        if (progressElement.lastElementChild) {
            progressElement.lastElementChild.lastElementChild.innerHTML = data.msg;
        } else {
            progressElement.innerHTML = `<div class="b3-dialog__scrim" style="z-index:400;opacity: 1"></div>
<div style="position: fixed;top: 45vh;width: 70vw;left: 15vw;color:#fff;z-index:400;">
    <div style="margin: 8px 0;height: 8px;border-radius: 4px;overflow: hidden;background-color:#fff;"><div style="background-color: var(--b3-theme-primary);height: 8px;background-image: linear-gradient(-45deg, rgba(255, 255, 255, 0.2) 25%, transparent 25%, transparent 50%, rgba(255, 255, 255, 0.2) 50%, rgba(255, 255, 255, 0.2) 75%, transparent 75%, transparent);animation: stripMove 450ms linear infinite;background-size: 50px 50px;"></div></div>
    <div>${data.msg}</div>
</div>`;
        }
    }
};

export const bootSync = () => {
    fetchPost("/api/sync/getBootSync", {}, response => {
        if (response.code === 1) {
            const dialog = new Dialog({
                width: isMobile() ? "80vw" : "50vw",
                title: "🌩️ " + window.siyuan.languages.bootSyncFailed,
                content: `<div class="b3-dialog__content">${response.msg}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.syncNow}</button>
</div>`
            });
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
        const versionTitle = `${title} - ${workspaceName} - v${Constants.SIYUAN_VERSION}`;
        document.title = versionTitle;
        if (dragElement) {
            dragElement.textContent = versionTitle;
            dragElement.setAttribute("title", versionTitle);
        }
    } else {
        title = title || "Untitled";
        document.title = `${title} - ${workspaceName} - ${window.siyuan.languages.siyuanNote} v${Constants.SIYUAN_VERSION}`;
        if (!dragElement) {
            return;
        }
        dragElement.setAttribute("title", title);
        dragElement.innerHTML = escapeHtml(title);
    }
};

export const downloadProgress = (data: { id: string, percent: number }) => {
    const bazzarElement = document.getElementById("configBazaarReadme");
    if (!bazzarElement) {
        return;
    }
    const btnElement = bazzarElement.querySelector(`[data-url="${data.id}"]`) as HTMLElement;
    if (btnElement) {
        if (data.percent >= 1) {
            btnElement.parentElement.classList.add("fn__none");
        } else {
            btnElement.classList.add("b3-button--progress");
            btnElement.innerHTML = `<span style="width: ${data.percent * 100}%"></span>`;
        }
    }
};
