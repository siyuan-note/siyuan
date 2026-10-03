import {getTabContent, getTabItems, getTabTask, getTabTitle} from "../render/tabsRender";
import {Constants} from "../../constants";

export const canFocusTabItem = (protyle: IProtyle, item: Element) => !protyle.lite &&
    !protyle.options.backlinkData && !protyle.element.closest(".block__popover") &&
    !protyle.options.action.includes(Constants.CB_GET_HISTORY) &&
    !item.closest(".protyle-wysiwyg__embed, .mindmap-view__preview-block") &&
    item.closest(".protyle-wysiwyg") === protyle.wysiwyg.element;

export const getFocusedTabItem = (protyle: IProtyle) => {
    const root = protyle.wysiwyg.element;
    if (!protyle.block.showAll || !canFocusTabItem(protyle, root)) {
        return undefined;
    }
    for (const block of Array.from(root.children)) {
        if (block.classList.contains("tab-item") && block.getAttribute("data-node-id") === protyle.block.id) {
            return block as HTMLElement;
        }
        if (block.classList.contains("tabs")) {
            const item = getTabItems(block).find(item => item.dataset.nodeId === protyle.block.id);
            if (item) {
                return item;
            }
        }
    }
};

// 聚焦编辑器只保留目标项，块选择和事务沿用该项的 ID，不影响文档中的同组页签。
export const prepareFocusedTabItem = (protyle: IProtyle) => {
    const item = getFocusedTabItem(protyle);
    if (!item) {
        return;
    }
    const root = protyle.wysiwyg.element;
    if (item.parentElement !== root || root.children.length !== 1) {
        const task = getTabTask(item);
        if (task !== null) {
            item.setAttribute("tabs-task", task);
        }
        root.replaceChildren(item);
        item.removeAttribute("data-tabs-hidden");
        const info = item.querySelector<HTMLElement>(":scope > .tab-item-info");
        info?.classList.remove("tabs-title-editor");
        info?.removeAttribute("style");
    }
    const content = getTabContent(item);
    ["id", "role", "aria-labelledby", "tabindex"].forEach(name => content?.removeAttribute(name));
    getTabTitle(item)?.setAttribute("contenteditable", String(!protyle.disabled));
};
