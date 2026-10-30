export interface ISubItemsRelationPair {
    id: string;
    first: IAVColumn;
    second: IAVColumn;
}

export const getSubItemsRelationPairs = (fields: IAVColumn[], avID: string): ISubItemsRelationPair[] => {
    const byID = new Map(fields.map(field => [field.id, field]));
    const pairs: ISubItemsRelationPair[] = [];
    const seen = new Set<string>();
    for (const field of fields) {
        const reverse = byID.get(field.relation?.backKeyID);
        if (field.type !== "relation" || field.relation?.avID !== avID || !field.relation.isTwoWay ||
            !reverse || reverse.id === field.id || reverse.type !== "relation" ||
            reverse.relation?.avID !== avID || !reverse.relation.isTwoWay || reverse.relation.backKeyID !== field.id) continue;
        const id = [field.id, reverse.id].sort().join("/");
        if (seen.has(id)) continue;
        seen.add(id);
        pairs.push({id, first: field, second: reverse});
    }
    return pairs;
};

// 预览只取当前已加载视图中的少量条目，不读取整库或持久化方向选择。
export const getSubItemsRelationPreview = (data: IAV | undefined, pair: ISubItemsRelationPair, parentKeyID: string) => {
    const parentField = parentKeyID === pair.first.id ? pair.first : pair.second;
    const childrenField = parentField === pair.first ? pair.second : pair.first;
    const rows = new Map<string, IAVCell[]>();
    let examined = 0;
    const views = data ? [data.view, ...(data.view.groups || []).slice(0, 100)] : [];
    for (const view of views) {
        const items: Array<IAVRow | IAVGalleryItem> = (view as IAVTable).rows || (view as IAVGallery).cards || [];
        for (const item of items) {
            if (++examined > 100) break;
            if (!rows.has(item.id)) rows.set(item.id, "cells" in item ? item.cells : item.values);
        }
        if (examined >= 100) break;
    }
    const names = new Map(Array.from(rows, ([id, cells]) => [id,
        cells.find(cell => cell.valueType === "block" || cell.value?.type === "block")?.value?.block?.content?.trim() || ""]));
    const groups = new Map<string, {title: string; children: Map<string, string>}>();
    const add = (parentID: string, childID: string, parentName: string, childName: string) => {
        if (!parentName || !childName || parentID === childID) return;
        let group = groups.get(parentID);
        if (!group) {
            if (groups.size >= 3) return;
            group = {title: parentName, children: new Map()};
            groups.set(parentID, group);
        }
        if (group.children.size < 3) group.children.set(childID, childName);
    };
    let multipleParents = false;
    for (const [itemID, cells] of rows) {
        const parentValue = cells.find(cell => cell.value?.keyID === parentField.id)?.value?.relation;
        if ((parentValue?.blockIDs?.length || 0) > 1) multipleParents = true;
        parentValue?.blockIDs?.slice(0, 3).forEach((parentID, index) => add(parentID, itemID,
            names.get(parentID) || parentValue.contents?.[index]?.block?.content?.trim(), names.get(itemID)));
        const childrenValue = cells.find(cell => cell.value?.keyID === childrenField.id)?.value?.relation;
        childrenValue?.blockIDs?.slice(0, 3).forEach((childID, index) => add(itemID, childID,
            names.get(itemID), names.get(childID) || childrenValue.contents?.[index]?.block?.content?.trim()));
    }
    return {parentField, childrenField, multipleParents, examples: Array.from(groups.values(), group =>
        ({title: group.title, children: Array.from(group.children.values())}))};
};

export const getSubItemsInitialParentKey = (data: IAV | undefined, pair: ISubItemsRelationPair, preferred?: string) => {
    if (preferred === pair.first.id || preferred === pair.second.id) return preferred;
    if (getSubItemsRelationPreview(data, pair, pair.first.id).multipleParents &&
        !getSubItemsRelationPreview(data, pair, pair.second.id).multipleParents) return pair.second.id;
    return pair.first.id;
};
