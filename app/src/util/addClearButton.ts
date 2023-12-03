const update = (inputElement: HTMLInputElement, clearElement: Element, right = 8) => {
    if (inputElement.value === "") {
        clearElement.classList.add("fn__none");
        inputElement.style.paddingRight = "";
    } else {
        clearElement.classList.remove("fn__none");
        inputElement.style.setProperty('padding-right', `${right * 2 + clearElement.clientWidth}px`, 'important');
    }
}
export const addClearButton = (inputElement: HTMLInputElement, clearCB?: () => void, right = 8, height?: number) => {
    inputElement.insertAdjacentHTML("afterend",
        `<svg class="b3-form__icon-clear" style="right:${right}px;height: ${height || inputElement.clientHeight}px;">
<use xlink:href="#iconCloseRound"></use></svg>`);
    const clearElement = inputElement.nextElementSibling;
    clearElement.addEventListener("click", () => {
        inputElement.value = "";
        inputElement.focus();
        update(inputElement, clearElement, right);
        if (clearCB) {
            clearCB();
        }
    })
    inputElement.addEventListener("input", () => {
        update(inputElement, clearElement, right);
    });
    update(inputElement, clearElement, right);
};
