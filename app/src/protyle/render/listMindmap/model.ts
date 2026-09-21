import {Constants} from "../../../constants";
import {getOrderedListMarkerUpdates} from "../../wysiwyg/listContext";
import type {MindmapManualRoute} from "./routing";

export interface ListMindmapNodeStyle {
    textColor?: string;
    backgroundColor?: string;
    borderColor?: string;
    fontSize?: number;
    borderWidth?: number;
    borderRadius?: number;
    bold?: boolean;
    italic?: boolean;
    lineColor?: string;
    lineWidth?: number;
    lineDash?: boolean;
}

export interface ListMindmapRelation {
    id: string;
    from: string;
    to: string;
    label: string;
    color?: string;
    width?: number;
    dash?: boolean;
    route?: MindmapManualRoute;
}

export interface ListMindmapMetadata {
    version: 1;
    rootTitle?: string;
    nodes: Record<string, ListMindmapNodeStyle>;
    relations: ListMindmapRelation[];
}

export interface ListMindmapNode {
    id: string;
    parentId?: string;
    element?: HTMLElement;
    contentBlocks: HTMLElement[];
    children: ListMindmapNode[];
    collapsed: boolean;
    virtual: boolean;
    taskMarker?: string;
}

export interface ListMindmapModel {
    list: HTMLElement;
    root: ListMindmapNode;
    nodes: Map<string, ListMindmapNode>;
    metadata: ListMindmapMetadata;
}

export interface ListMindmapLayoutNode {
    id: string;
    width: number;
    height: number;
    children: ListMindmapLayoutNode[];
    collapsed?: boolean;
}

export interface ListMindmapPosition {
    id: string;
    parentId?: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export type ListMindmapPlacement = "child" | "before" | "after";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);

const invalidMetadata = () => new Error("Invalid list mindmap metadata");

// 校验已知字段并保留扩展字段，防止损坏或较新版本的配置被编辑操作覆盖。
export const parseListMindmapMetadata = (value: string | null): ListMindmapMetadata => {
    if (value === null) {
        return {version: 1, nodes: Object.create(null), relations: []};
    }
    let data: unknown;
    try {
        data = JSON.parse(value);
    } catch {
        throw invalidMetadata();
    }
    if (!isRecord(data) || data.version !== 1 || !isRecord(data.nodes) || !Array.isArray(data.relations)) {
        throw invalidMetadata();
    }
    const stringKeys = ["textColor", "backgroundColor", "borderColor", "lineColor"];
    if (data.rootTitle !== undefined && typeof data.rootTitle !== "string") {
        throw invalidMetadata();
    }
    const numberKeys = ["fontSize", "borderWidth", "borderRadius", "lineWidth"];
    const booleanKeys = ["bold", "italic", "lineDash"];
    for (const [id, style] of Object.entries(data.nodes)) {
        if (!id || !isRecord(style) ||
            stringKeys.some(key => key in style && typeof style[key] !== "string") ||
            numberKeys.some(key => key in style && (typeof style[key] !== "number" ||
                !Number.isFinite(style[key]) || Number(style[key]) < 0)) ||
            booleanKeys.some(key => key in style && typeof style[key] !== "boolean")) {
            throw invalidMetadata();
        }
    }
    const relationIds = new Set<string>();
    for (const relation of data.relations) {
        if (!isRecord(relation) || typeof relation.id !== "string" || !relation.id ||
            relationIds.has(relation.id) || typeof relation.from !== "string" || !relation.from ||
            typeof relation.to !== "string" || !relation.to || typeof relation.label !== "string" ||
            ("color" in relation && typeof relation.color !== "string") ||
            ("width" in relation && (typeof relation.width !== "number" ||
                !Number.isFinite(relation.width) || relation.width < 0)) ||
            ("dash" in relation && typeof relation.dash !== "boolean")) {
            throw invalidMetadata();
        }
        if ("route" in relation) {
            const route = relation.route;
            if (!isRecord(route) || route.version !== 1 || !Array.isArray(route.points) ||
                !route.points.length || route.points.length > 64 || route.points.some(point =>
                    !isRecord(point) || ["x", "y", "t"].some(key => typeof point[key] !== "number" ||
                        !Number.isFinite(point[key]) || Math.abs(Number(point[key])) > 1000000) ||
                    Number(point.t) < 0 || Number(point.t) > 1)) {
                throw invalidMetadata();
            }
        }
        relationIds.add(relation.id);
    }
    return data as unknown as ListMindmapMetadata;
};

export const writeListMindmapMetadata = (list: HTMLElement, metadata: ListMindmapMetadata) => {
    parseListMindmapMetadata(list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA));
    const value = JSON.stringify(metadata);
    parseListMindmapMetadata(value);
    list.setAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA, value);
};

// 复制块树时同步替换节点样式和关系线端点，先校验全部配置再写入，避免出现部分改写。
export const remapListMindmapIDs = (root: Element, ids: Map<string, string>) => {
    const lists = Array.from(root.querySelectorAll<HTMLElement>(`[${Constants.CUSTOM_SY_LIST_MINDMAP_DATA}]`)).filter(list =>
        !list.closest(".list-mindmap"));
    if (root.hasAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA)) {
        lists.unshift(root as HTMLElement);
    }
    const updates = lists.map(list => {
        const metadata = parseListMindmapMetadata(list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA));
        const validIds = new Set(readListMindmap(list).nodes.keys());
        validIds.add(list.dataset.nodeId);
        const nodes: Record<string, ListMindmapNodeStyle> = Object.create(null);
        Object.entries(metadata.nodes).forEach(([id, style]) => {
            const mappedId = ids.get(id) || id;
            if (!validIds.has(mappedId)) {
                return;
            }
            if (Object.prototype.hasOwnProperty.call(nodes, mappedId)) {
                throw new Error("Duplicate copied list mindmap identity");
            }
            nodes[mappedId] = style;
        });
        return {list, metadata: {...metadata, nodes, relations: metadata.relations.map(relation => ({
            ...relation,
            from: ids.get(relation.from) || relation.from,
            to: ids.get(relation.to) || relation.to,
        })).filter(relation => validIds.has(relation.from) && validIds.has(relation.to))}};
    });
    updates.forEach(({list, metadata}) => list.setAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA, JSON.stringify(metadata)));
    cleanListMindmapDOM(root);
};

const directBlocks = (element: HTMLElement) => Array.from(element.children).filter(child =>
    child.hasAttribute("data-node-id")) as HTMLElement[];

const sourceBlocks = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLElement>("[data-node-id]")).filter(child =>
    !child.closest(".list-mindmap"));

const directItems = (list: HTMLElement) => directBlocks(list).filter(child =>
    child.getAttribute("data-type") === "NodeListItem");

export const readListMindmap = (list: HTMLElement): ListMindmapModel => {
    if (list.getAttribute("data-type") !== "NodeList" || !list.getAttribute("data-node-id")) {
        throw new Error("A list mindmap requires a list block");
    }
    const metadata = parseListMindmapMetadata(list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA));
    const nodes = new Map<string, ListMindmapNode>();
    const virtualRoot: ListMindmapNode = {
        id: list.getAttribute("data-node-id"),
        contentBlocks: [],
        children: [],
        collapsed: false,
        virtual: true,
    };
    const pending = [{list, parent: virtualRoot}];
    while (pending.length > 0) {
        const current = pending.pop();
        for (const item of directItems(current.list)) {
            const id = item.getAttribute("data-node-id");
            if (!id || nodes.has(id) || id === virtualRoot.id) {
                throw new Error("Invalid list mindmap node identity");
            }
            const blocks = directBlocks(item);
            const node: ListMindmapNode = {
                id,
                parentId: current.parent.id,
                element: item,
                contentBlocks: blocks.filter(block => block.getAttribute("data-type") !== "NodeList"),
                children: [],
                collapsed: item.getAttribute("fold") === "1",
                virtual: false,
                taskMarker: item.getAttribute("data-subtype") === "t" ?
                    item.getAttribute("data-task") ?? item.querySelector(":scope > .protyle-action--task")?.getAttribute("data-task") ??
                    (item.classList.contains("protyle-task--done") ? "X" : " ") : undefined,
            };
            current.parent.children.push(node);
            nodes.set(id, node);
            // 子列表可以与其他正文块交错出现，只将直属子列表映射为下一级节点。
            blocks.filter(block => block.getAttribute("data-type") === "NodeList").reverse().forEach(child => {
                pending.push({list: child, parent: node});
            });
        }
    }
    const root = virtualRoot.children.length === 1 ? virtualRoot.children[0] : virtualRoot;
    if (root.virtual) {
        nodes.set(root.id, root);
    } else {
        delete root.parentId;
    }
    return {list, root, nodes, metadata};
};

const cleanListMindmapDOM = (root: Element | DocumentFragment) => {
    root.querySelectorAll(".list-mindmap").forEach(element => element.remove());
    const elements = Array.from(root.querySelectorAll("[data-list-mindmap-rendered], [data-list-mindmap-editing]"));
    if (root.nodeType === 1) {
        elements.push(root as Element);
    }
    elements.forEach(element => {
        element.removeAttribute("data-list-mindmap-rendered");
        element.removeAttribute("data-list-mindmap-editing");
    });
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const markers: Comment[] = [];
    while (walker.nextNode()) {
        if (walker.currentNode.nodeValue === "list-mindmap") {
            markers.push(walker.currentNode as Comment);
        }
    }
    markers.forEach(marker => marker.remove());
};

export const cleanListMindmapHTML = (html: string): string => {
    if (!html.includes("list-mindmap")) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    cleanListMindmapDOM(template.content);
    return template.innerHTML;
};

// 转换列表类型时退出脑图显示，保留节点、连接元数据及原 DOM 供撤销使用。
export const convertListMindmapToList = (element: Element, type: string, lute: Lute): string | undefined => {
    if (element.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) !== "1" ||
        !["OL2UL", "UL2OL", "UL2TL", "OL2TL", "TL2UL", "TL2OL"].includes(type)) {
        return;
    }
    const template = document.createElement("template");
    template.innerHTML = cleanListMindmapHTML(element.outerHTML);
    const source = template.content.firstElementChild;
    source.removeAttribute(Constants.CUSTOM_SY_LIST_MINDMAP);
    const from = {o: "OL", t: "TL", u: "UL"}[source.getAttribute("data-subtype")] || "UL";
    const to = type.split("2")[1];
    if (from === to) {
        return source.outerHTML;
    }
    // @ts-expect-error Lute 的类型声明未包含列表转换方法。
    return lute[`${from}2${to}`](source.outerHTML);
};

// 按每层最大宽度对齐节点，并为每个分支保留完整的垂直空间，避免富文本节点相互遮挡。
export const layoutListMindmap = (root: ListMindmapLayoutNode, options: {
    horizontalGap?: number;
    verticalGap?: number;
    padding?: number;
    horizontalGaps?: Map<string, number>;
    verticalGaps?: Map<string, number>;
} = {}) => {
    const horizontalGap = options.horizontalGap ?? 40;
    const verticalGap = options.verticalGap ?? 24;
    const padding = options.padding ?? 32;
    const gapBefore = (id: string) => Math.max(verticalGap, options.verticalGaps?.get(id) || 0);
    if ([horizontalGap, verticalGap, padding].some(value => !Number.isFinite(value) || value < 0)) {
        throw new Error("Invalid list mindmap layout spacing");
    }
    const ordered: {node: ListMindmapLayoutNode, depth: number, parentId?: string}[] = [];
    const pending = [{node: root, depth: 0, parentId: undefined as string | undefined}];
    const seen = new Set<string>();
    while (pending.length > 0) {
        const current = pending.pop();
        if (!current.node.id || seen.has(current.node.id) ||
            !Number.isFinite(current.node.width) || current.node.width <= 0 ||
            !Number.isFinite(current.node.height) || current.node.height <= 0) {
            throw new Error("Invalid list mindmap layout node");
        }
        seen.add(current.node.id);
        ordered.push(current);
        if (!current.node.collapsed) {
            [...current.node.children].reverse().forEach(node => {
                pending.push({node, depth: current.depth + 1, parentId: current.node.id});
            });
        }
    }
    const heights = new Map<string, number>();
    [...ordered].reverse().forEach(({node}) => {
        const children = node.collapsed ? [] : node.children;
        const childHeight = children.reduce((sum, child, index) => sum + heights.get(child.id) +
            (index ? gapBefore(child.id) : 0), 0);
        heights.set(node.id, Math.max(node.height, childHeight));
    });
    const tops = new Map([[root.id, padding]]);
    const nodes = new Map<string, ListMindmapPosition>();
    const edges: {from: string, to: string}[] = [];
    let width = padding;
    ordered.forEach(({node, parentId}) => {
        const top = tops.get(node.id);
        const height = heights.get(node.id);
        const parent = nodes.get(parentId);
        const position = {
            id: node.id,
            parentId,
            x: parent ? parent.x + parent.width + Math.max(horizontalGap, options.horizontalGaps?.get(node.id) || 0) : padding,
            y: top + (height - node.height) / 2,
            width: node.width,
            height: node.height,
        };
        nodes.set(node.id, position);
        width = Math.max(width, position.x + position.width);
        if (parentId) {
            edges.push({from: parentId, to: node.id});
        }
        const children = node.collapsed ? [] : node.children;
        const childHeight = children.reduce((sum, child, index) => sum + heights.get(child.id) +
            (index ? gapBefore(child.id) : 0), 0);
        let childTop = top + (height - childHeight) / 2;
        children.forEach((child, index) => {
            if (index) {
                childTop += gapBefore(child.id);
            }
            tops.set(child.id, childTop);
            childTop += heights.get(child.id);
        });
    });
    return {nodes, edges, width: width + padding, height: heights.get(root.id) + padding * 2};
};

const getListStart = (list: HTMLElement) => {
    const start = Number.parseInt(directItems(list)[0]?.getAttribute("data-marker"), 10);
    return Number.isFinite(start) ? start : 1;
};

const normalizeList = (list: HTMLElement, start: number) => {
    const subtype = list.getAttribute("data-subtype") || "u";
    const items = directItems(list);
    const markers = getOrderedListMarkerUpdates(items.map(item => item.getAttribute("data-marker")), start);
    items.forEach((item, index) => {
        const previousSubtype = item.getAttribute("data-subtype");
        item.setAttribute("data-subtype", subtype);
        let action = Array.from(item.children).find(child => child.classList.contains("protyle-action")) as HTMLElement;
        if (previousSubtype !== subtype || !action) {
            const replacement = list.ownerDocument.createElement("div");
            replacement.setAttribute("draggable", "true");
            replacement.setAttribute("contenteditable", "false");
            replacement.className = "protyle-action";
            if (subtype === "o") {
                replacement.classList.add("protyle-action--order");
            } else {
                if (subtype === "t") {
                    replacement.classList.add("protyle-action--task");
                    if (!item.hasAttribute("data-task")) {
                        item.setAttribute("data-task", " ");
                    }
                }
                const icon = subtype === "t" ? (item.getAttribute("data-task") === " " ? "iconUncheck" : "iconCheck") : "iconDot";
                replacement.innerHTML = `<svg><use xlink:href="#${icon}"></use></svg>`;
            }
            if (action) {
                action.replaceWith(replacement);
            } else {
                item.insertBefore(replacement, item.firstElementChild);
            }
            action = replacement;
        }
        if (subtype === "o") {
            const marker = markers[index] || item.getAttribute("data-marker");
            item.setAttribute("data-marker", marker);
            action.textContent = marker;
        } else {
            item.setAttribute("data-marker", "*");
        }
        if (subtype !== "t") {
            item.removeAttribute("data-task");
            item.classList.remove("protyle-task--done");
        } else {
            item.classList.toggle("protyle-task--done", item.getAttribute("data-task") !== " ");
        }
    });
};

const getDestinationList = (model: ListMindmapModel, targetId: string, placement: ListMindmapPlacement,
                            createListId: () => string): HTMLElement | undefined => {
    if (targetId === model.list.getAttribute("data-node-id")) {
        return placement === "child" ? model.list : undefined;
    }
    const target = model.nodes.get(targetId)?.element;
    if (!target) {
        return;
    }
    if (placement !== "child") {
        return target.parentElement;
    }
    let childList = directBlocks(target).find(child => child.getAttribute("data-type") === "NodeList");
    if (!childList) {
        const id = createListId();
        if (!id || model.nodes.has(id) || id === model.list.getAttribute("data-node-id") ||
            sourceBlocks(model.list).some(element => element.getAttribute("data-node-id") === id)) {
            throw new Error("Invalid new list identity");
        }
        childList = model.list.ownerDocument.createElement("div");
        childList.className = "list";
        childList.setAttribute("data-type", "NodeList");
        childList.setAttribute("data-node-id", id);
        childList.setAttribute("data-subtype", target.getAttribute("data-subtype") || "u");
        const attr = model.list.ownerDocument.createElement("div");
        attr.className = "protyle-attr";
        attr.setAttribute("contenteditable", "false");
        childList.appendChild(attr);
        target.insertBefore(childList, Array.from(target.children).find(child =>
            child.classList.contains("protyle-attr")) || null);
    }
    target.removeAttribute("fold");
    return childList;
};

const insertItem = (list: HTMLElement, item: HTMLElement, target: HTMLElement | undefined,
                    placement: ListMindmapPlacement) => {
    const reference = placement === "before" ? target : placement === "after" ? target.nextElementSibling :
        Array.from(list.children).find(child => child.classList.contains("protyle-attr")) || null;
    list.insertBefore(item, reference);
};

export const moveListMindmapNode = (list: HTMLElement, sourceId: string, targetId: string,
                                    placement: ListMindmapPlacement, createListId = () => Lute.NewNodeID()): boolean => {
    const model = readListMindmap(list);
    const source = model.nodes.get(sourceId)?.element;
    const target = model.nodes.get(targetId)?.element;
    if (!source || sourceId === targetId || (target && source.contains(target)) ||
        (!target && targetId !== list.getAttribute("data-node-id"))) {
        return false;
    }
    const oldList = source.parentElement;
    const oldStart = getListStart(oldList);
    const destination = getDestinationList(model, targetId, placement, createListId);
    if (!destination) {
        return false;
    }
    const destinationStart = getListStart(destination);
    insertItem(destination, source, target, placement);
    normalizeList(destination, destinationStart);
    if (oldList !== destination) {
        if (directItems(oldList).length === 0 && oldList !== list) {
            oldList.remove();
        } else {
            normalizeList(oldList, oldStart);
        }
    }
    return true;
};

export const addListMindmapNode = (list: HTMLElement, targetId: string, placement: ListMindmapPlacement,
                                   item: HTMLElement, createListId = () => Lute.NewNodeID()): boolean => {
    const model = readListMindmap(list);
    const id = item.getAttribute("data-node-id");
    if (item.getAttribute("data-type") !== "NodeListItem" || !id || model.nodes.has(id) ||
        id === list.getAttribute("data-node-id") || list.contains(item) || item.contains(list)) {
        return false;
    }
    const existingIds = new Set([list.getAttribute("data-node-id")]);
    sourceBlocks(list).forEach(block => existingIds.add(block.getAttribute("data-node-id")));
    const incomingIds = new Set<string>();
    for (const block of [item, ...Array.from(item.querySelectorAll("[data-node-id]"))]) {
        const blockId = block.getAttribute("data-node-id");
        if (!blockId || existingIds.has(blockId) || incomingIds.has(blockId)) {
            return false;
        }
        incomingIds.add(blockId);
    }
    const destination = getDestinationList(model, targetId, placement, createListId);
    if (!destination) {
        return false;
    }
    const start = getListStart(destination);
    insertItem(destination, item, model.nodes.get(targetId)?.element, placement);
    normalizeList(destination, start);
    return true;
};

export const deleteListMindmapNode = (list: HTMLElement, id: string): boolean => {
    const model = readListMindmap(list);
    const node = model.nodes.get(id);
    if (!node?.element || (node === model.root && !model.root.virtual)) {
        return false;
    }
    const removedIds = new Set<string>([id]);
    node.element.querySelectorAll("[data-node-id]").forEach(element => {
        removedIds.add(element.getAttribute("data-node-id"));
    });
    const parent = node.element.parentElement;
    const start = getListStart(parent);
    node.element.remove();
    if (directItems(parent).length === 0 && parent !== list) {
        parent.remove();
    } else {
        normalizeList(parent, start);
    }
    removedIds.forEach(removedId => delete model.metadata.nodes[removedId]);
    model.metadata.relations = model.metadata.relations.filter(relation =>
        !removedIds.has(relation.from) && !removedIds.has(relation.to));
    if (list.hasAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA)) {
        writeListMindmapMetadata(list, model.metadata);
    }
    return true;
};

// 只替换指定的直属正文块，并沿用块身份和属性，其余正文及嵌套列表保持原样。
export const replaceListMindmapBlock = (list: HTMLElement, nodeId: string, blockId: string,
                                        replacement: HTMLElement): boolean => {
    const node = readListMindmap(list).nodes.get(nodeId);
    const block = node?.contentBlocks.find(item => item.getAttribute("data-node-id") === blockId);
    if (!block || replacement.getAttribute("data-type") !== block.getAttribute("data-type")) {
        return false;
    }
    const updated = replacement.cloneNode(true) as HTMLElement;
    Array.from(block.attributes).forEach(attribute => updated.setAttribute(attribute.name, attribute.value));
    block.replaceWith(updated);
    return true;
};

// 按原正文槽位写入编辑结果，保留穿插在正文之间的子列表及未改写的持久属性。
export const replaceListMindmapContent = (list: HTMLElement, nodeId: string, blockHTML: string): boolean => {
    const node = readListMindmap(list).nodes.get(nodeId);
    if (!node?.element) {
        return false;
    }
    const template = list.ownerDocument.createElement("template");
    template.innerHTML = cleanListMindmapHTML(blockHTML);
    template.content.querySelectorAll("wbr").forEach(element => element.remove());
    const incoming = Array.from(template.content.children) as HTMLElement[];
    if (incoming.length === 0 || incoming.some(block => !block.hasAttribute("data-node-id") ||
        !block.getAttribute("data-type") || block.getAttribute("data-type") === "NodeListItem")) {
        return false;
    }
    const originals = new Map<string, HTMLElement>();
    node.contentBlocks.forEach(block => {
        originals.set(block.getAttribute("data-node-id"), block);
        block.querySelectorAll<HTMLElement>("[data-node-id]").forEach(child => {
            originals.set(child.getAttribute("data-node-id"), child);
        });
    });
    const existingIds = new Set([list.getAttribute("data-node-id")]);
    sourceBlocks(list).forEach(block => existingIds.add(block.getAttribute("data-node-id")));
    const incomingIds = new Set<string>();
    for (const block of Array.from(template.content.querySelectorAll<HTMLElement>("[data-node-id]"))) {
        const id = block.getAttribute("data-node-id");
        if (!id || incomingIds.has(id) || (existingIds.has(id) && !originals.has(id))) {
            return false;
        }
        incomingIds.add(id);
        const original = originals.get(id);
        if (original) {
            Array.from(original.attributes).forEach(attribute => {
                if (!block.hasAttribute(attribute.name) &&
                    !["data-type", "data-subtype", "class", "updated", "contenteditable", "data-task", "data-marker", "fold",
                        Constants.CUSTOM_SY_CODE_TAB_SPACES]
                        .includes(attribute.name) &&
                    !attribute.name.startsWith("data-list-mindmap-")) {
                    block.setAttribute(attribute.name, attribute.value);
                }
            });
        }
    }
    let lastInserted: HTMLElement;
    node.contentBlocks.forEach((block, index) => {
        if (incoming[index]) {
            block.replaceWith(incoming[index]);
            lastInserted = incoming[index];
        } else {
            block.remove();
        }
    });
    incoming.slice(node.contentBlocks.length).forEach(block => {
        if (lastInserted) {
            lastInserted.after(block);
        } else {
            node.element.insertBefore(block, Array.from(node.element.children).find(child =>
                child.classList.contains("protyle-attr")) || null);
        }
        lastInserted = block;
    });
    return true;
};

// 仅返回该节点正文中的源页签，预览副本和其他分支不参与保存。
export const getListMindmapTabItem = (list: HTMLElement, nodeId: string, itemId: string): HTMLElement | undefined => {
    const node = readListMindmap(list).nodes.get(nodeId);
    return node?.contentBlocks.flatMap(block => Array.from(block.querySelectorAll<HTMLElement>('[data-type="NodeTabItem"]')))
        .find(item => item.dataset.nodeId === itemId);
};
