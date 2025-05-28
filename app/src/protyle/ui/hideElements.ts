import {getAllEditor} from "../../layout/getAll";

// "gutter", "toolbar", "select", "hint", "util", "dialog", "gutterOnly"
export const hideElements = (panels: string[], protyle?: IProtyle, focusHide = false) => {
    if (!protyle) {
        if (panels.includes("dialog")) {
            const dialogLength = window.siyuan.dialogs.length;
            for (let i = 0; i < dialogLength; i++) {
                window.siyuan.dialogs[i].destroy();
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
    //  不能 remove("protyle-wysiwyg--hl") 否则打开页签的时候 "cb-get-hl" 高亮会被移除
    if (protyle.gutter && panels.includes("gutterOnly")) {
        protyle.gutter.element.classList.add("fn__none");
        protyle.gutter.element.innerHTML = "";
    }
    if (protyle.toolbar && panels.includes("toolbar")) {
        protyle.toolbar.element.classList.add("fn__none");
        protyle.toolbar.element.style.display = "";
    }
    if (protyle.toolbar && panels.includes("util")) {
        const pinElement = protyle.toolbar.subElement.querySelector('[data-type="pin"]');
        if (focusHide || !pinElement || (pinElement && pinElement.getAttribute("aria-label") === window.siyuan.languages.pin)) {
            protyle.toolbar.subElement.classList.add("fn__none");
            if (protyle.toolbar.subElementCloseCB) {
                protyle.toolbar.subElementCloseCB();
                protyle.toolbar.subElementCloseCB = undefined;
            }
        }
    }
    if (panels.includes("select")) {
        protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
            item.classList.remove("protyle-wysiwyg--select");
            item.removeAttribute("select-start");
            item.removeAttribute("select-end");
        });
    }
};

// "toolbar", "pdfutil", "gutter", "util"
export const hideAllElements = (types: string[]) => {
    if (types.includes("toolbar")) {
        document.querySelectorAll(".protyle-toolbar").forEach((item: HTMLElement) => {
            item.classList.add("fn__none");
            item.style.display = "";
        });
    }
    if (types.includes("util")) {
        getAllEditor().forEach(item => {
            if (item.protyle.toolbar) {
                const pinElement = item.protyle.toolbar.subElement.querySelector('[data-type="pin"]');
                if (!pinElement || (pinElement && pinElement.getAttribute("aria-label") === window.siyuan.languages.pin)) {
                    item.protyle.toolbar.subElement.classList.add("fn__none");
                    if (item.protyle.toolbar.subElementCloseCB) {
                        item.protyle.toolbar.subElementCloseCB();
                        item.protyle.toolbar.subElementCloseCB = undefined;
                    }
                }
            }
        });
    }
    if (types.includes("pdfutil")) {
        document.querySelectorAll(".pdf__util").forEach(item => {
            item.classList.add("fn__none");
        });
    }
    if (types.includes("gutter")) {
        document.querySelectorAll(".protyle-gutters").forEach(item => {
            item.classList.add("fn__none");
            item.innerHTML = "";
        });
    }
};
