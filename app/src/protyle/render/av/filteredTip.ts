import {Constants} from "../../../constants";
import {showMessage} from "../../../dialog/message";
import {fetchSyncPost} from "../../../util/fetch";
import {openDatabaseRowByData} from "./openDatabaseRow";

export type TAVFilteredTipScope = "target" | "view" | "database";

const handledTokens = new Set<string>();
const hiddenStatuses = new Set<IAVRenderTarget["status"]>(["filtered", "groupHidden"]);

export const getAVViewID = (blockElement: HTMLElement) => {
    return blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW)
        || blockElement.querySelector(".layout-tab-bar .item--focus")?.getAttribute("data-id")
        || "";
};

export const getAVFilteredTipContext = (scope: TAVFilteredTipScope, protyle?: IProtyle, openFilteredItem = false) => {
    const context: Record<string, string> = {
        filteredTipScope: scope,
        filteredTipToken: Lute.NewNodeID(),
        filteredTipAppID: Constants.SIYUAN_APPID,
    };
    if (protyle) {
        context.protyleID = protyle.id;
    }
    if (openFilteredItem) {
        context.openFilteredItem = "true";
    }
    return context;
};

export const getAVItemRenderStatus = async (blockElement: HTMLElement, itemID: string, viewID?: string) => {
    const searchInputElement = blockElement.querySelector('[data-type="av-search"]');
    const response = await fetchSyncPost("/api/av/renderAttributeView", {
        id: blockElement.dataset.avId,
        viewID: viewID || "",
        query: searchInputElement?.textContent?.trim() || "",
        blockID: blockElement.dataset.nodeId,
        initialLayout: blockElement.dataset.avType,
        createIfNotExist: false,
        targetItemID: itemID,
    });
    return (response.data as IAV)?.target?.status;
};

const getCandidates = (protyle: IProtyle, operation: IOperation, scope: TAVFilteredTipScope) => {
    if (scope === "target") {
        const candidates = Array.from(protyle.wysiwyg.element.querySelectorAll<HTMLElement>(
            `.av[data-av-id="${operation.avID}"][data-node-id="${operation.blockID}"]`
        ));
        if (operation.viewID) {
            const matched = candidates.filter(item => getAVViewID(item) === operation.viewID);
            if (matched.length > 0) {
                return matched.slice(0, 1);
            }
        }
        return candidates.slice(0, 1);
    }

    const candidates = Array.from(document.querySelectorAll<HTMLElement>(
        `.protyle-wysiwyg .av[data-av-id="${operation.avID}"]`
    ));
    if (scope === "view") {
        return candidates.filter(item => getAVViewID(item) === operation.viewID);
    }
    return candidates;
};

const isFilteredInAllCandidates = async (candidates: HTMLElement[], itemID: string, viewID?: string) => {
    const statuses = await Promise.all(candidates.map(async item => {
        try {
            return await getAVItemRenderStatus(item, itemID, viewID);
        } catch (e) {
            console.error(e);
        }
    }));
    return statuses.every(status => Boolean(status && hiddenStatuses.has(status)));
};

export const inspectAVInsertedItem = async (protyle: IProtyle, operation: IOperation) => {
    const context = operation.context;
    const scope = context?.filteredTipScope as TAVFilteredTipScope;
    const token = context?.filteredTipToken;
    if (!scope || !token || context.ignoreTip === "true" ||
        context.filteredTipAppID !== Constants.SIYUAN_APPID) {
        return;
    }
    if (scope === "target" && context.protyleID && context.protyleID !== protyle.id) {
        return;
    }
    if (handledTokens.has(token)) {
        return;
    }
    handledTokens.add(token);
    window.setTimeout(() => handledTokens.delete(token), 60000);

    const result = operation.retData as IInsertAttrViewBlockRetData;
    const insertedItemIDs = result?.insertedItemIDs;
    if (!insertedItemIDs?.length) {
        return;
    }
    const candidates = getCandidates(protyle, operation, scope);
    if (candidates.length === 0) {
        return;
    }

    const viewID = scope === "database" ? undefined : operation.viewID;
    let filteredItemID: string;
    for (const itemID of insertedItemIDs) {
        if (await isFilteredInAllCandidates(candidates, itemID, viewID)) {
            filteredItemID = itemID;
            break;
        }
    }
    if (!filteredItemID) {
        return;
    }

    showMessage(window.siyuan.languages.databaseItemFiltered);
    if (scope !== "target" || context.openFilteredItem !== "true" || insertedItemIDs.length !== 1) {
        return;
    }
    const insertedItem = operation.srcs.find(item => item.itemID === filteredItemID);
    if (!insertedItem) {
        return;
    }
    openDatabaseRowByData(protyle, {
        avID: operation.avID,
        databaseBlockID: candidates[0].dataset.nodeId,
        notebookID: protyle.notebookId,
        itemID: filteredItemID,
        valueID: "",
        title: insertedItem.content || "",
        boundBlockID: insertedItem.isDetached ? undefined : insertedItem.id,
        isDetached: insertedItem.isDetached,
    });
};
