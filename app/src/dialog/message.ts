import {genUUID} from "../util/genID";

export const initMessage = () => {
    const messageElement = document.getElementById("message");
    messageElement.innerHTML = `<div class="fn__flex-1"></div>
<button class="b3-button b3-button--outline">
    <svg><use xlink:href="#iconTrashcan"></use></svg> ${window.siyuan.languages.clearMessage}
</button>`;
    messageElement.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(messageElement)) {
            if (target.classList.contains("b3-snackbar__close")) {
                hideMessage(target.parentElement.getAttribute("data-id"));
                event.preventDefault();
                break;
            } else if (target.isSameNode(messageElement.lastElementChild)) {
                target.parentElement.classList.remove("b3-snackbars--show");
                target.parentElement.firstElementChild.innerHTML = "";
                event.preventDefault();
                break;
            }
            target = target.parentElement;
        }
    });
};

export const showMessage = (message: string, timeout = 6000, type = "info", messageId?: string) => {
    const id = messageId || genUUID();
    let messageHTML = `<div data-id="${id}" class="b3-snackbar${type === "error" ? " b3-snackbar--error" : ""}"><div class="b3-snackbar__content">${message}</div>`;
    if (timeout === 0) {
        messageHTML += '<svg class="b3-snackbar__close"><use xlink:href="#iconClose"></use></svg>';
    } else if (timeout !== -1) { // -1 时需等待请求完成后手动关闭
        window.setTimeout(() => {
            hideMessage(id);
        }, timeout);
    }
    const messagesElement = document.getElementById("message").firstElementChild;
    if (messagesElement.childElementCount === 0) {
        messagesElement.parentElement.classList.add("b3-snackbars--show");
    }
    messagesElement.insertAdjacentHTML("afterbegin", messageHTML + "</div>");
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

export const hideMessage = (id: string) => {
    const messagesElement = document.getElementById("message").firstElementChild;
    const messageElement = messagesElement.querySelector(`[data-id="${id}"]`);
    if (messageElement) {
        messageElement.classList.add("b3-snackbar--hide");
        setTimeout(() => {
            messageElement.remove();
        }, 520);
        if (messagesElement.childElementCount < 2) {
            messagesElement.parentElement.classList.remove("b3-snackbars--show");
        }
    }
};
