import {getContenteditableElement, getFirstBlock, getLastBlock} from "../wysiwyg/getBlock";
import {isContinuousBlockSelection} from "../wysiwyg/blockSelection";
import {hasClosestBlock, isInEmbedBlock} from "../util/hasClosest";

// 块选择的原生 Range 已折叠，插表前恢复与鼠标完整选择相同的正文范围。
export const getTableBlockSelectionRange = (editorElement: HTMLElement, selectedElements: Element[]) => {
    const elements = selectedElements.filter(element => editorElement.contains(element) &&
        !selectedElements.some(parent => parent !== element && parent.contains(element)));
    if (!isContinuousBlockSelection(elements)) {
        return undefined;
    }
    const first = getFirstBlock(elements[0]);
    const last = getLastBlock(elements[elements.length - 1]);
    const start = getContenteditableElement(first);
    const end = getContenteditableElement(last);
    if (!start || !end || isInEmbedBlock(first) || isInEmbedBlock(last) ||
        ![first, last].every(element =>
            ["NodeParagraph", "NodeHeading", "NodeCodeBlock"].includes(element.getAttribute("data-type"))) ||
        hasClosestBlock(start) !== first || hasClosestBlock(end) !== last) {
        return undefined;
    }
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.childNodes.length);
    return range;
};
