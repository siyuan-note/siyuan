import type {ListMindmapNode} from "./model";

export type ListMindmapFoldTarget = number | "expandAll" | "foldAll";

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
