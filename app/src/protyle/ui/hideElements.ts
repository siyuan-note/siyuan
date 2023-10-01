/// #if MOBILE
import {getCurrentEditor} from "../../mobile/editor";
/// #else
import {getAllEditor} from "../../layout/getAll";
/// #endif

// "gutter", "toolbar", "select", "hint", "util", "dialog"
export const hideElements = (panels: string[], protyle?: IProtyle, focusHide = false) => {
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
        protyle.toolbar.element.style.display = "";
    }
    if (protyle.toolbar && panels.includes("util")) {
        const pinElement = protyle.toolbar.subElement.querySelector('[data-type="pin"]');
        if (focusHide || !pinElement || (pinElement && !pinElement.classList.contains("block__icon--active"))) {
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
        /// #if MOBILE
        const editor = getCurrentEditor();
        editor.protyle.toolbar.subElement.classList.add("fn__none");
        if (editor.protyle.toolbar.subElementCloseCB) {
            editor.protyle.toolbar.subElementCloseCB();
            editor.protyle.toolbar.subElementCloseCB = undefined;
        }
        /// #else
        getAllEditor().forEach(item => {
            if (item.protyle.toolbar) {
                item.protyle.toolbar.subElement.classList.add("fn__none");
                if (item.protyle.toolbar.subElementCloseCB) {
                    item.protyle.toolbar.subElementCloseCB();
                    item.protyle.toolbar.subElementCloseCB = undefined;
                }
            }
        });
        /// #endif
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
