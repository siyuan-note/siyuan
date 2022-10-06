export const showKeyboardToolbar = (bottom = 0) => {
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.classList.remove("fn__none");
    toolbarElement.style.bottom = bottom + "px";
}
