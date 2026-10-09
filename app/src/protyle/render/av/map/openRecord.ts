import {openDatabaseRowByData} from "../openDatabaseRow";

export const openMapRecord = (protyle: IProtyle, blockElement: HTMLElement, row: IAVRow, keyID?: string) => {
    const primary = row?.cells.find(cell => cell.valueType === "block" || cell.value?.type === "block");
    if (!primary?.value) {
        return false;
    }
    return openDatabaseRowByData(protyle, {
        avID: blockElement.dataset.avId, databaseBlockID: blockElement.dataset.nodeId, notebookID: protyle.notebookId,
        itemID: row.id, valueID: primary.id || primary.value.id,
        title: primary.value.block?.content || window.siyuan.languages.untitled,
        boundBlockID: primary.value.block?.id, isDetached: !!primary.value.isDetached,
        focusPrimary: !keyID, matchedKeyID: keyID,
    });
};
