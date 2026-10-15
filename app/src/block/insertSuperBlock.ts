import {genEmptyElement, genSBElement, refreshSbAndPersistWidth, refreshSbResize} from "./util";
import {transaction, turnsIntoOneTransaction} from "../protyle/wysiwyg/transaction";
import {focusByWbr, getEditorRange, getUndoFocusContext} from "../protyle/util/selection";
import {hideElements} from "../protyle/ui/hideElements";
import {scrollCenter} from "../util/highlightById";
import {isMobile} from "../util/functions";
import {restoreEditorFocusRange} from "../protyle/util/editorFocus";
import {callMobileAppShowKeyboard} from "../mobile/util/mobileAppUtil";
import {setFold} from "../protyle/util/blockFold";
import {getSuperBlockTailHeadings} from "./superBlock";
import {fetchSyncPost} from "../util/fetch";
import {normalizeHTMLAssetIFrameBlockDOM} from "../asset/html";

export const genEmptySuperBlock = (layout: "col" | "row", source?: Element) => {
    const element = genSBElement(layout, source?.getAttribute("data-node-id"), source?.lastElementChild.outerHTML);
    if (source) {
        // 空段落转换后保留块标识、自定义属性和外层布局宽度。
        Array.from(source.attributes).forEach(attribute => {
            if (!["class", "data-type", "data-node-id", "data-node-index", "data-subtype"].includes(attribute.name)) {
                element.setAttribute(attribute.name, attribute.value);
            }
        });
    }
    element.prepend(genEmptyElement(false, true), genEmptyElement(false, false));
    refreshSbResize(element);
    return element;
};

const focusInsertedBlock = (protyle: IProtyle, range: Range) => {
    const insertedRange = focusByWbr(protyle.wysiwyg.element, range);
    scrollCenter(protyle);
    if (isMobile() && insertedRange && restoreEditorFocusRange(protyle.wysiwyg.element, insertedRange)) {
        callMobileAppShowKeyboard();
    }
};

export const insertSuperBlockChild = async (protyle: IProtyle, target: Element, position: "start" | "end") => {
    if (protyle.disabled || !protyle.wysiwyg.element.contains(target) ||
        target.getAttribute("data-type") !== "NodeSuperBlock") {
        return;
    }
    const range = getEditorRange(protyle.wysiwyg.element);
    const context = getUndoFocusContext(protyle.wysiwyg.element, range);
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    if (position === "end" && target.querySelector(':scope > [data-type="NodeHeading"][fold="1"]')) {
        // 完整内容用于识别被折叠父标题隐藏的末尾标题，不用局部 DOM 覆盖文档。
        const response = await fetchSyncPost("/api/block/getBlockDOM", {
            id: target.getAttribute("data-node-id"), notebook: protyle.notebookId,
        });
        if (response.code !== 0) {
            throw new Error(response.msg);
        }
        const template = document.createElement("template");
        template.innerHTML = normalizeHTMLAssetIFrameBlockDOM(response.data.dom);
        const fullElement = template.content.querySelector(`[data-node-id="${target.getAttribute("data-node-id")}"]`);
        if (!fullElement || protyle.disabled || !protyle.wysiwyg.element.contains(target)) {
            return;
        }
        for (const heading of getSuperBlockTailHeadings(fullElement)) {
            const id = heading.getAttribute("data-node-id");
            const visibleHeading = target.querySelector(`[data-node-id="${id}"]`);
            if (visibleHeading) {
                const operations = setFold(protyle, visibleHeading, true, false, true);
                await operations.ready;
                doOperations.push(...operations.doOperations);
                undoOperations.unshift(...operations.undoOperations);
            } else {
                doOperations.push({action: "unfoldHeading", id});
                undoOperations.unshift({action: "foldHeading", id});
            }
        }
    }
    const foldData = target.getAttribute("fold") === "1" ? setFold(protyle, target, true, false, true) : undefined;
    if (foldData) {
        await foldData.ready;
        doOperations.push(...foldData.doOperations);
        undoOperations.unshift(...foldData.undoOperations);
    }
    hideElements(["select", "gutter"], protyle);
    protyle.observerLoad?.disconnect();
    const newElement = genEmptyElement(false, true);
    const id = newElement.getAttribute("data-node-id");
    // 由容器定位首尾，末尾存在折叠标题时也不会插入到隐藏子块之前。
    doOperations.push({
        action: position === "start" ? "prependInsert" : "appendInsert",
        id,
        parentID: target.getAttribute("data-node-id"),
        data: newElement.outerHTML,
    });
    undoOperations.unshift({action: "delete", id, context});
    if (position === "start") {
        target.prepend(newElement);
    } else {
        target.lastElementChild.before(newElement);
    }
    refreshSbAndPersistWidth(target, doOperations, undoOperations);
    transaction(protyle, doOperations, undoOperations);
    focusInsertedBlock(protyle, range);
};

export const createSuperBlockColumn = async (protyle: IProtyle, target: Element, position: "left" | "right") => {
    if (protyle.disabled || !protyle.wysiwyg.element.contains(target) ||
        target.parentElement?.getAttribute("data-type") !== "NodeSuperBlock" ||
        target.parentElement.getAttribute("data-sb-layout") !== "row") {
        return;
    }
    const range = getEditorRange(protyle.wysiwyg.element);
    const context = getUndoFocusContext(protyle.wysiwyg.element, range);
    hideElements(["select", "gutter"], protyle);
    protyle.observerLoad?.disconnect();
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    let column = target;
    // 折叠标题及其隐藏子块属于同一栏，先用纵向容器承接内核随标题移动的内容。
    if (target.getAttribute("data-type") === "NodeHeading" && target.getAttribute("fold") === "1") {
        const operations = await turnsIntoOneTransaction({
            protyle, selectsElement: [target], type: "BlocksMergeSuperBlock", level: "row",
            getOperations: true, unfocus: true,
        });
        doOperations.push(...operations.doOperations);
        undoOperations.push(...operations.undoOperations);
        column = target.parentElement;
    }
    const operations = await turnsIntoOneTransaction({
        protyle, selectsElement: [column], type: "BlocksMergeSuperBlock", level: "col",
        getOperations: true, unfocus: true,
    });
    doOperations.push(...operations.doOperations);
    undoOperations.unshift(...operations.undoOperations);
    const newElement = genEmptyElement(false, true);
    const id = newElement.getAttribute("data-node-id");
    doOperations.push({
        action: "insert",
        id,
        data: newElement.outerHTML,
        parentID: column.parentElement.getAttribute("data-node-id"),
        nextID: position === "left" ? column.getAttribute("data-node-id") : undefined,
        previousID: position === "right" ? column.getAttribute("data-node-id") : undefined,
    });
    undoOperations.unshift({action: "delete", id, context});
    column.insertAdjacentElement(position === "left" ? "beforebegin" : "afterend", newElement);
    refreshSbAndPersistWidth(column.parentElement, doOperations, undoOperations);
    transaction(protyle, doOperations, undoOperations);
    focusInsertedBlock(protyle, range);
};
