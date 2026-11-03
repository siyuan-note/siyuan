import {hasClosestBlock} from "../../util/hasClosest";

export interface IAVRelationContext {
    sourceAvID: string;
    sourceItemID: string;
    relationKeyID: string;
}

export interface IAVRelationHost {
    relationContext: IAVRelationContext;
    sourceBlockID: string;
    viewID: string;
    temporaryFilters: IAVFilter[];
    temporarySort?: IAVSort;
    active: boolean;
    available: boolean;
    readonly: () => boolean;
    rendered: (data: IAV) => void;
    failed: (message?: string) => void;
}

const relationHosts = new WeakMap<Element, IAVRelationHost>();
const editorHosts = new WeakMap<IProtyle, HTMLElement>();
const refreshListeners = new Map<string, Set<(avID: string) => void>>();

export const registerAVHostRefresh = (protyleID: string, callback: (avID: string) => void) => {
    let listeners = refreshListeners.get(protyleID);
    if (!listeners) refreshListeners.set(protyleID, listeners = new Set());
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
        if (!listeners.size) refreshListeners.delete(protyleID);
    };
};

export const notifyAVHostRefresh = (protyleID: string, avID: string) =>
    refreshListeners.get(protyleID)?.forEach(callback => callback(avID));

export const createAVHostProtyle = (protyle: IProtyle, element: HTMLElement): IProtyle => {
    const editor = new Proxy(protyle, {
        get(target, key, receiver) {
            if (key === "disabled") return !canEditAVHost(element, target);
            return Reflect.get(target, key, receiver);
        },
    });
    editorHosts.set(editor, element);
    return editor;
};

// 虚拟宿主只提交当前关联集合内的单元格写入，物理块附带操作没有载体可执行。
export const prepareAVHostTransaction = (protyle: IProtyle, operations: IOperation[]) => {
    const element = editorHosts.get(protyle);
    if (!element) return operations;
    const host = getAVRelationHost(element);
    if (!host || !element.isConnected || !host.active || protyle.disabled) return undefined;
    const updates = (operations || []).filter(operation => operation.action !== "doUpdateUpdated");
    if (updates.some(operation => !["updateAttrViewCell", "updateAttrViewCells"].includes(operation.action) ||
        operation.avID !== element.dataset.avId)) return undefined;
    return updates.map(operation => ({...operation, blockID: host.sourceBlockID,
        relationContext: {...host.relationContext}}));
};

export const setAVRelationHost = (element: HTMLElement, host: IAVRelationHost) => {
    relationHosts.set(element, host);
};

export const getAVRelationHost = (element: Element) => relationHosts.get(element);

export const deleteAVRelationHost = (element: Element) => relationHosts.delete(element);

// 数据库交互可以使用虚拟宿主，正文块命令仍只接受真实 data-node-id。
export const getAVHost = (node: Node): HTMLElement | false => {
    const element = node?.nodeType === 3 ? node.parentElement : node as HTMLElement;
    const host = element?.closest<HTMLElement>("[data-av-host]");
    return host && relationHosts.has(host) ? host : hasClosestBlock(node);
};

export const getAVHostBlockID = (element: HTMLElement) =>
    getAVRelationHost(element)?.sourceBlockID || element.dataset.nodeId || "";

export const getAVHostIdentity = (element: HTMLElement) =>
    element.dataset.avHost || element.dataset.nodeId || "";

export const canEditAVHost = (element: HTMLElement, protyle: IProtyle) => {
    const host = getAVRelationHost(element);
    if (element.dataset.avHost && !host) return false;
    return !protyle.disabled && !window.siyuan.config.readonly && !window.siyuan.isPublish &&
        !protyle.options.history?.created && !protyle.options.history?.snapshot &&
        (!host || (element.isConnected && host.active && host.available && !host.readonly()));
};
