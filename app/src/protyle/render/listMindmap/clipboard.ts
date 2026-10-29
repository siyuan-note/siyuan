import {Constants} from "../../../constants";
import {remapTabsDOMIDs} from "../../util/tabsCopy";
import {
    addListMindmapNode, cleanListMindmapHTML, deleteListMindmapNode, materializeListMindmapRoot,
    readListMindmap, remapListMindmapIDs, retagMindmapBranch, writeListMindmapMetadata,
} from "./model";
import type {ListMindmapModel, ListMindmapPlacement} from "./model";
import {getListMindmapSiblingIDs} from "./summary";

// 按源文档顺序复制最外层分支，父子同时选中时只复制一次。
export const getMindmapSelectedRoots = (model: ListMindmapModel, ids: string[]) => {
    const selected = new Set(ids);
    if (model.root.virtual && selected.has(model.root.id)) {
        return model.root.children;
    }
    const result: typeof model.root[] = [];
    const pending = [model.root];
    while (pending.length) {
        const node = pending.pop();
        if (!node.virtual && selected.has(node.id)) {
            result.push(node);
        } else {
            pending.push(...node.children.slice().reverse());
        }
    }
    return result;
};

const cloneSource = (list: HTMLElement) => {
    const template = document.createElement("template");
    template.innerHTML = cleanListMindmapHTML(list.outerHTML);
    return template.content.firstElementChild as HTMLElement;
};

export const copyMindmapBranches = (list: HTMLElement, ids: string[]) => {
    const model = readListMindmap(list);
    const roots = getMindmapSelectedRoots(model, ids);
    if (!roots.length) {
        return "";
    }
    const copy = list.cloneNode(false) as HTMLElement;
    copy.removeAttribute("data-mindmap-view-rendered");
    copy.replaceChildren(...roots.map(node => cloneSource(node.element)));
    const copied = readListMindmap(copy);
    const included = new Set(copied.nodes.keys());
    const top = new Set(roots.map(node => node.id));
    const metadata = {...model.metadata,
        nodes: Object.fromEntries(Object.entries(model.metadata.nodes).filter(([id]) => included.has(id))),
        relations: model.metadata.relations.filter(item => included.has(item.from) && included.has(item.to)),
        summaries: model.metadata.summaries?.filter(item => item.nodeIds.every(id => included.has(id)))
            .map(item => ({...item, parentId: top.has(item.nodeIds[0]) ? copy.dataset.nodeId : item.parentId})),
    };
    if (!model.root.virtual || !ids.includes(model.root.id)) {
        delete metadata.rootTitle;
    }
    writeListMindmapMetadata(copy, metadata);
    return cleanListMindmapHTML(copy.outerHTML);
};

export const canCutMindmapBranches = (model: ListMindmapModel, ids: string[]) => {
    if (ids.includes(model.root.id)) {
        return false;
    }
    const roots = getMindmapSelectedRoots(model, ids);
    // 始终保留根节点；多顶层分支的导图也不能通过一次剪切变为空块。
    return roots.length > 0 && (!model.root.virtual ||
        model.root.children.some(child => !roots.some(root => root.id === child.id)));
};

export const removeMindmapBranches = (list: HTMLElement, ids: string[]) => {
    const model = readListMindmap(list);
    if (!canCutMindmapBranches(model, ids)) {
        return false;
    }
    const copy = cloneSource(list);
    for (const node of getMindmapSelectedRoots(model, ids)) {
        if (!deleteListMindmapNode(copy, node.id)) {
            return false;
        }
    }
    return copy;
};

// 仅接管完整导图载荷。普通块、网页和图片继续使用节点编辑器的标准粘贴管线。
export const readMindmapClipboard = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = cleanListMindmapHTML(Lute.Sanitize(html));
    const list = template.content.firstElementChild as HTMLElement;
    if (template.content.children.length !== 1 || !list ||
        list.dataset.type !== "NodeMindmap" &&
        !(list.dataset.type === "NodeList" && list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) === "1")) {
        return;
    }
    readListMindmap(list);
    return list;
};

export const pasteMindmapBranches = (list: HTMLElement, source: HTMLElement, targetId: string,
                                     placement: ListMindmapPlacement, lute: Lute) => {
    const copy = cloneSource(list);
    const incoming = cloneSource(source);
    // 虚拟根实体化沿用列表转换器，再统一转回目标导图的容器类型。
    retagMindmapBranch(incoming, false);
    materializeListMindmapRoot(incoming, lute);
    const ids = new Map<string, string>();
    [incoming, ...incoming.querySelectorAll<HTMLElement>("[data-node-id]")].forEach(block => {
        const id = block.dataset.nodeId;
        if (!id || ids.has(id)) {
            throw new Error("Invalid copied mindmap identity");
        }
        const next = Lute.NewNodeID();
        ids.set(id, next);
        block.dataset.nodeId = next;
        block.setAttribute("updated", next.substring(0, 14));
    });
    remapTabsDOMIDs(incoming, ids);
    remapListMindmapIDs(incoming, ids);
    retagMindmapBranch(incoming, list.dataset.type === "NodeMindmap");
    const sourceModel = readListMindmap(incoming);
    const roots = sourceModel.root.virtual ? sourceModel.root.children : [sourceModel.root];
    const inserted: string[] = [];
    let target = targetId;
    for (const node of roots) {
        if (!addListMindmapNode(copy, target, placement, node.element)) {
            return;
        }
        inserted.push(node.id);
        if (placement === "after") {
            target = node.id;
        }
    }
    if (!inserted.length) {
        return;
    }
    const model = readListMindmap(copy);
    const metadata = model.metadata;
    Object.assign(metadata.nodes, sourceModel.metadata.nodes);
    delete metadata.nodes[incoming.dataset.nodeId];
    metadata.relations.push(...sourceModel.metadata.relations.map(relation => {
        const copied = {...relation, id: Lute.NewNodeID()};
        delete copied.route;
        return copied;
    }));
    const parents = getListMindmapSiblingIDs(model);
    const parentId = [...parents].find(([, children]) => children.includes(inserted[0]))?.[0];
    const summaries = sourceModel.metadata.summaries?.map(summary => ({...summary,
        id: Lute.NewNodeID(),
        parentId: summary.parentId === incoming.dataset.nodeId ? parentId : summary.parentId,
    })).filter(summary => parents.get(summary.parentId)?.includes(summary.nodeIds[0]));
    if (summaries?.length) {
        metadata.version = Math.max(metadata.version, sourceModel.metadata.version) as 1 | 2;
        metadata.summaries = [...(metadata.summaries || []), ...summaries];
    }
    writeListMindmapMetadata(copy, metadata);
    return {list: copy, ids: inserted};
};
