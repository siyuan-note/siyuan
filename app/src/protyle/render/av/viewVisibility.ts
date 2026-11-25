import {Constants} from "../../../constants";

export const getAVCurrentViewID = (blockElement: Element) => {
    return blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) ||
        blockElement.querySelector(".av__header")?.getAttribute("data-current-view-id") ||
        blockElement.querySelector(".layout-tab-bar .item--focus")?.getAttribute("data-id") ||
        "";
};

export const getAVVisibleViewIDs = (blockElement: Element, views: IAVView[] | string[]) => {
    const viewIDs = views.map((view) => typeof view === "string" ? view : view.id);
    const value = blockElement.getAttribute(Constants.CUSTOM_SY_AV_VISIBLE_VIEWS)?.trim();
    if (!value) {
        return viewIDs;
    }

    const configured = new Set(value.split(",").map((viewID) => viewID.trim()).filter(Boolean));
    const visibleViewIDs = viewIDs.filter((viewID) => configured.has(viewID));
    if (visibleViewIDs.length === 0 && viewIDs.length > 0) {
        visibleViewIDs.push(viewIDs[0]);
    }
    return visibleViewIDs;
};

export const filterPastedAVViewTabs = (blockElement: Element) => {
    const header = blockElement.querySelector(":scope > .av__container > .av__header");
    const allViewIDs = header?.getAttribute("data-view-ids")?.split(",").filter(Boolean);
    if (!allViewIDs?.length) {
        return;
    }
    const visibleViewIDs = new Set(getAVVisibleViewIDs(blockElement, allViewIDs));
    header.querySelectorAll(".av__views > .layout-tab-bar > .item[data-id]").forEach(tab => {
        if (!visibleViewIDs.has(tab.getAttribute("data-id"))) {
            tab.remove();
        }
    });
};

export const setAVVisibleViewIDs = (blockElement: Element, viewIDs: string[]) => {
    blockElement.setAttribute(Constants.CUSTOM_SY_AV_VISIBLE_VIEWS, viewIDs.join(","));
};

export const updateAVVisibleViews = (blockElement: Element, allViewIDs: string[], oldViewIDs: string[], viewIDs: string[]) => {
    const avID = blockElement.getAttribute("data-av-id");
    const blockID = blockElement.getAttribute("data-node-id");
    const operations: IOperation[] = [{action: "setAttrViewBlockVisibleViews", avID, blockID, viewIDs}];
    const undoOperations: IOperation[] = [{action: "setAttrViewBlockVisibleViews", avID, blockID, viewIDs: oldViewIDs}];
    const current = getAVCurrentViewID(blockElement);
    if (oldViewIDs.includes(current) && !viewIDs.includes(current)) {
        const index = allViewIDs.indexOf(current);
        const visible = new Set(viewIDs);
        const next = allViewIDs.slice(0, index).reverse().find(id => visible.has(id)) ||
            allViewIDs.slice(index + 1).find(id => visible.has(id));
        if (next) {
            operations.push({action: "setAttrViewBlockView", avID, blockID, id: next});
            undoOperations.push({action: "setAttrViewBlockView", avID, blockID, id: current});
            blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, next);
        }
    }
    setAVVisibleViewIDs(blockElement, viewIDs);
    return {operations, undoOperations};
};

export const getAVVisibleViewIDsAfterHidingAll = (visibleViewIDs: string[], currentViewID: string) => {
    if (visibleViewIDs.length === 0) {
        return [];
    }
    return [visibleViewIDs.includes(currentViewID) ? currentViewID : visibleViewIDs[0]];
};

export const serializeAVViewPageSizes = (views: IAVView[]) => JSON.stringify(
    Object.fromEntries(views.map((view) => [view.id, view.pageSize]))
);

export const getAVViewPageSize = (value: string | null | undefined, viewID: string) => {
    try {
        const pageSize = JSON.parse(value || "{}")[viewID];
        return typeof pageSize === "number" ? pageSize.toString() : undefined;
    } catch {
        return undefined;
    }
};
