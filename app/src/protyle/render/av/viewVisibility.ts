import {Constants} from "../../../constants";

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
