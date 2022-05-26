import {setEditMode} from "../util/setEditMode";
import {lineNumberRender} from "../markdown/highlightRender";
import {scrollEvent} from "../scroll/event";
import {isMobile} from "../../util/functions";

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
    const min16 = protyle.element.clientWidth > 888 ? 96 : 16;
    const min24 = protyle.element.clientWidth > 888 ? 96 : 24;
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
    if (window.siyuan.config.editor.codeSyntaxHighlightLineNum) {
        protyle.wysiwyg.element.querySelectorAll('.code-block [contenteditable="true"]').forEach((block: HTMLElement) => {
            lineNumberRender(block);
        });
    }
};
