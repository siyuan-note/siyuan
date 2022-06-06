import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
import {ipcRenderer} from "electron";
/// #endif
import {showMessage} from "./message";
import {Dialog} from "./index";
import {isMobile} from "../util/functions";
import {exportLayout} from "../layout/util";

export const lockFile = (id: string) => {
    const html = `<div class="b3-dialog__scrim"></div>
<div class="b3-dialog__container">
    <div class="b3-dialog__header" onselectstart="return false;">🔒 ${window.siyuan.languages.lockFile0} <small>v${Constants.SIYUAN_VERSION}</small></div>
    <div class="b3-dialog__content b3-typography">
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
                item.parent.parent.removeTab(item.parent.id);
                logElement.remove();
                return true;
            }
        });
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
<div class="b3-dialog__container">
    <div class="b3-dialog__header" onselectstart="return false;">💔 ${window.siyuan.languages.kernelFault0} <small>v${Constants.SIYUAN_VERSION}</small></div>
    <div class="b3-dialog__content b3-typography">
        <p>${window.siyuan.languages.kernelFault1}</p>
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
        if (response.code === 1) {
            const msgId = showMessage(response.msg, response.data.closeTimeout, "error");
            const buttonElement = document.querySelector(`#message [data-id="${msgId}"] button`);
            if (buttonElement) {
                buttonElement.addEventListener("click", () => {
                    fetchPost("/api/system/exit", {force: true}, () => {
                        /// #if !BROWSER
                        ipcRenderer.send(Constants.SIYUAN_CONFIG_CLOSETRAY);
                        ipcRenderer.send(Constants.SIYUAN_QUIT);
                        /// #else
                        if (["ios", "android"].includes(window.siyuan.config.system.container) && (window.webkit?.messageHandlers || window.JSAndroid)) {
                            window.location.href = "siyuan://api/system/exit";
                        }
                        /// #endif
                    });
                });
            }
        } else {
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_CONFIG_CLOSETRAY);
            ipcRenderer.send(Constants.SIYUAN_QUIT);
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
        exportLayout(false, () => {
            exitSiYuan();
        });
    });
    btnsElement[1].addEventListener("click", () => {
        dialog.destroy();
        fetchPost("/api/filetree/refreshFiletree", {});
    });
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
    if (title === window.siyuan.languages.siyuanNote) {
        const versionTitle = title + " v" + Constants.SIYUAN_VERSION;
        document.title = versionTitle;
        dragElement.textContent = versionTitle;
        dragElement.setAttribute("title", versionTitle);
    } else {
        document.title = title + " - " + window.siyuan.languages.siyuanNote + " v" + Constants.SIYUAN_VERSION;
        dragElement.textContent = title;
        dragElement.setAttribute("title", title);
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
