import {getBlockOperationElements} from "./blockSelection";
import {getNextBlockSibling} from "./getBlock";
import {isInEmbedBlock} from "../util/hasClosest";
import {getBlockElementsByRange, getUndoFocusContext, restoreFocusContext} from "../util/selection";
import {insertEmptyCallout, turnsIntoGroupsTransaction, turnsIntoOneTransaction, turnsOneInto} from "./transaction";
import {updateCalloutType} from "./callout";
import type {ICalloutPreset} from "./calloutType";

export const handleCalloutShortcut = async (protyle: IProtyle, nodeElement: HTMLElement, range: Range,
                                          preset: ICalloutPreset, selectionModeElement?: HTMLElement) => {
    if (isInEmbedBlock(nodeElement)) {
        return;
    }
    const rangeElements = !range.collapsed && range.toString() !== "" ? getBlockElementsByRange(range) : [];
    if (rangeElements.length > 1 && !rangeElements.some(item => item.classList.contains("li"))) {
        const groups: Element[][] = [];
        rangeElements.forEach(item => {
            const group = groups[groups.length - 1];
            const previous = group?.[group.length - 1];
            if (previous?.parentElement === item.parentElement && getNextBlockSibling(previous) === item) {
                group.push(item);
            } else {
                groups.push([item]);
            }
        });
        const focusContext = getUndoFocusContext(protyle.wysiwyg.element, range, true);
        await turnsIntoGroupsTransaction({protyle, selectsElementGroups: groups, type: "Blocks2Callout", callout: preset});
        if (focusContext) {
            restoreFocusContext(protyle, focusContext);
        }
        return;
    }
    const selected = getBlockOperationElements(protyle.wysiwyg.element, selectionModeElement);
    const hasBlockSelection = selected.length > 0;
    if (!hasBlockSelection) {
        selected.push(nodeElement);
    }
    if (selected.length > 1) {
        if (selected.some((item, index) => item.classList.contains("li") ||
            index > 0 && getNextBlockSibling(selected[index - 1]) !== item)) {
            return;
        }
        await turnsIntoOneTransaction({protyle, selectsElement: selected, type: "Blocks2Callout", callout: preset});
        return;
    }
    const target = selected[0];
    let callout = target;
    if (!hasBlockSelection) {
        while (callout && callout !== protyle.wysiwyg.element && callout.dataset.type !== "NodeCallout") {
            callout = callout.parentElement;
        }
    }
    if (callout?.dataset.type === "NodeCallout" && callout !== protyle.wysiwyg.element) {
        if (callout.dataset.subtype !== preset.type) {
            updateCalloutType([callout], protyle, preset);
            return;
        }
        const content = callout.querySelector<HTMLElement>(":scope > .callout-content");
        const children = Array.from(content.children).filter(item => item.hasAttribute("data-node-id"));
        let child = target;
        while (child.parentElement && child.parentElement !== content && child !== callout) {
            child = child.parentElement;
        }
        if (hasBlockSelection || target === callout || children.length === 1 && child.getAttribute("fold") !== "1") {
            if (!hasBlockSelection) {
                const focusRange = range.cloneRange();
                focusRange.collapse(true);
                focusRange.insertNode(document.createElement("wbr"));
            }
            await turnsOneInto({protyle, nodeElement: callout, id: callout.dataset.nodeId, type: "CancelCallout"});
        } else {
            insertEmptyCallout(protyle, child, preset);
        }
    } else if (target.dataset.type === "NodeBlockquote") {
        updateCalloutType([target], protyle, preset);
    } else if (["NodeHeading", "NodeParagraph", "NodeList"].includes(target.dataset.type)) {
        await turnsIntoOneTransaction({protyle, selectsElement: selected, type: "Blocks2Callout", callout: preset});
    } else {
        protyle.hint.fillCommand(`> [!${preset.type}]\n> ${Lute.Caret}`, protyle);
    }
};
