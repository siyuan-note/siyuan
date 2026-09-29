import type {ListMindmapModel, ListMindmapPosition} from "./model";

export interface ListMindmapSummary {
    id: string;
    parentId: string;
    nodeIds: string[];
    label: string;
    color?: string;
}

export interface ListMindmapSummaryPosition {
    id: string;
    x: number;
    top: number;
    bottom: number;
    labelX: number;
    labelY: number;
    width: number;
    height: number;
}

export const getListMindmapSiblingIDs = (model: ListMindmapModel) => {
    const siblings = new Map<string, string[]>();
    siblings.set(model.list.dataset.nodeId, model.root.virtual ? model.root.children.map(node => node.id) : [model.root.id]);
    model.nodes.forEach(node => {
        if (node.children.length) {
            siblings.set(node.id, node.children.map(child => child.id));
        }
    });
    return siblings;
};

// 新插入的节点只在已有成员之间加入范围；原有范围被拆开时保留未移动成员最多的连续部分。
export const normalizeListMindmapSummaries = (summaries: ListMindmapSummary[], siblings: Map<string, string[]>,
                                               previous = siblings, moved = new Set<string>()) => {
    const claimed = new Set<string>();
    return summaries.flatMap(summary => {
        const members = new Set(summary.nodeIds);
        const old = new Set(previous.get(summary.parentId) || []);
        const groups: string[][] = [[]];
        (siblings.get(summary.parentId) || []).forEach(id => {
            if (!claimed.has(id) && (members.has(id) || !old.has(id))) {
                groups[groups.length - 1].push(id);
            } else if (groups[groups.length - 1].length) {
                groups.push([]);
            }
        });
        const candidates = groups.map(group => {
            const start = group.findIndex(id => members.has(id));
            const end = group.length - 1 - [...group].reverse().findIndex(id => members.has(id));
            return start < 0 ? [] : group.slice(start, end + 1);
        });
        const score = (group: string[]) => group.reduce((count, id) =>
            count + (members.has(id) ? moved.has(id) ? 1 : summary.nodeIds.length + 1 : 0), 0);
        const nodeIds = candidates.reduce((best, group) => score(group) > score(best) ? group : best, []);
        if (!nodeIds.length) {
            return [];
        }
        nodeIds.forEach(id => claimed.add(id));
        return [{...summary, nodeIds}];
    });
};

export const getListMindmapSummaryRange = (model: ListMindmapModel, from: string, to: string) => {
    const parentId = model.nodes.get(from)?.parentId;
    if (!parentId || model.nodes.get(to)?.parentId !== parentId) {
        return [];
    }
    const siblings = model.nodes.get(parentId)?.children || [];
    const start = siblings.findIndex(node => node.id === from);
    const end = siblings.findIndex(node => node.id === to);
    if (start < 0 || end < 0) {
        return [];
    }
    const nodeIds = siblings.slice(Math.min(start, end), Math.max(start, end) + 1).map(node => node.id);
    const related = (a: string, b: string) => {
        while (a) {
            if (a === b) {
                return true;
            }
            a = model.nodes.get(a)?.parentId;
        }
        return false;
    };
    if (model.metadata.summaries?.some(summary => summary.nodeIds.some(member =>
        nodeIds.some(id => related(member, id) || related(id, member))))) {
        return [];
    }
    return nodeIds;
};

// 括号连接首尾成员的垂直中心，横向避让可见子树，标签高度独立参与画布边界计算。
export const layoutListMindmapSummaries = (model: ListMindmapModel, positions: Map<string, ListMindmapPosition>,
                                          sizes: Map<string, {width: number, height: number}>) => {
    const result = new Map<string, ListMindmapSummaryPosition>();
    (model.metadata.summaries || []).forEach(summary => {
        const size = sizes.get(summary.id);
        if (!size || !summary.nodeIds.length || summary.nodeIds.some(id => !positions.has(id))) {
            return;
        }
        const siblings = model.nodes.get(summary.parentId)?.children.map(node => node.id) ||
            (model.list?.dataset.nodeId === summary.parentId ? [model.root.id] : []);
        const start = siblings.indexOf(summary.nodeIds[0]);
        if (start < 0 || !summary.nodeIds.every((id, index) => siblings[start + index] === id)) {
            return;
        }
        let right = 0;
        const pending = [...summary.nodeIds];
        while (pending.length) {
            const id = pending.pop();
            const position = positions.get(id);
            if (!position) {
                continue;
            }
            right = Math.max(right, position.x + position.width);
            pending.push(...(model.nodes.get(id)?.children.map(node => node.id) || []));
        }
        const nodeCenter = (id: string) => {
            const position = positions.get(id);
            return position.y - (id === model.root.id ? 1 : 3) + position.height / 2;
        };
        const top = nodeCenter(summary.nodeIds[0]);
        const bottom = nodeCenter(summary.nodeIds[summary.nodeIds.length - 1]);
        const center = (top + bottom) / 2;
        result.set(summary.id, {id: summary.id, x: right + 36, top, bottom,
            labelX: right + 60, labelY: center - size.height / 2, ...size});
    });
    return result;
};
