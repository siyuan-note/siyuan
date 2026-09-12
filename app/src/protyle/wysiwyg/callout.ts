import {transaction} from "./transaction";
import {Constants} from "../../constants";
import {openInputDialog} from "../../dialog/inputDialog";
import {focusByRange} from "../util/selection";

export interface ICalloutPreset {
    id: string;
    icon: string;
    type: string;
    title: string;
    color: string;
}

export const CALLOUT_PRESETS: ICalloutPreset[] = [{
    id: "calloutNote",
    icon: "✏️",
    type: "NOTE",
    title: "Note",
    color: "var(--b3-callout-note)",
}, {
    id: "calloutTip",
    icon: "💡",
    type: "TIP",
    title: "Tip",
    color: "var(--b3-callout-tip)",
}, {
    id: "calloutImportant",
    icon: "❗",
    type: "IMPORTANT",
    title: "Important",
    color: "var(--b3-callout-important)",
}, {
    id: "calloutWarning",
    icon: "⚠️",
    type: "WARNING",
    title: "Warning",
    color: "var(--b3-callout-warning)",
}, {
    id: "calloutCaution",
    icon: "🚨",
    type: "CAUTION",
    title: "Caution",
    color: "var(--b3-callout-caution)",
}];

export const updateCalloutType = (blockElements: HTMLElement[], protyle: IProtyle, preset: ICalloutPreset) => {
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
