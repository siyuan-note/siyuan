import {transaction, turnsOneInto} from "./transaction";
import {Constants} from "../../constants";
import {openInputDialog} from "../../dialog/inputDialog";
import {focusByRange} from "../util/selectionOffsets";
import {CALLOUT_PRESETS, ICalloutPreset} from "./calloutType";

const turnBlockquoteIntoCallout = (blockElements: HTMLElement[], protyle: IProtyle,
                                 callout: Pick<ICalloutPreset, "type" | "title" | "icon">) => {
    if (blockElements.length !== 1 || blockElements[0].dataset.type !== "NodeBlockquote") {
        return false;
    }
    const nodeElement = blockElements[0];
    if (!protyle.disabled && protyle.wysiwyg.element.contains(nodeElement)) {
        void turnsOneInto({protyle, nodeElement, id: nodeElement.dataset.nodeId, type: "Blockquote2Callout", callout});
    }
    return true;
};

export const updateCalloutType = (blockElements: HTMLElement[], protyle: IProtyle, preset: ICalloutPreset) => {
    if (turnBlockquoteIntoCallout(blockElements, protyle, preset)) {
        return;
    }
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const ids = new Set<string>();
    blockElements.forEach(item => {
        const id = item.dataset.nodeId;
        if (!id || ids.has(id) || item.dataset.type !== "NodeCallout") {
            return;
        }
        ids.add(id);
        const oldHTML = item.outerHTML;
        const oldType = item.dataset.subtype || "";
        const titleElement = item.querySelector<HTMLElement>(".callout-title");
        const title = protyle.lute.BlockDOM2StdMd(titleElement.innerHTML).trim();
        item.dataset.subtype = preset.type;
        if (title.toLowerCase() === oldType.toLowerCase()) {
            titleElement.textContent = preset.title;
        }
        item.querySelector<HTMLElement>(".callout-icon").textContent = preset.icon;
        item.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
        doOperations.push({
            id,
            data: item.outerHTML,
            action: "update",
        });
        undoOperations.push({
            id,
            data: oldHTML,
            action: "update",
        });
    });
    if (doOperations.length > 0) {
        transaction(protyle, doOperations, undoOperations);
    }
};

export const updateCustomCalloutType = (blockElements: HTMLElement[], protyle: IProtyle) => {
    const range = getSelection().rangeCount > 0 ? getSelection().getRangeAt(0).cloneRange() : undefined;
    const currentType = blockElements.every(item => item.dataset.subtype === blockElements[0].dataset.subtype) ?
        blockElements[0].dataset.subtype : "";
    openInputDialog({
        title: `${window.siyuan.languages.callout} - ${window.siyuan.languages.custom}`,
        value: currentType || "",
        label: window.siyuan.languages.type,
        destroyCallback() {
            if (range && protyle.wysiwyg.element.contains(range.startContainer)) {
                focusByRange(range);
            }
        },
        onConfirm: (value, dialog) => {
            const type = value.trim();
            if (!type) {
                return;
            }
            if (turnBlockquoteIntoCallout(blockElements, protyle, {...CALLOUT_PRESETS[0], type})) {
                dialog.destroy();
                return;
            }
            const doOperations: IOperation[] = [];
            const undoOperations: IOperation[] = [];
            const ids = new Set<string>();
            blockElements.forEach(item => {
                const id = item.dataset.nodeId;
                if (!id || ids.has(id) || item.dataset.type !== "NodeCallout" || item.dataset.subtype === type) {
                    return;
                }
                ids.add(id);
                const oldHTML = item.outerHTML;
                item.dataset.subtype = type;
                item.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
                doOperations.push({id, data: item.outerHTML, action: "update"});
                undoOperations.push({id, data: oldHTML, action: "update"});
            });
            if (doOperations.length > 0) {
                transaction(protyle, doOperations, undoOperations);
            }
            dialog.destroy();
        },
    });
};
