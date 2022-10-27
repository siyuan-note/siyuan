import {hasClosestBlock} from "../util/hasClosest";
import {focusByOffset, getSelectionOffset} from "../util/selection";
import {fetchPost} from "../../util/fetch";
import {zoomOut} from "../../menus/protyle";
import {preventScroll} from "./preventScroll";
import {pushBack} from "../../util/backForward";
import {processRender} from "../util/processCode";
import {highlightRender} from "../markdown/highlightRender";
import {blockRender} from "../markdown/blockRender";
import {disabledForeverProtyle, disabledProtyle, enableProtyle} from "../util/onGet";

export const saveScroll = (protyle: IProtyle, getObject = false) => {
    if (!protyle.wysiwyg.element.firstElementChild) {
        // 报错或者空白页面
        return undefined;
    }
    const attr: IScrollAttr = {
        startId: protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-id"),
        endId: protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id"),
        scrollTop: protyle.contentElement.scrollTop || parseInt(protyle.contentElement.getAttribute("data-scrolltop")) || 0,
    };
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0);
    }
    if (!range || !protyle.wysiwyg.element.contains(range.startContainer)) {
        range = protyle.toolbar.range;
    }
    if (range && protyle.wysiwyg.element.contains(range.startContainer)) {
        const blockElement = hasClosestBlock(range.startContainer);
        if (blockElement) {
            const position = getSelectionOffset(blockElement, undefined, range);
            attr.focusId = blockElement.getAttribute("data-node-id");
            attr.focusStart = position.start;
            attr.focusEnd = position.end;
        }
    }

    if (protyle.block.showAll) {
        attr.zoomInId = protyle.block.id;
    }
    if (getObject) {
        return attr;
    }
    const jsonAttr = JSON.stringify(attr);
    fetchPost("/api/attr/setBlockAttrs", {id: protyle.block.rootID, attrs: {scroll: jsonAttr}}, () => {
        protyle.wysiwyg.element.setAttribute("scroll", jsonAttr);
    });
};

export const restoreScroll = (protyle: IProtyle, scrollAttr: IScrollAttr) => {
    preventScroll(protyle);
    if (protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-id") === scrollAttr.startId &&
        protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id") === scrollAttr.endId) {
        // 需等动画效果完毕，才能获得最大高度。否则尾部定位无法滚动到底部
        setTimeout(() => {
            protyle.contentElement.scrollTop = scrollAttr.scrollTop;
        }, 256);
        if (scrollAttr.focusId) {
            const range = focusByOffset(protyle.wysiwyg.element.querySelector(`[data-node-id="${scrollAttr.focusId}"]`), scrollAttr.focusStart, scrollAttr.focusEnd);
            /// #if !MOBILE
            pushBack(protyle, range || undefined);
            /// #endif
        }
    } else if (scrollAttr.zoomInId && protyle.block.id !== scrollAttr.zoomInId) {
        fetchPost("/api/block/checkBlockExist", {id: scrollAttr.zoomInId}, existResponse => {
            if (existResponse.data) {
                zoomOut(protyle, scrollAttr.zoomInId, undefined, true, () => {
                    protyle.contentElement.scrollTop = scrollAttr.scrollTop;
                    if (scrollAttr.focusId) {
                        focusByOffset(protyle.wysiwyg.element.querySelector(`[data-node-id="${scrollAttr.focusId}"]`), scrollAttr.focusStart, scrollAttr.focusEnd);
                    }
                });
            }
        });
    } else if (!protyle.scroll.element.classList.contains("fn__none")) {
        fetchPost("/api/filetree/getDoc", {
            id: protyle.block.id,
            startID: scrollAttr.startId,
            endID: scrollAttr.endId,
        }, getResponse => {
            protyle.block.showAll = false;
            protyle.wysiwyg.element.innerHTML = getResponse.data.content;
            processRender(protyle.wysiwyg.element);
            highlightRender(protyle.wysiwyg.element);
            blockRender(protyle, protyle.wysiwyg.element);
            if (getResponse.data.isSyncing) {
                disabledForeverProtyle(protyle);
            } else {
                if (protyle.disabled) {
                    disabledProtyle(protyle);
                } else {
                    enableProtyle(protyle);
                }
            }
            protyle.contentElement.scrollTop = scrollAttr.scrollTop;
            if (scrollAttr.focusId) {
                const range = focusByOffset(protyle.wysiwyg.element.querySelector(`[data-node-id="${scrollAttr.focusId}"]`), scrollAttr.focusStart, scrollAttr.focusEnd);
                /// #if !MOBILE
                pushBack(protyle, range || undefined);
                /// #endif
            }
        });
    } else if (scrollAttr.scrollTop) {
        protyle.contentElement.scrollTop = scrollAttr.scrollTop;
    }
};
