import {getTableRowBudget} from "./groupTableVirtual";
import {isTableLikeView} from "./viewType";

export interface NewAVRow {
    itemID: string;
    groupID: string;
    viewID: string;
}

export const getNewAVRow = (block: HTMLElement, protyle: IProtyle, operation: IOperation, viewID: string): NewAVRow | undefined => {
    if (operation.action !== "insertAttrViewBlock" || operation.parentID || operation.srcs?.length !== 1 ||
        operation.context?.protyleID !== protyle.id || operation.context?.ignoreTip === "true" ||
        operation.blockID !== block.dataset.nodeId || operation.viewID !== viewID ||
        !isTableLikeView(block.dataset.avType)) {
        return;
    }
    const source = operation.srcs[0];
    const result = operation.retData as IInsertAttrViewBlockRetData;
    if (!source.isDetached || !result?.insertedItemIDs?.includes(source.itemID)) {
        return;
    }
    const ghost = Array.from(block.querySelectorAll<HTMLElement>('.av__row[data-type="ghost"]'))
        .find(row => row.dataset.avInsertItemId === source.itemID);
    const body = ghost?.closest<HTMLElement>(".av__body");
    if (body) {
        return {itemID: source.itemID, groupID: body.dataset.groupId || "", viewID};
    }
};

const getTable = (view: IAVTable, groupID: string): IAVTable | undefined =>
    groupID ? (view.groups as IAVTable[])?.find(group => group.id === groupID)
        : view.groups?.length ? undefined : view;

// 仅在新条目超出当前页时补入本次渲染，不写回排序、分页大小或分组。
export const retainNewAVRow = async (data: IAV, row: NewAVRow, virtualData: Record<string, IAVVirtualData>,
                                    locate: (itemID: string, groupID: string) => Promise<IAV | undefined>): Promise<IAV> => {
    if (!isTableLikeView(data.viewType) || data.viewID !== row.viewID || data.pendingHTTPTemplates?.length) {
        return data;
    }
    const view = data.view as IAVTable;
    const table = getTable(view, row.groupID);
    if (!table || table.nested || table.groupFolded || table.rowCount <= table.rows.length ||
        table.rows.some(item => item.id === row.itemID)) {
        return data;
    }
    const located = await locate(row.itemID, row.groupID);
    if (located?.viewID !== row.viewID || located.target?.status !== "visible" ||
        (located.target.groupID || "") !== row.groupID || located.pendingHTTPTemplates?.length) {
        return data;
    }
    const item = getTable(located.view as IAVTable, row.groupID)?.rows.find(entry => entry.id === row.itemID);
    if (!item) {
        return data;
    }
    // 追加到当前渲染范围内，避免虚拟滚动再次裁掉新行。
    const end = virtualData[row.groupID || "all"]?.renderedEnd ?? getTableRowBudget(table) - 1;
    const index = Math.min(table.rows.length, Math.max(0, end));
    const rows = [...table.rows.slice(0, index), item, ...table.rows.slice(index)];
    return {...data, view: row.groupID ? {
        ...view, groups: (view.groups as IAVTable[]).map(group => group === table ? {...group, rows} : group),
    } : {...view, rows}};
};
