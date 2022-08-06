import {Constants} from "../../constants";
import {hasClosestBlock} from "../util/hasClosest";
import {focusByOffset, getSelectionOffset} from "../util/selection";
import {fetchPost} from "../../util/fetch";
import {zoomOut} from "../../menus/protyle";

export const saveScroll = (protyle: IProtyle) => {
    if (protyle.contentElement.clientHeight === protyle.contentElement.scrollHeight) {
        return;
    }
    let attr = `${protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-id")}${Constants.ZWSP}${protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id")}${Constants.ZWSP}${protyle.contentElement.scrollTop}`;
    let range: Range
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0)
    }

    if (range && protyle.wysiwyg.element.contains(range.startContainer)) {
        const blockElement = hasClosestBlock(range.startContainer);
        if (blockElement) {
            const position = getSelectionOffset(blockElement, undefined, range);
            attr += `${Constants.ZWSP}${blockElement.getAttribute("data-node-id")}${Constants.ZWSP}${position.start}${Constants.ZWSP}${position.end}`;
        }
    }
    if (protyle.block.showAll) {
        attr += `${Constants.ZWSP}${protyle.block.id}`;
    }

    fetchPost("/api/attr/setBlockAttrs", {id: protyle.block.rootID, attrs: {scroll: attr}}, () => {
        protyle.wysiwyg.element.setAttribute("scroll", attr);
    });
}

export const restoreScroll = (protyle: IProtyle) => {
    const attr = protyle.wysiwyg.element.getAttribute("scroll")
    if (!attr) {
        return
    }
    const [startId, endId, scrollTop, focusId, focusStart, focusEnd, zoomInId] = attr.split(Constants.ZWSP);
    if (protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-id") === startId &&
        protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id") === endId) {
        protyle.contentElement.scrollTop = parseInt(scrollTop);
        focusByOffset(protyle.wysiwyg.element.querySelector(`[data-node-id="${focusId}"]`), parseInt(focusStart), parseInt(focusEnd));
    } else if (zoomInId && protyle.block.id !== zoomInId) {
        zoomOut(protyle, zoomInId, undefined, false, () => {
            protyle.contentElement.scrollTop = parseInt(scrollTop);
            focusByOffset(protyle.wysiwyg.element.querySelector(`[data-node-id="${focusId}"]`), parseInt(focusStart), parseInt(focusEnd));
        });
    } else if (!protyle.scroll.element.classList.contains("fn__none")) {
        fetchPost("/api/filetree/getDoc", {
            id: protyle.block.id,
            startID: startId,
            endID: endId,
        }, getResponse => {
            protyle.wysiwyg.element.innerHTML = getResponse.data.content;
            protyle.contentElement.scrollTop = parseInt(scrollTop);
            focusByOffset(protyle.wysiwyg.element.querySelector(`[data-node-id="${focusId}"]`), parseInt(focusStart), parseInt(focusEnd));
        })
    }
}
