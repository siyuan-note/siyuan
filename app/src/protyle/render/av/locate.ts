import {Constants} from "../../../constants";
import {showMessage} from "../../../dialog/message";
import {transaction} from "../../wysiwyg/transaction";
import {clearSelect} from "../../util/clear";
import {addDragFill} from "./cell";
import {scrollCenter} from "../../../util/highlightById";

export interface IAVLocateRequest {
    itemID: string;
    groupID?: string;
    viewID?: string;
    select?: boolean;
    highlight?: boolean;
    persistView?: boolean;
    previousViewID?: string;
    messageShown?: boolean;
}

const locateRequests = new WeakMap<HTMLElement, IAVLocateRequest>();
const locateQueueTimeout = 30000;
const locateRenderSize = 200;
const queuedLocateRequests = new Map<string, {
    request: IAVLocateRequest,
    timer: number,
    activationToken?: symbol,
}>();
const renderTokens = new WeakMap<HTMLElement, symbol>();
const renderedAVData = new WeakMap<HTMLElement, IAV>();
const highlightTokens = new WeakMap<HTMLElement, symbol>();
const highlightStates = new WeakMap<HTMLElement, {element: HTMLElement, className: string, timer: number}>();

const clearLocatedHighlight = (blockElement: HTMLElement) => {
    highlightTokens.delete(blockElement);
    const state = highlightStates.get(blockElement);
    if (!state) {
        return;
    }
    window.clearTimeout(state.timer);
    state.element.classList.remove(state.className);
    highlightStates.delete(blockElement);
};

const highlightLocatedItem = (blockElement: HTMLElement, protyle: IProtyle, viewType: TAVView,
                              groupQuery: string, itemID: string) => {
    clearLocatedHighlight(blockElement);
    const token = Symbol();
    highlightTokens.set(blockElement, token);
    const className = viewType === "table" ? "av__row--locate" : "av__gallery-item--locate";
    const targetQuery = viewType === "table" ? `.av__row[data-id="${itemID}"]` : `.av__gallery-item[data-id="${itemID}"]`;
    requestAnimationFrame(() => {
        if (!blockElement.isConnected || highlightTokens.get(blockElement) !== token) {
            return;
        }
        const targetElement = blockElement.querySelector(groupQuery)?.querySelector(targetQuery) as HTMLElement;
        if (!targetElement) {
            highlightTokens.delete(blockElement);
            return;
        }
        blockElement.querySelectorAll(`.${className}`).forEach(item => item.classList.remove(className));
        if (viewType === "table") {
            protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl, .av__row--hl").forEach(item => {
                item.classList.remove("protyle-wysiwyg--hl", "av__row--hl");
            });
        }
        targetElement.classList.add(className);
        const timer = window.setTimeout(() => {
            targetElement.classList.remove(className);
            if (highlightStates.get(blockElement)?.timer === timer) {
                highlightStates.delete(blockElement);
            }
            if (highlightTokens.get(blockElement) === token) {
                highlightTokens.delete(blockElement);
            }
        }, 1024);
        highlightStates.set(blockElement, {element: targetElement, className, timer});
    });
};

export const beginAVRender = (blockElement: HTMLElement) => {
    const token = Symbol();
    renderTokens.set(blockElement, token);
    return token;
};

export const isCurrentAVRender = (blockElement: HTMLElement, token: symbol) => {
    return renderTokens.get(blockElement) === token;
};

const getLocalAVLocateData = (data: IAV | undefined, request: IAVLocateRequest) => {
    if (!data || (request.viewID && request.viewID !== data.viewID)) {
        return;
    }
    const findTarget = (view: IAVTable | IAVGallery | IAVKanban, groupID = "") => {
        const items = data.viewType === "table" ? (view as IAVTable).rows : (view as IAVGallery | IAVKanban).cards;
        const localIndex = items?.findIndex(item => item.id === request.itemID) ?? -1;
        if (localIndex < 0) {
            return;
        }
        const offset = data.target?.status === "visible" && (data.target.groupID || "") === groupID ? data.target.offset : 0;
        return {
            status: "visible" as const,
            itemID: request.itemID,
            groupID: groupID || undefined,
            index: offset + localIndex,
            offset,
            pageSize: view.pageSize,
        };
    };
    const view = data.view as IAVTable | IAVGallery | IAVKanban;
    let target: IAVRenderTarget | undefined;
    if (view.groups?.length > 0) {
        const groups = request.groupID ? [
            ...view.groups.filter(group => group.id === request.groupID),
            ...view.groups.filter(group => group.id !== request.groupID),
        ] : view.groups;
        for (const group of groups as Array<IAVTable | IAVGallery | IAVKanban>) {
            target = findTarget(group, group.id);
            if (target) {
                break;
            }
        }
    } else {
        target = findTarget(view);
    }
    if (!target) {
        return;
    }
    return {...data, target};
};

export const queueAVLocateRequest = (blockID: string, request: IAVLocateRequest) => {
    const previous = queuedLocateRequests.get(blockID);
    if (previous) {
        window.clearTimeout(previous.timer);
    }
    const locateRequest = {...request, select: true, highlight: true};
    const timer = window.setTimeout(() => {
        if (queuedLocateRequests.get(blockID)?.request === locateRequest) {
            queuedLocateRequests.delete(blockID);
        }
    }, locateQueueTimeout);
    queuedLocateRequests.set(blockID, {request: locateRequest, timer});
};

export const activateAVLocate = (protyle: IProtyle, blockID: string, request?: IAVLocateRequest) => {
    const blockElement = protyle?.wysiwyg.element.querySelector(`.av[data-node-id="${blockID}"]`) as HTMLElement;
    if (!request || !blockElement || blockElement.getAttribute("data-render") !== "true") {
        return false;
    }
    clearLocatedHighlight(blockElement);
    locateRequests.set(blockElement, request);
    blockElement.removeAttribute("data-render");
    const localData = getLocalAVLocateData(renderedAVData.get(blockElement), request);
    import("./render").then(({avRender}) => avRender(blockElement, protyle, undefined, true, localData));
    return true;
};

export const activateAVLocateWithRetry = (protyle: IProtyle, blockID: string, request: IAVLocateRequest) => {
    const timeout = performance.now() + locateQueueTimeout;
    const retry = () => {
        if (activateAVLocate(protyle, blockID, request)) {
            return;
        }
        if (protyle.element.isConnected && performance.now() < timeout) {
            window.setTimeout(retry, 50);
        }
    };
    retry();
};

export const activateQueuedAVLocate = (protyle: IProtyle, blockID: string) => {
    const queued = queuedLocateRequests.get(blockID);
    if (!queued || !protyle) {
        return false;
    }
    const clearQueued = () => {
        window.clearTimeout(queued.timer);
        if (queuedLocateRequests.get(blockID) === queued) {
            queuedLocateRequests.delete(blockID);
        }
    };
    if (activateAVLocate(protyle, blockID, queued.request)) {
        clearQueued();
        return true;
    }
    const activationToken = Symbol();
    queued.activationToken = activationToken;
    const timeout = performance.now() + locateQueueTimeout;
    const retry = () => {
        if (queuedLocateRequests.get(blockID) !== queued || queued.activationToken !== activationToken) {
            return;
        }
        if (activateAVLocate(protyle, blockID, queued.request)) {
            clearQueued();
            return;
        }
        if (performance.now() < timeout) {
            window.setTimeout(retry, 50);
        }
    };
    window.setTimeout(retry, 50);
    return false;
};

export const setAVLocateRequest = (blockElement: HTMLElement, request: IAVLocateRequest) => {
    locateRequests.set(blockElement, request);
};

const getAVLocateRequest = (blockElement: HTMLElement) => {
    return locateRequests.get(blockElement);
};

const clearAVLocateRequest = (blockElement: HTMLElement, request: IAVLocateRequest) => {
    if (locateRequests.get(blockElement) === request) {
        locateRequests.delete(blockElement);
    }
};

export const getAVLocateParams = (blockElement: HTMLElement, enabled = true) => {
    const request = getAVLocateRequest(blockElement);
    if (!enabled) {
        if (request) {
            clearAVLocateRequest(blockElement, request);
        }
        return;
    }
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
}) => {
    renderedAVData.set(blockElement, data);
    const request = getAVLocateRequest(blockElement);
    if (!blockElement.isConnected || !request || !data.target || data.target.itemID !== request.itemID) {
        return;
    }
    if (data.target.status !== "visible") {
        if (!request.messageShown) {
            request.messageShown = true;
            if (data.target.status === "filtered" || data.target.status === "groupHidden") {
                showMessage(window.siyuan.languages.databaseItemFiltered);
            } else if (data.target.status === "viewNotFound") {
                showMessage(window.siyuan.languages.databaseViewNotFound);
            } else {
                showMessage(window.siyuan.languages.databaseItemNotFound);
            }
        }
        return;
    }
    const key = data.target.groupID || "all";
    if (request.persistView === false && request.viewID) {
        blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, request.viewID);
    }
    const view = (data.target.groupID ? data.view.groups?.find(item => item.id === data.target.groupID) : data.view) as IAVTable | IAVGallery | IAVKanban;
    const itemLength = data.viewType === "table" ? (view as IAVTable).rows.length : (view as IAVGallery | IAVKanban).cards.length;
    const offset = data.target.offset || 0;
    const localIndex = Math.max(0, data.target.index - offset);
    let renderedStart = Math.max(0, localIndex - locateRenderSize / 2);
    const renderedEnd = Math.min(itemLength - 1, renderedStart + locateRenderSize - 1);
    renderedStart = Math.max(0, renderedEnd - locateRenderSize + 1);
    let topSpacerHeight: number;
    const bodyQuery = data.target.groupID ? `.av__body[data-group-id="${data.target.groupID}"]` : ".av__body";
    const currentBody = blockElement.querySelector(bodyQuery);
    if (data.viewType === "table") {
        const rowHeight = (currentBody?.querySelector(".av__row[data-id]") as HTMLElement)?.offsetHeight || 36;
        topSpacerHeight = renderedStart * rowHeight;
    } else {
        const itemHeight = (currentBody?.querySelector(".av__gallery-item") as HTMLElement)?.offsetHeight || 180;
        let columns = 1;
        if (data.viewType === "gallery") {
            const minWidth = (view as IAVGallery)?.cardSize === 0 ? 180 : ((view as IAVGallery)?.cardSize === 2 ? 320 : 260);
            columns = Math.max(1, Math.floor((blockElement.clientWidth + 16) / (minWidth + 16)));
            renderedStart -= renderedStart % columns;
        }
        topSpacerHeight = Math.floor(renderedStart / columns) * (itemHeight + 16);
    }
    if (itemLength > 100) {
        blockElement.setAttribute(Constants.ATTRIBUTE_V_SCROLL, "true");
    }
    resetData.virtualData[key] = {
        renderedStart,
        renderedEnd,
        topSpacerHeight,
        rowOffset: offset,
        locate: true,
    };
};

export const finishAVLocate = (blockElement: HTMLElement, protyle: IProtyle, data: IAV) => {
    const request = getAVLocateRequest(blockElement);
    if (!request) {
        return;
    }
    if (!data.target || data.target.itemID !== request.itemID) {
        clearAVLocateRequest(blockElement, request);
        return;
    }
    if (!blockElement.isConnected) {
        locateRequests.delete(blockElement);
        return;
    }
    const currentViewID = blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) ?? request.previousViewID ?? data.viewID;
    if (data.target?.status !== "viewNotFound" && request.viewID && request.viewID !== currentViewID) {
        blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, request.viewID);
        if (!protyle.disabled && request.persistView !== false) {
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
    }
    if (data.target?.status !== "visible") {
        clearAVLocateRequest(blockElement, request);
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
        const rowElement = bodyElement?.querySelector(`.av__row[data-id="${request.itemID}"]`) as HTMLElement;
        targetElement = rowElement?.querySelector(".av__cell[data-dtype=\"block\"]") as HTMLElement;
        if (targetElement && request.select !== false) {
            clearSelect(["cell"], blockElement);
            targetElement.classList.add("av__cell--select");
            addDragFill(targetElement);
        }
    } else {
        targetElement = bodyElement?.querySelector(`.av__gallery-item[data-id="${request.itemID}"]`) as HTMLElement;
        if (targetElement && request.select !== false && !request.highlight) {
            blockElement.querySelectorAll(".av__gallery-item--select").forEach(item => item.classList.remove("av__gallery-item--select"));
            targetElement.classList.add("av__gallery-item--select");
        }
    }
    if (!targetElement) {
        clearAVLocateRequest(blockElement, request);
        if (!request.messageShown) {
            showMessage(window.siyuan.languages.databaseItemNotFound);
        }
        return;
    }
    if (data.viewType === "table" && data.target.index === 0 && !data.target.groupID) {
        const contentRect = protyle.contentElement.getBoundingClientRect();
        protyle.contentElement.scrollTop += blockElement.getBoundingClientRect().top - contentRect.top;
    } else {
        scrollCenter(protyle, targetElement, "center");
    }
    if (data.viewType === "kanban") {
        const kanbanElement = blockElement.querySelector(".av__kanban") as HTMLElement;
        const kanbanRect = kanbanElement?.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        if (kanbanElement && (targetRect.left < kanbanRect.left || targetRect.right > kanbanRect.right)) {
            kanbanElement.scrollLeft += targetRect.left + targetRect.width / 2 - (kanbanRect.left + kanbanRect.width / 2);
        }
    }
    if (request.highlight) {
        highlightLocatedItem(blockElement, protyle, data.viewType, groupQuery, request.itemID);
    }
    clearAVLocateRequest(blockElement, request);
};
