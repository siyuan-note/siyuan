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

export const setAVVisibleViewIDs = (blockElement: Element, viewIDs: string[]) => {
    blockElement.setAttribute(Constants.CUSTOM_SY_AV_VISIBLE_VIEWS, viewIDs.join(","));
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
