const update = (inputElement: HTMLElement, clearElement: Element, right: number, contenteditable: boolean) => {
    let value = "";
    if (contenteditable) {
        value = inputElement.textContent;
    } else {
        value = (inputElement as HTMLInputElement).value;
    }

    if (value === "") {
        clearElement.classList.add("fn__none");
        if (typeof right === "number") {
            inputElement.style.paddingRight = inputElement.dataset.oldPaddingRight;
            if (contenteditable) {
                inputElement.style.removeProperty("margin-right");
            }
        }
    } else {
        clearElement.classList.remove("fn__none");
        if (typeof right === "number") {
            // 数据库搜索需设置 margin
            inputElement.style.setProperty(contenteditable ? "margin-right" : "padding-right", `${right * 2 + clearElement.clientWidth}px`, "important");
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
    const contenteditable = !!options.inputElement.getAttribute("contenteditable");
    options.inputElement.dataset.oldPaddingRight = options.inputElement.style.paddingRight;
    options.inputElement.insertAdjacentHTML("afterend",
        `<svg class="${options.className || "b3-form__icon-clear"} ariaLabel" aria-label="${window.siyuan.languages.clear}" style="${options.right ? "right: " + options.right + "px;" : ""}${options.height ? "height:" + options.height + "px;" : ""}${options.width ? "width:" + options.width : ""}">
<use xlink:href="#iconCloseRound"></use></svg>`);
    const clearElement = options.inputElement.nextElementSibling;
    clearElement.addEventListener("click", () => {
        if (contenteditable) {
            options.inputElement.textContent = "";
        } else {
            (options.inputElement as HTMLInputElement).value = "";
        }
        options.inputElement.focus();
        update(options.inputElement, clearElement, options.right, contenteditable);
        if (options.clearCB) {
            options.clearCB();
        }
    });
    options.inputElement.addEventListener("input", () => {
        update(options.inputElement, clearElement, options.right, contenteditable);
    });
    // contenteditable 剪切不会触发 input
    if (contenteditable) {
        options.inputElement.addEventListener("cut", () => {
            // cut 事件在删除选中文本之前触发，需要延迟执行
            setTimeout(() => {
                update(options.inputElement, clearElement, options.right, contenteditable);
            });
        });
    }
    update(options.inputElement, clearElement, options.right, contenteditable);
};
