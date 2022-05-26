let timeoutId: number;
export const showMessage = (message: string, timeout = 6000, type = "info") => {
    clearTimeout(timeoutId);

    let messageElement = document.getElementById("message");
    if (!messageElement) {
        document.body.insertAdjacentHTML("beforeend", '<div class="b3-snackbar" id="message"></div>');
        messageElement = document.getElementById("message");
    }
    if (type === "error") {
        messageElement.classList.add("b3-snackbar--error");
    } else {
        messageElement.classList.remove("b3-snackbar--error");
    }

    if (timeout === 0) {
        messageElement.innerHTML = `<div class="b3-snackbar__content">${message}
<svg class="b3-snackbar__close fn__a"><use xlink:href="#iconClose"></use></svg></div>`;
        messageElement.querySelector(".b3-snackbar__close").addEventListener("click", () => {
            hideMessage();
        });
    } else {
        messageElement.innerHTML = `<div class="b3-snackbar__content">${message}</div>`;
        if (timeout !== -1) {
            timeoutId = window.setTimeout(() => {
                hideMessage();
            }, timeout);
        }
    }
    setTimeout(() => {
        messageElement.classList.add("b3-snackbar--show");
    });
};

export const hideMessage = () => {
    const messageElement = document.getElementById("message");
    if (messageElement) {
        messageElement.innerHTML = "";
        messageElement.classList.remove("b3-snackbar--show");
    }
};
