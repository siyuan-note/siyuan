export const disabledWYSIWYG = (element: HTMLElement) => {
    element.querySelectorAll(".protyle-icons--show").forEach(item => {
        item.classList.remove("protyle-icons--show");
    });
    element.querySelectorAll(".av__gallery-fields--edit").forEach(item => {
        item.classList.remove("av__gallery-fields--edit");
    });
    element.querySelectorAll(".render-node .protyle-action__edit").forEach(item => {
        item.classList.add("fn__none");
        if (item.classList.contains("protyle-icon--first")) {
            item.nextElementSibling?.classList.add("protyle-icon--first");
        }
    });
    element.style.userSelect = "text";
    element.setAttribute("contenteditable", "false");
    // 用于区分移动端样式
    element.setAttribute("data-readonly", "true");
    element.querySelectorAll('[contenteditable="true"][spellcheck]').forEach(item => {
        item.setAttribute("contenteditable", "false");
    });
    element.querySelectorAll('.protyle-action[draggable="true"]').forEach(item => {
        item.setAttribute("draggable", "false");
    });
};
