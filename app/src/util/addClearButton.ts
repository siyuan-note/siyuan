const update = (inputElement: HTMLElement, clearElement: Element, right: number) => {
    let value = "";
    if (inputElement.tagName === "DIV") {
        value = inputElement.textContent;
    } else {
        value = (inputElement as HTMLInputElement).value;
    }

    if (value === "") {
        clearElement.classList.add("fn__none");
        if (typeof right === "number") {
            inputElement.style.paddingRight = inputElement.dataset.oldPaddingRight;
        }
    } else {
        clearElement.classList.remove("fn__none");
        if (typeof right === "number") {
            inputElement.style.setProperty("padding-right", `${right * 2 + clearElement.clientWidth}px`, "important");
        }
    }
};
export const addClearButton = (options: {
    inputElement: HTMLElement,
    clearCB?: () => void,
    right?: number,
    width?: string,
    height?: number
    className?: string
}) => {
    options.inputElement.dataset.oldPaddingRight = options.inputElement.style.paddingRight;
    options.inputElement.insertAdjacentHTML("afterend",
        `<svg class="${options.className || "b3-form__icon-clear"} ariaLabel" aria-label="${window.siyuan.languages.clear}" style="${options.right ? "right: " + options.right + "px;" : ""}${options.height ? "height:" + options.height + "px;" : ""}${options.width ? "width:" + options.width : ""}">
<use xlink:href="#iconCloseRound"></use></svg>`);
    const clearElement = options.inputElement.nextElementSibling;
    clearElement.addEventListener("click", () => {
        if (options.inputElement.tagName === "DIV") {
            options.inputElement.textContent = "";
        } else {
            (options.inputElement as HTMLInputElement).value = "";
        }
        options.inputElement.focus();
        update(options.inputElement, clearElement, options.right);
        if (options.clearCB) {
            options.clearCB();
        }
    });
    options.inputElement.addEventListener("input", () => {
        update(options.inputElement, clearElement, options.right);
    });
    update(options.inputElement, clearElement, options.right);
};
