import type {App} from "../../../index";
import {fetchSyncPost} from "../../../util/fetch";
import {showMessage} from "../../../dialog/message";
import {openDatabaseRowByData} from "./openDatabaseRow";

export const openStandaloneDatabaseItem = async (app: App, databaseBlockID: string, itemID: string) => {
    const [domResponse, infoResponse] = await Promise.all([
        fetchSyncPost("/api/block/getBlockDOM", {id: databaseBlockID}),
        fetchSyncPost("/api/block/getBlockInfo", {id: databaseBlockID}),
    ]);
    if (domResponse.code !== 0 || infoResponse.code !== 0 || !domResponse.data || !infoResponse.data) {
        return false;
    }
    // 从真实载体块读取数据库 ID，避免链接依赖视图状态或携带过期的数据库 ID。
    const parsedDocument = new DOMParser().parseFromString(domResponse.data.dom, "text/html");
    const block = parsedDocument.body.firstElementChild;
    const avID = block?.getAttribute("data-type") === "NodeAttributeView" &&
        block.getAttribute("data-node-id") === databaseBlockID ? block.getAttribute("data-av-id") : "";
    if (!avID) {
        showMessage(window.siyuan.languages.databaseItemNotFound);
        return false;
    }
    const response = await fetchSyncPost("/api/av/getAttributeViewKeys", {id: itemID, avID, itemID});
    if (response.code !== 0) {
        return false;
    }
    const tables = response.data || [];
    const primary = tables.find(table => table.avID === avID)?.keyValues
        .find(keyValue => keyValue.key.type === "block")?.values?.find(value => value.blockID === itemID);
    if (!primary?.block) {
        showMessage(window.siyuan.languages.databaseItemNotFound);
        return false;
    }
    return openDatabaseRowByData({app}, {
        avID,
        databaseBlockID,
        notebookID: "box" in infoResponse.data ? infoResponse.data.box : "",
        itemID,
        valueID: primary.id,
        title: primary.block.content,
        isDetached: primary.isDetached,
    }, {standalone: true, keepAVPanel: true});
};

export const openStandaloneDatabaseItemByURI = (app: App, info: ISiYuanUriBlockInfo) => {
    if (!info.avStandalone || !info.avItemID) {
        return false;
    }
    void openStandaloneDatabaseItem(app, info.id, info.avItemID).catch(error => {
        console.warn("Failed to open database item:", error);
        showMessage(window.siyuan.languages.databaseItemNotFound);
    });
    return true;
};
