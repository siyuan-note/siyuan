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

export interface ListMindmapSummaryRange {
    parentId: string;
    nodeIds: string[];
}

export const isListMindmapSummaryCrossing = (a: string[], b: string[]) => {
    const members = new Set(a);
    const common = b.filter(id => members.has(id)).length;
    return common > 0 && common < a.length && common < b.length;
};

export const getListMindmapSummaryParentID = (model: ListMindmapModel, id: string) => {
    const node = model.nodes.get(id);
    return node?.parentId || (node === model.root && !node.virtual ? model.list?.dataset.nodeId : undefined);
};

export const getListMindmapSiblingIDs = (model: ListMindmapModel) => {
    const siblings = new Map<string, string[]>();
    if (model.list) {
        siblings.set(model.list.dataset.nodeId, model.root.virtual ? model.root.children.map(node => node.id) : [model.root.id]);
    }
    model.nodes.forEach(node => {
        if (node.children.length) {
            siblings.set(node.id, node.children.map(child => child.id));
        }
    });
    return siblings;
};

// 新插入的节点只在已有成员之间加入范围；原有范围被拆开时保留未移动成员最多的连续部分。
export const normalizeListMindmapSummaries = (summaries: ListMindmapSummary[], siblings: Map<string, string[]>,
                                               previous = siblings, moved = new Set<string>(), version = 1) => {
    const claimed = new Set<string>();
    const normalized = summaries.flatMap(summary => {
        const members = new Set(summary.nodeIds);
        const old = new Set(previous.get(summary.parentId) || []);
        const groups: string[][] = [[]];
        (siblings.get(summary.parentId) || []).forEach(id => {
            if ((version === 2 || !claimed.has(id)) && (members.has(id) || !old.has(id))) {
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
    if (version === 2) {
        const originals = new Map(summaries.map(summary => [summary.id, summary]));
        const ordered = [...normalized].sort((a, b) => originals.get(b.id).nodeIds.length -
            originals.get(a.id).nodeIds.length || a.id.localeCompare(b.id));
        // 结构编辑造成交叉时，内层范围保留与原外层的交集，范围完全分离时各自保留。
        ordered.forEach((outer, index) => {
            ordered.slice(index + 1).forEach(inner => {
                const originalOuter = new Set(originals.get(outer.id).nodeIds);
                if (outer.parentId === inner.parentId &&
                    originals.get(inner.id).nodeIds.every(id => originalOuter.has(id)) &&
                    isListMindmapSummaryCrossing(outer.nodeIds, inner.nodeIds)) {
                    const members = new Set(outer.nodeIds);
                    inner.nodeIds = inner.nodeIds.filter(id => members.has(id));
                }
            });
        });
    }
    return normalized;
};

export const getListMindmapSummaryRange = (model: ListMindmapModel, from: string, to: string) => {
    const parentId = getListMindmapSummaryParentID(model, from);
    if (!parentId || getListMindmapSummaryParentID(model, to) !== parentId) {
        return [];
    }
    const siblings = model.nodes.get(parentId)?.children.map(node => node.id) ||
        (model.list?.dataset.nodeId === parentId ? [model.root.id] : []);
    const start = siblings.indexOf(from);
    const end = siblings.indexOf(to);
    if (start < 0 || end < 0) {
        return [];
    }
    const nodeIds = siblings.slice(Math.min(start, end), Math.max(start, end) + 1);
    if (model.metadata.summaries?.some(summary => summary.parentId === parentId &&
        (isListMindmapSummaryCrossing(nodeIds, summary.nodeIds) ||
            nodeIds.length === summary.nodeIds.length && nodeIds.every(id => summary.nodeIds.includes(id))))) {
        return [];
    }
    return nodeIds;
};

// 框选只保留最外层的选中节点，并按父节点及连续范围分组。
export const getListMindmapSummarySelection = (model: ListMindmapModel, selected: Set<string>) => {
    const groups: ListMindmapSummaryRange[] = [];
    getListMindmapSiblingIDs(model).forEach((ids, parentId) => {
        let group: string[] = [];
        const finish = () => {
            if (group.length) {
                groups.push({parentId, nodeIds: group});
                group = [];
            }
        };
        ids.forEach(id => {
            let parent = model.nodes.get(id)?.parentId;
            let covered = false;
            while (parent) {
                covered ||= selected.has(parent);
                parent = model.nodes.get(parent)?.parentId;
            }
            if (selected.has(id) && !covered) {
                group.push(id);
            } else {
                finish();
            }
        });
        finish();
    });
    const conflict = groups.some(group => model.metadata.summaries?.some(summary =>
        summary.parentId === group.parentId && isListMindmapSummaryCrossing(group.nodeIds, summary.nodeIds)));
    const ranges = groups.filter(group => !model.metadata.summaries?.some(summary =>
        summary.parentId === group.parentId && group.nodeIds.length === summary.nodeIds.length &&
        group.nodeIds.every(id => summary.nodeIds.includes(id))));
    return {ranges, conflict};
};

export const getListMindmapSummaryCoverage = (model: ListMindmapModel, nodeIds: string[]) => {
    const covered = new Set<string>();
    const pending = [...nodeIds];
    while (pending.length) {
        const id = pending.pop();
        if (covered.has(id)) {
            continue;
        }
        covered.add(id);
        pending.push(...(model.nodes.get(id)?.children.map(node => node.id) || []));
    }
    return covered;
};

export const getListMindmapSummarySnapshot = (model: ListMindmapModel) =>
    JSON.stringify({siblings: [...getListMindmapSiblingIDs(model)], metadata: model.metadata});

// 全部范围校验通过后才修改配置，嵌套配置使用显式版本，保留已有概要身份与扩展字段。
export const addListMindmapSummaryRanges = (model: ListMindmapModel, ranges: ListMindmapSummaryRange[],
                                          newID: () => string, label: string) => {
    if (!ranges.length || ranges.some(range => !range.nodeIds.length ||
        getListMindmapSummaryParentID(model, range.nodeIds[0]) !== range.parentId ||
        JSON.stringify(getListMindmapSummaryRange(model, range.nodeIds[0], range.nodeIds[range.nodeIds.length - 1])) !==
        JSON.stringify(range.nodeIds)) || ranges.some((a, index) => ranges.slice(index + 1).some(b =>
        a.parentId === b.parentId && (isListMindmapSummaryCrossing(a.nodeIds, b.nodeIds) ||
            a.nodeIds.length === b.nodeIds.length && a.nodeIds.every(id => b.nodeIds.includes(id)))))) {
        return undefined;
    }
    const added = ranges.map(range => ({...range, nodeIds: [...range.nodeIds], id: newID(), label}));
    const summaries = [...(model.metadata.summaries || []), ...added];
    const coverage = summaries.map(summary => getListMindmapSummaryCoverage(model, summary.nodeIds));
    if (coverage.some((a, index) => coverage.slice(index + 1).some(b => [...a].some(id => b.has(id))))) {
        model.metadata.version = 2;
    }
    model.metadata.summaries = summaries;
    return added.map(summary => summary.id);
};

// 括号包围可见子树及内层概要，按包含范围由内到外布局。
export const layoutListMindmapSummaries = (model: ListMindmapModel, positions: Map<string, ListMindmapPosition>,
                                          sizes: Map<string, {width: number, height: number}>) => {
    const result = new Map<string, ListMindmapSummaryPosition>();
    const coverage = new Map((model.metadata.summaries || []).map(summary =>
        [summary.id, getListMindmapSummaryCoverage(model, summary.nodeIds)]));
    const ordered = [...(model.metadata.summaries || [])].sort((a, b) =>
        coverage.get(a.id).size - coverage.get(b.id).size || a.id.localeCompare(b.id));
    ordered.forEach(summary => {
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
        let top = Infinity;
        let bottom = -Infinity;
        const members = coverage.get(summary.id);
        members.forEach(id => {
            const position = positions.get(id);
            if (!position) {
                return;
            }
            right = Math.max(right, position.x + position.width);
            const y = position.y - (id === model.root.id ? 1 : 3);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y + position.height);
        });
        result.forEach(inner => {
            if ([...coverage.get(inner.id)].every(id => members.has(id))) {
                right = Math.max(right, inner.labelX + inner.width);
                top = Math.min(top, inner.top, inner.labelY);
                bottom = Math.max(bottom, inner.bottom, inner.labelY + inner.height);
            }
        });
        top -= 8;
        bottom += 8;
        const center = (top + bottom) / 2;
        result.set(summary.id, {id: summary.id, x: right + 36, top, bottom,
            labelX: right + 60, labelY: center - size.height / 2, ...size});
    });
    return result;
};
