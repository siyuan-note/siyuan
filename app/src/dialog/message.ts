import {genUUID} from "../util/genID";
import {Constants} from "../constants";
import {getHostCapabilities, sanitizeKernelHTML} from "../util/hostCapabilities";
import {progressLoading} from "./progress";
import {fetchPost} from "../util/fetch";

export const initMessage = () => {
    const messageElement = document.getElementById("message");
    messageElement.innerHTML = '<div class="fn__flex-1"></div>';
    messageElement.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(messageElement)) {
            if (target.classList.contains("b3-snackbar__close")) {
                hideMessage(target.parentElement.getAttribute("data-id"));
                event.preventDefault();
                break;
            } else if (target.tagName === "BUTTON" && target.dataset.type === "download-update") {
                event.preventDefault();
                const button = target as HTMLButtonElement;
                if (!button.disabled && getHostCapabilities().ownsKernel &&
                    button.closest('.b3-snackbar[data-id="update-notify"]')) {
                    button.disabled = true;
                    void fetchPost("/api/system/downloadUpdate", {version: button.dataset.version}, () => {
                        hideMessage("update-notify");
                    }).catch((error: Error) => {
                        showMessage(error.message, 7000, "error");
                    }).finally(() => {
                        button.disabled = false;
                    });
                }
                break;
            } else if (target.tagName === "A" || target.tagName === "BUTTON") {
                break;
            } else if (target.classList.contains("b3-snackbar")) {
                if (getSelection().rangeCount === 0 || !getSelection().getRangeAt(0).toString()) {
                    hideMessage(target.getAttribute("data-id"));
                }
                event.preventDefault();
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });

    document.querySelectorAll("#tempMessage > div").forEach((item) => {
        showMessage(item.innerHTML, parseInt(item.getAttribute("data-timeout")), item.getAttribute("data-type"), item.getAttribute("data-message-id"));
        item.remove();
    });
};

// type: info/error; timeout: 0 手动关闭；-1 永不关闭
export const showMessage = (message: string, timeout = 6000, type = "info", messageId?: string) => {
    if (!message) {
        return;
    }

    // 退出期间将内核的退出和同步状态合并到进度提示，其他通知仍按原有方式展示。
    if (type === "info" && document.getElementById("exitProgress") &&
        [window.siyuan.languages._kernel[95], window.siyuan.languages._kernel[81]].includes(message)) {
        progressLoading({code: 1, msg: message === window.siyuan.languages._kernel[81] ?
            `${window.siyuan.languages.exitWaiting} ${message}` : window.siyuan.languages.exitWaiting}, "exitProgress");
        return;
    }

    const remoteKernel = getHostCapabilities().remoteKernel;
    if (remoteKernel) {
        timeout = Number.isFinite(timeout) ? Math.max(-1, Math.min(Math.trunc(timeout), 2147483647)) : 6000;
        type = type === "error" ? "error" : "info";
    }
    let safeMessage = sanitizeKernelHTML(message);
    if (messageId === "update-notify" && !getHostCapabilities().ownsKernel) {
        const template = document.createElement("template");
        template.innerHTML = safeMessage;
        template.content.querySelectorAll('[data-type="download-update"]').forEach(button => button.remove());
        safeMessage = template.innerHTML;
    }
    const safeMessageId = remoteKernel && messageId && !/^[\w-]+$/.test(messageId) ? undefined : messageId;

    const messagesElement = document.getElementById("message").firstElementChild;
    if (!messagesElement) {
        let tempMessages = document.getElementById("tempMessage");
        if (!tempMessages) {
            document.body.insertAdjacentHTML("beforeend", `<div style="font-size: 14px;top: var(--b3-snackbar-top, 48px);position: fixed;z-index: 100;right: var(--b3-snackbar-right, 16px);line-height: 20px;word-break: break-word;display: flex;flex-direction: column;align-items: flex-end;"
id="tempMessage"></div>`);
            tempMessages = document.getElementById("tempMessage");
        }
        tempMessages.insertAdjacentHTML("beforeend", `<div style="background: white;padding: 8px 16px;border-radius: 6px;margin-bottom: 16px;"  
data-timeout="${timeout}" 
data-type="${type}" 
data-message-id="${safeMessageId || ""}">${safeMessage}</div>`);
        return;
    }
    const id = safeMessageId || genUUID();
    const existElement = messagesElement.querySelector(`.b3-snackbar[data-id="${id}"]`);
    const messageVersion = safeMessage + (type === "error" ? " v" + Constants.SIYUAN_VERSION : "");
    if (existElement) {
        window.clearTimeout(parseInt(existElement.getAttribute("data-timeoutid")));
        existElement.innerHTML = `<div data-type="textMenu" class="b3-snackbar__content${timeout === 0 ? " b3-snackbar__content--close" : ""}">${messageVersion}</div>${timeout === 0 ? '<svg class="b3-snackbar__close"><use xlink:href="#iconCloseRound"></use></svg>' : ""}`;
        if (type === "error") {
            existElement.classList.add("b3-snackbar--error");
        } else {
            existElement.classList.remove("b3-snackbar--error");
        }
        if (timeout > 0) {
            const timeoutId = window.setTimeout(() => {
                hideMessage(id);
            }, timeout);
            existElement.setAttribute("data-timeoutid", timeoutId.toString());
        }
        // 复用已有通知时同样返回 id，调用方才能按 id 关闭它
        return id;
    }
    let messageHTML = `<div data-id="${id}" class="b3-snackbar--hide b3-snackbar${type === "error" ? " b3-snackbar--error" : ""}"><div data-type="textMenu" class="b3-snackbar__content${timeout === 0 ? " b3-snackbar__content--close" : ""}">${messageVersion}</div>`;
    if (timeout === 0) {
        messageHTML += '<svg class="b3-snackbar__close"><use xlink:href="#iconCloseRound"></use></svg>';
    } else if (timeout !== -1) { // -1 时需等待请求完成后手动关闭
        const timeoutId = window.setTimeout(() => {
            hideMessage(id);
        }, timeout);
        messageHTML = messageHTML.replace("<div data-id", `<div data-timeoutid="${timeoutId}" data-id`);
    }
    messagesElement.parentElement.classList.add("b3-snackbars--show");
    messagesElement.parentElement.style.zIndex = (++window.siyuan.zIndex).toString();
    messagesElement.insertAdjacentHTML("afterbegin", messageHTML + "</div>");
    setTimeout(() => {
        messagesElement.querySelectorAll(".b3-snackbar--hide").forEach(item => {
            item.classList.remove("b3-snackbar--hide");
        });
    });
    if (messagesElement.firstElementChild.nextElementSibling &&
        messagesElement.firstElementChild.nextElementSibling.innerHTML === messagesElement.firstElementChild.innerHTML) {
        messagesElement.firstElementChild.nextElementSibling.remove();
    }
    messagesElement.scrollTo({
        top: 0,
        behavior: "smooth"
    });
    return id;
};

export const hideMessage = (id?: string) => {
    const messagesElement = document.getElementById("message").firstElementChild;
    if (!messagesElement) {
        return;
    }
    if (id) {
        const messageElement = messagesElement.querySelector(`[data-id="${id}"]`);
        if (messageElement) {
            messageElement.classList.add("b3-snackbar--hide");
            window.clearTimeout(parseInt(messageElement.getAttribute("data-timeoutid")));
            setTimeout(() => {
                messageElement.remove();
                if (messagesElement.childElementCount === 0) {
                    messagesElement.parentElement.classList.remove("b3-snackbars--show");
                    messagesElement.innerHTML = "";
                }
            }, Constants.TIMEOUT_INPUT);
        }
        let hasShowItem = false;
        Array.from(messagesElement.children).find(item => {
            if (!item.classList.contains("b3-snackbar--hide")) {
                hasShowItem = true;
                return true;
            }
        });
        if (hasShowItem) {
            messagesElement.parentElement.classList.add("b3-snackbars--show");
        } else {
            messagesElement.parentElement.classList.remove("b3-snackbars--show");
        }
    } else {
        messagesElement.parentElement.classList.remove("b3-snackbars--show");
        setTimeout(() => {
            messagesElement.innerHTML = "";
        }, Constants.TIMEOUT_INPUT);
    }
};
