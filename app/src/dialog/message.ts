import {genUUID} from "../util/genID";
import {Constants} from "../constants";

export const initMessage = () => {
    const messageElement = document.getElementById("message");
    messageElement.innerHTML = `<div class="fn__flex-1"></div>
<button class="b3-button--cancel b3-button b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.clearMessage}"><svg style="margin-right: 0"><use xlink:href="#iconSelect"></use></svg></button>`;
    messageElement.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(messageElement)) {
            if (target.classList.contains("b3-snackbar__close")) {
                hideMessage(target.parentElement.getAttribute("data-id"));
                event.preventDefault();
                break;
            } else if (target.isSameNode(messageElement.lastElementChild)) {
                target.parentElement.classList.remove("b3-snackbars--show");
                setTimeout(() => {
                    target.parentElement.firstElementChild.innerHTML = "";
                }, Constants.TIMEOUT_INPUT);
                event.preventDefault();
                break;
            } else if (target.tagName === "A" || target.tagName === "BUTTON") {
                break;
            } else if (target.classList.contains("b3-snackbar")) {
                hideMessage(target.getAttribute("data-id"));
                event.preventDefault();
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
};

// type: info/error; timeout: 0 手动关闭；-1 用不关闭
export const showMessage = (message: string, timeout = 6000, type = "info", messageId?: string) => {
    const messageVersion = message + (type === "error" ? " v" + Constants.SIYUAN_VERSION : "");
    const id = messageId || genUUID();
    const messagesElement = document.getElementById("message").firstElementChild;
    const existElement = messagesElement.querySelector(`.b3-snackbar[data-id="${id}"]`);
    if (existElement) {
        window.clearTimeout(parseInt(existElement.getAttribute("data-timeoutid")));
        existElement.innerHTML = `<div class="b3-snackbar__content${timeout === 0 ? " b3-snackbar__content--close" : ""}">${messageVersion}</div>${timeout === 0 ? '<svg class="b3-snackbar__close"><use xlink:href="#iconCloseRound"></use></svg>' : ""}`;
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
        return;
    }
    let messageHTML = `<div data-id="${id}" class="b3-snackbar--hide b3-snackbar${type === "error" ? " b3-snackbar--error" : ""}"><div class="b3-snackbar__content${timeout === 0 ? " b3-snackbar__content--close" : ""}">${messageVersion}</div>`;
    if (timeout === 0) {
        messageHTML += '<svg class="b3-snackbar__close"><use xlink:href="#iconCloseRound"></use></svg>';
    } else if (timeout !== -1) { // -1 时需等待请求完成后手动关闭
        const timeoutId = window.setTimeout(() => {
            hideMessage(id);
        }, timeout);
        messageHTML = messageHTML.replace("<div data-id", `<div data-timeoutid="${timeoutId}" data-id`);
    }
    messagesElement.parentElement.classList.add("b3-snackbars--show");
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
            setTimeout(() => {
                messageElement.remove();
                if (messagesElement.childElementCount === 0) {
                    hideMessage();
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
