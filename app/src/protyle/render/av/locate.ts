import {Constants} from "../../../constants";
import {showMessage} from "../../../dialog/message";
import {transaction} from "../../wysiwyg/transaction";
import {clearSelect} from "../../util/clear";
import {addDragFill} from "./cell";

export interface IAVLocateRequest {
    itemID: string;
    groupID?: string;
    viewID?: string;
    select?: boolean;
    previousViewID?: string;
    messageShown?: boolean;
}

const locateRequests = new WeakMap<HTMLElement, IAVLocateRequest>();
const queuedLocateRequests = new Map<string, IAVLocateRequest>();

export const queueAVLocateRequest = (blockID: string, request: IAVLocateRequest) => {
    queuedLocateRequests.set(blockID, request);
};

export const setAVLocateRequest = (blockElement: HTMLElement, request: IAVLocateRequest) => {
    locateRequests.set(blockElement, request);
};

const getAVLocateRequest = (blockElement: HTMLElement) => {
    let request = locateRequests.get(blockElement);
    if (!request) {
        request = queuedLocateRequests.get(blockElement.dataset.nodeId);
        if (request) {
            queuedLocateRequests.delete(blockElement.dataset.nodeId);
            locateRequests.set(blockElement, request);
        }
    }
    return request;
};

export const getAVLocateParams = (blockElement: HTMLElement) => {
    const request = getAVLocateRequest(blockElement);
    if (request?.viewID && request.previousViewID === undefined) {
        request.previousViewID = blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) ||
            blockElement.querySelector(".layout-tab-bar .item--focus")?.getAttribute("data-id") || "";
    }
    return request ? {
        targetItemID: request.itemID,
        targetGroupID: request.groupID || "",
        viewID: request.viewID || blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
    } : undefined;
};

export const prepareAVLocate = (blockElement: HTMLElement, data: IAV, resetData: {
    virtualData: { [key: string]: IAVVirtualData },
    pageSizes: { [key: string]: string },
}) => {
    const request = getAVLocateRequest(blockElement);
    if (!request || !data.target) {
        return;
    }
    if (data.target.status !== "visible") {
        if (!request.messageShown) {
            request.messageShown = true;
            if (data.target.status === "filtered" || data.target.status === "groupHidden") {
                showMessage(window.siyuan.languages.insertRowTip);
            } else if (data.target.status === "viewNotFound") {
                showMessage(window.siyuan.languages.databaseViewNotFound);
            } else {
                showMessage(window.siyuan.languages.databaseItemNotFound);
            }
        }
        return;
    }
    const key = data.target.groupID || "all";
    let start = Math.max(0, data.target.index - 20);
    let topSpacerHeight: number;
    if (data.viewType === "table") {
        const rowHeight = (blockElement.querySelector(".av__row[data-id]") as HTMLElement)?.offsetHeight || 36;
        topSpacerHeight = start * rowHeight;
    } else {
        const itemHeight = (blockElement.querySelector(".av__gallery-item") as HTMLElement)?.offsetHeight || 180;
        let columns = 1;
        if (data.viewType === "gallery") {
            const view = (data.target.groupID ? data.view.groups?.find(item => item.id === data.target.groupID) : data.view) as IAVGallery;
            const minWidth = view?.cardSize === 0 ? 180 : (view?.cardSize === 2 ? 320 : 260);
            columns = Math.max(1, Math.floor((blockElement.clientWidth + 16) / (minWidth + 16)));
            start -= start % columns;
        }
        topSpacerHeight = Math.floor(start / columns) * (itemHeight + 16);
    }
    resetData.virtualData[key] = {
        renderedStart: start,
        renderedEnd: data.target.index + 20,
        topSpacerHeight,
    };
    resetData.pageSizes[data.target.groupID || "unGroup"] = data.target.pageSize.toString();
};

export const finishAVLocate = (blockElement: HTMLElement, protyle: IProtyle, data: IAV) => {
    const request = getAVLocateRequest(blockElement);
    if (!request) {
        return;
    }
    const currentViewID = blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || request.previousViewID || data.viewID;
    if (data.target?.status !== "viewNotFound" && !protyle.disabled && request.viewID && request.viewID !== currentViewID) {
        blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, request.viewID);
        transaction(protyle, [{
            action: "setAttrViewBlockView",
            blockID: blockElement.dataset.nodeId,
            id: request.viewID,
            avID: blockElement.dataset.avId,
        }], [{
            action: "setAttrViewBlockView",
            blockID: blockElement.dataset.nodeId,
            id: currentViewID,
            avID: blockElement.dataset.avId,
        }]);
        return;
    }
    if (data.target?.status !== "visible") {
        locateRequests.delete(blockElement);
        return;
    }
    const groupQuery = data.target.groupID ? `.av__body[data-group-id="${data.target.groupID}"]` : ".av__body";
    const bodyElement = blockElement.querySelector(groupQuery) as HTMLElement;
    if (bodyElement?.classList.contains("fn__none")) {
        bodyElement.classList.remove("fn__none");
        bodyElement.previousElementSibling?.querySelector("[data-type=\"av-group-fold\"] svg")?.classList.add("av__group-arrow--open");
    }
    let targetElement: HTMLElement;
    if (data.viewType === "table") {
        targetElement = bodyElement?.querySelector(`.av__row[data-id="${request.itemID}"] .av__cell[data-dtype="block"]`) as HTMLElement;
        if (targetElement && request.select !== false) {
            clearSelect(["cell"], blockElement);
            targetElement.classList.add("av__cell--select");
            addDragFill(targetElement);
        }
    } else {
        targetElement = bodyElement?.querySelector(`.av__gallery-item[data-id="${request.itemID}"]`) as HTMLElement;
        if (targetElement && request.select !== false) {
            blockElement.querySelectorAll(".av__gallery-item--select").forEach(item => item.classList.remove("av__gallery-item--select"));
            targetElement.classList.add("av__gallery-item--select");
        }
    }
    if (!targetElement) {
        return;
    }
    if (data.viewType === "table" && data.target.index === 0 && !data.target.groupID) {
        const contentRect = protyle.contentElement.getBoundingClientRect();
        protyle.contentElement.scrollTop += blockElement.getBoundingClientRect().top - contentRect.top;
    } else {
        targetElement.scrollIntoView({block: "center", inline: "nearest"});
    }
    locateRequests.delete(blockElement);
};
