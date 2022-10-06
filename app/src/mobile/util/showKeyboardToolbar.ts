export const showKeyboardToolbar = (bottom = 0) => {
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.classList.remove("fn__none");
    toolbarElement.style.bottom = bottom + "px";
}

export const hideKeyboardToolbar = () => {
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.classList.add("fn__none");
}

export const initKeyboardToolbar = () => {
    const toolbarElement = document.getElementById("keyboardToolbar");
}
