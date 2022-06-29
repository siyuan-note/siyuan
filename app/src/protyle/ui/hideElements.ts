// "gutter", "toolbar", "select", "hint", "util", "dialog"
export const hideElements = (panels: string[], protyle?: IProtyle) => {
    if (!protyle) {
        if (panels.includes("dialog")) {
            for (let i = 0; i < window.siyuan.dialogs.length; i++) {
                window.siyuan.dialogs[i].destroy();
                i--;
            }
        }
        return;
    }
    if (panels.includes("hint")) {
        clearTimeout(protyle.hint.timeId);
        protyle.hint.element.classList.add("fn__none");
    }
    if (protyle.gutter && panels.includes("gutter")) {
        protyle.gutter.element.classList.add("fn__none");
        protyle.gutter.element.innerHTML = "";
        // https://ld246.com/article/1651935412480
        protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl").forEach((item) => {
            item.classList.remove("protyle-wysiwyg--hl");
        });
    }
    if (protyle.toolbar && panels.includes("toolbar")) {
        protyle.toolbar.element.classList.add("fn__none");
    }
    if (protyle.toolbar && panels.includes("util")) {
        const pinElement = protyle.toolbar.subElement.querySelector('[data-type="pin"]');
        if (!pinElement || (pinElement && !pinElement.classList.contains("ft__primary"))) {
            protyle.toolbar.subElement.classList.add("fn__none");
        }
    }
    if (panels.includes("select")) {
        protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
            item.classList.remove("protyle-wysiwyg--select");
        });
    }
};
