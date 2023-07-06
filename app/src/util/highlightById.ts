import {hasClosestBlock, hasClosestByAttribute} from "../protyle/util/hasClosest";
import {getEditorRange, getSelectionPosition} from "../protyle/util/selection";

const bgFade = (element: HTMLElement) => {
    element.classList.add("protyle-wysiwyg--hl");
    setTimeout(function () {
        element.classList.remove("protyle-wysiwyg--hl");
    }, 1024);
};

export const highlightById = (protyle: IProtyle, id: string, top = false) => {
    let nodeElement: HTMLElement;
    const protyleElement = protyle.wysiwyg.element;
    if (!protyle.preview.element.classList.contains("fn__none")) {
        // 预览定位
        nodeElement = document.getElementById(id);
        if (nodeElement) {
            protyle.preview.element.scrollTop = nodeElement.offsetTop;
            bgFade(nodeElement);
        }
        return undefined;
    }

    Array.from(protyleElement.querySelectorAll(`[data-node-id="${id}"]`)).find((item: HTMLElement) => {
        if (!hasClosestByAttribute(item, "data-type", "block-render", true)) {
            nodeElement = item;
            return true;
        }
    });
    if (nodeElement) {
        scrollCenter(protyle, nodeElement, top);
        bgFade(nodeElement);
        return nodeElement;// 仅配合前进后退使用
    }
    if (id === protyle.block.rootID && protyle.options.render.title) {
        bgFade(protyle.title.editElement);
        return protyle.title.editElement;
    }
};

export const scrollCenter = (protyle: IProtyle, nodeElement?: Element, top = false, behavior: ScrollBehavior = "auto") => {
    if (!top && getSelection().rangeCount > 0 && hasClosestBlock(getSelection().getRangeAt(0).startContainer)) {
        const editorElement = protyle.contentElement;
        const cursorTop = getSelectionPosition(editorElement).top - editorElement.getBoundingClientRect().top;
        let top = 0;
        if (cursorTop < 0) {
            top = editorElement.scrollTop + cursorTop;
        } else if (cursorTop > editorElement.clientHeight - 74) {   // 74 = 移动端底部 + 段落块高度
            top = editorElement.scrollTop + (cursorTop + 74 - editorElement.clientHeight);
        }
        if (top !== 0) {
            editorElement.scroll({top, behavior});
        }
        return;
    }

    if (!nodeElement) {
        nodeElement = hasClosestBlock(getEditorRange(protyle.wysiwyg.element).startContainer) as HTMLElement;
    }
    if (!nodeElement) {
        return;
    }

    let offsetTop = 0;
    let parentNodeElement = nodeElement;
    while (!parentNodeElement.classList.contains("protyle-wysiwyg")) {
        offsetTop += (parentNodeElement as HTMLElement).offsetTop;
        parentNodeElement = parentNodeElement.parentElement;
    }
    let contentTop = 0;
    let topElement = protyle.element.firstElementChild;
    while (topElement && !topElement.classList.contains("protyle-content")) {
        contentTop += topElement.clientHeight;
        topElement = topElement.nextElementSibling;
    }
    if (top) {
        protyle.contentElement.scroll({top: offsetTop - contentTop, behavior});
        return;
    }
    if (protyle.contentElement.scrollTop > offsetTop - 32) {
        protyle.contentElement.scroll({top: offsetTop - contentTop, behavior});
    } else if (protyle.contentElement.scrollTop + protyle.contentElement.clientHeight < offsetTop + nodeElement.clientHeight - contentTop) {
        protyle.contentElement.scroll({
            top: offsetTop + nodeElement.clientHeight - contentTop - protyle.contentElement.clientHeight,
            behavior
        });
    }
};
