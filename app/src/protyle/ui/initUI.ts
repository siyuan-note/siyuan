import {setEditMode} from "../util/setEditMode";
import {lineNumberRender} from "../markdown/highlightRender";
import {scrollEvent} from "../scroll/event";
import {isMobile} from "../../util/functions";
import {Constants} from "../../constants";

export const initUI = (protyle: IProtyle) => {
    protyle.contentElement = document.createElement("div");
    protyle.contentElement.className = "protyle-content";
    if (protyle.options.render.background) {
        protyle.contentElement.appendChild(protyle.background.element);
    }
    if (protyle.options.render.title) {
        protyle.contentElement.appendChild(protyle.title.element);
    }
    protyle.contentElement.appendChild(protyle.wysiwyg.element);
    scrollEvent(protyle, protyle.contentElement);
    protyle.element.append(protyle.contentElement);
    protyle.element.appendChild(protyle.preview.element);
    if (protyle.upload) {
        protyle.element.appendChild(protyle.upload.element);
    }
    if (protyle.scroll) {
        protyle.element.appendChild(protyle.scroll.element);
    }
    if (protyle.gutter) {
        protyle.element.appendChild(protyle.gutter.element);
    }

    protyle.element.appendChild(protyle.hint.element);

    protyle.selectElement = document.createElement("div");
    protyle.selectElement.className = "protyle-select fn__none";
    protyle.element.appendChild(protyle.selectElement);

    protyle.element.appendChild(protyle.toolbar.element);
    protyle.element.appendChild(protyle.toolbar.subElement);

    addLoading(protyle);

    setEditMode(protyle, protyle.options.mode);
    document.execCommand("DefaultParagraphSeparator", false, "p");
};

export const addLoading = (protyle: IProtyle) => {
    protyle.element.insertAdjacentHTML("beforeend", "<div style=\"background-color: var(--b3-theme-background)\" class=\"fn__loading\"><img width=\"48px\" src=\"/stage/loading-pure.svg\"></div>");
};

export const setPadding = (protyle: IProtyle) => {
    let min16 = 16;
    let min24 = 24;
    if (!isMobile()) {
        const padding = (protyle.element.clientWidth - Constants.SIZE_EDITOR_WIDTH) / 2;
        if (!window.siyuan.config.editor.fullWidth && padding > 96) {
            min16 = padding;
            min24 = padding;
        } else if (protyle.element.clientWidth > Constants.SIZE_EDITOR_WIDTH) {
            min16 = 96;
            min24 = 96;
        }
    }
    if (protyle.options.render.background && protyle.options.render.title) {
        protyle.background.element.lastElementChild.setAttribute("style", `left:${min16}px`);
        protyle.title.element.style.margin = `16px ${min16}px 0 ${min24}px`;
    } else if (protyle.options.render.background && !protyle.options.render.title) {
        protyle.background.element.lastElementChild.setAttribute("style", `left:${min16}px`);
    } else if (!protyle.options.render.background && protyle.options.render.title) {
        protyle.title.element.style.margin = `16px ${min16}px 0 ${min24}px`;
    }
    let bottomHeight = "16px";
    if (protyle.options.typewriterMode) {
        if (isMobile()) {
            bottomHeight = window.innerHeight / 5 + "px";
        } else {
            bottomHeight = protyle.element.clientHeight / 2 + "px";
        }
    }
    protyle.wysiwyg.element.style.padding = `16px ${min16}px ${bottomHeight} ${min24}px`;
    if (!isMobile()) {
        // 防止右侧分屏后，左侧页签抖动；10 为滚动条宽度
        if (!window.siyuan.config.editor.fullWidth) {
            protyle.wysiwyg.element.style.width = (protyle.element.clientWidth - 10) + "px";
            if (protyle.options.render.title) {
                protyle.title.element.style.width = (protyle.element.clientWidth - min16 - min24 - 10) + "px";
            }
        } else {
            protyle.wysiwyg.element.style.width = "";
            if (protyle.options.render.title) {
                protyle.title.element.style.width = "";
            }
        }
    }
    if (window.siyuan.config.editor.codeSyntaxHighlightLineNum) {
        protyle.wysiwyg.element.querySelectorAll('.code-block [contenteditable="true"]').forEach((block: HTMLElement) => {
            lineNumberRender(block);
        });
    }
    if (window.siyuan.config.editor.displayBookmarkIcon) {
        const editorAttrElement = document.getElementById("editorAttr");
        if (editorAttrElement) {
            editorAttrElement.innerHTML = `.protyle-wysiwyg--attr .b3-tooltips:after { max-width: ${protyle.wysiwyg.element.clientWidth - min16 - min24}px; }`;
        }
    }
};
