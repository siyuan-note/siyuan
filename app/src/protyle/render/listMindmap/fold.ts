import type {ListMindmapModel, ListMindmapNode} from "./model";

export type ListMindmapFoldTarget = number | "expandAll" | "foldAll";

// 同一父节点下仍有展开的分支时统一折叠，否则统一展开，不修改后代的折叠状态。
export const getListMindmapSiblingFoldStates = (model: Pick<ListMindmapModel, "nodes">, id: string,
                                              folded?: ReadonlyMap<string, boolean>) => {
    const node = model.nodes.get(id);
    const siblings = node?.parentId ? model.nodes.get(node.parentId)?.children || [] : node ? [node] : [];
    const branches = siblings.filter(item => item.children.length);
    const collapsed = branches.some(item => !(folded?.get(item.id) ?? item.collapsed));
    return new Map(branches.map(item => [item.id, collapsed]));
};

// 中心节点为一级，目标级别的节点也展开；折叠下一级分支，保留更深层的折叠状态。
export const getListMindmapFoldStates = (root: ListMindmapNode, targetLevel: ListMindmapFoldTarget) => {
    const states = new Map<string, boolean>();
    if (typeof targetLevel === "number" && (!Number.isInteger(targetLevel) || targetLevel < 1)) {
        return states;
    }
    const pending = [{node: root, level: 1}];
    while (pending.length) {
        const {node, level} = pending.pop();
        if (!node.children.length) {
            continue;
        }
        const collapsed = targetLevel === "foldAll" || (typeof targetLevel === "number" && level > targetLevel);
        states.set(node.id, collapsed);
        if (!collapsed) {
            node.children.forEach(child => pending.push({node: child, level: level + 1}));
        }
    }
    return states;
};
