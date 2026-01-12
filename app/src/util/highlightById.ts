import {hasClosestBlock, isInEmbedBlock} from "../protyle/util/hasClosest";
import {focusByRange, getEditorRange} from "../protyle/util/selection";

export const bgFade = (element: Element) => {
    element.classList.add("protyle-wysiwyg--hl");
    setTimeout(function () {
        element.classList.remove("protyle-wysiwyg--hl");
    }, 1024);
};

export const highlightById = (protyle: IProtyle, id: string, position: ScrollLogicalPosition = "nearest") => {
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
        if (!isInEmbedBlock(item)) {
            nodeElement = item;
            return true;
        }
    });
    if (nodeElement) {
        scrollCenter(protyle, nodeElement, position);
        bgFade(nodeElement);
        return nodeElement;// 仅配合前进后退使用
    }
    if (id === protyle.block.rootID && protyle.options.render.title && protyle.title.editElement) {
        bgFade(protyle.title.editElement);
        return protyle.title.editElement;
    }
};

export const scrollCenter = (
    protyle: IProtyle,
    nodeElement?: Element,
    position: ScrollLogicalPosition = "nearest",
    behavior: ScrollBehavior = "auto"
) => {
    if (!protyle.disabled && !nodeElement && getSelection().rangeCount > 0) {
        const range = getSelection().getRangeAt(0);
        const blockElement = hasClosestBlock(range.startContainer);
        if (blockElement) {
            // https://github.com/siyuan-note/siyuan/issues/10769
            if (blockElement.classList.contains("code-block")) {
                const brElement = document.createElement("br");
                range.insertNode(brElement);
                brElement.scrollIntoView({block: position, behavior});
                brElement.remove();
                return;
            }

            if (blockElement.classList.contains("av") && blockElement.dataset.render === "true") {
                // undo 时禁止数据库滚动
                if (blockElement.querySelector(".av__row--header")?.getAttribute("style")?.indexOf("transform") > -1 ||
                    blockElement.querySelector(".av__row--footer")?.getAttribute("style")?.indexOf("transform") > -1) {
                    return;
                }
                const activeElement = blockElement.querySelector(".av__cell--select, .av__row--select, .av__gallery-item--select");
                if (activeElement) {
                    activeElement.scrollIntoView({block: position, behavior});
                } else {
                    blockElement.scrollIntoView({block: position, behavior});
                }
                return;
            }
            // 撤销时 br 插入删除会导致 rang 被修改 https://github.com/siyuan-note/siyuan/issues/12679
            const cloneRange = range.cloneRange();
            const br2Element = document.createElement("br");
            range.insertNode(br2Element);
            const editorElement = protyle.contentElement;
            const cursorTop = br2Element.getBoundingClientRect().top - editorElement.getBoundingClientRect().top;
            let scrollTop = 0;
            if (cursorTop < 0) {
                scrollTop = editorElement.scrollTop + cursorTop;
            } else if (cursorTop > editorElement.clientHeight - 74) {   // 74 = 移动端底部 + 段落块高度
                scrollTop = editorElement.scrollTop + (cursorTop + 74 - editorElement.clientHeight);
            }
            if (scrollTop !== 0) {
                editorElement.scroll({top: scrollTop, behavior});
            }
            br2Element.remove();
            focusByRange(cloneRange);
            return;
        }
    }

    if (!nodeElement &&
        // https://github.com/siyuan-note/siyuan/issues/11175
        document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") {
        nodeElement = hasClosestBlock(getEditorRange(protyle.wysiwyg.element).startContainer) as HTMLElement;
    }
    if (!nodeElement) {
        return;
    }
    const elementRect = nodeElement.getBoundingClientRect();
    const contentRect = protyle.contentElement.getBoundingClientRect();
    if (position === "start") {
        protyle.contentElement.scroll({
            top: protyle.contentElement.scrollTop + elementRect.top - contentRect.top - (window.siyuan.config.editor.fontSize * 1.625 * 2 + 24),
            behavior
        });
        return;
    }
    if (position === "nearest") {
        // 在可视区域内不进行滚动
        if (elementRect.bottom < contentRect.top) {
            protyle.contentElement.scroll({
                top: protyle.contentElement.scrollTop + elementRect.top - contentRect.top,
                behavior
            });
        } else if (elementRect.top > contentRect.bottom) {
            protyle.contentElement.scroll({
                top: elementRect.height > contentRect.height ? protyle.contentElement.scrollTop + elementRect.top - contentRect.top :
                    protyle.contentElement.scrollTop + elementRect.bottom - contentRect.bottom,
                behavior
            });
        }
        return;
    }
    if (position === "center") {
        protyle.contentElement.scroll({
            top: protyle.contentElement.scrollTop + elementRect.top - (contentRect.top + contentRect.height / 2),
            behavior
        });
    }
};
