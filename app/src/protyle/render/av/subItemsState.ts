import {Constants} from "../../../constants";
import {setStorageVal} from "../../util/compatibility";
import {isEncryptedBox} from "../../../util/pathName";

const STORAGE_KEY = "local-av-sub-items";

export interface ISubItemsRequest {
    groupExpandedIDs: Record<string, string[]>;
    childPaging: Record<string, {page: number; pageSize: number}>;
}

const states = new WeakMap<Element, Map<string, ISubItemsRequest>>();
const cleanups = new WeakMap<Element, Set<() => void>>();
const queryContexts = new WeakMap<Element, string>();
const viewportAnchors = new WeakMap<Element, {itemID: string; groupID: string; rowHeight: number;
    previousIndex?: number; fallbackIDs: string[]}>();

export const clearSubItemsViewportAnchor = (blockElement: Element) => viewportAnchors.delete(blockElement);

export const setSubItemsViewportAnchor = (blockElement: Element, itemID: string, groupID: string, rowHeight: number,
                                        previousIndex?: number, fallbackIDs: string[] = []) => {
    viewportAnchors.set(blockElement, {itemID, groupID, rowHeight: Math.max(1, rowHeight), previousIndex, fallbackIDs});
};

export const prepareSubItemsViewport = (blockElement: Element, data: IAV, windows: Record<string, IAVVirtualData>) => {
    const anchor = viewportAnchors.get(blockElement);
    viewportAnchors.delete(blockElement);
    if (!anchor) return;
    // 显式定位已按目标计算窗口，不能被同时发生的单元格刷新锚点覆盖。
    if (data.target?.status === "visible") return;
    const view = (anchor.groupID ? data.view.groups?.find(group => group.id === anchor.groupID) : data.view) as IAVTable;
    if (!view?.nested) return;
    const key = anchor.groupID || "all";
    if (windows[key]?.locate) return;
    if (view.rows.length <= 100) {
        delete windows[key];
        return;
    }
    const indices = new Map(view.rows.map((row, index) => [row.id, index]));
    const survivor = [anchor.itemID, ...anchor.fallbackIDs].find(id => indices.has(id));
    const index = indices.get(survivor) ?? -1;
    if (index < 0) return;
    const previous = windows[key];
    if (survivor === anchor.itemID && index === anchor.previousIndex && previous &&
        previous.renderedStart <= index && previous.renderedEnd >= index) return;
    const offset = survivor === anchor.itemID && Number.isFinite(anchor.previousIndex) && previous ?
        anchor.previousIndex - previous.renderedStart : 50;
    const start = Math.max(0, Math.min(index - offset, view.rows.length - 100));
    windows[key] = {renderedStart: start, renderedEnd: start + 99,
        topSpacerHeight: start * anchor.rowHeight};
};

export const registerSubItemsCleanup = (blockElement: Element, cleanup: () => void) => {
    let callbacks = cleanups.get(blockElement);
    if (!callbacks) {
        callbacks = new Set();
        cleanups.set(blockElement, callbacks);
    }
    callbacks.add(cleanup);
    return () => callbacks.delete(cleanup);
};

export const clearSubItemsState = (root: Element) => {
    root.querySelectorAll("[data-av-id]").forEach(element => {
        states.delete(element);
        queryContexts.delete(element);
        viewportAnchors.delete(element);
        cleanups.get(element)?.forEach(cleanup => cleanup());
        cleanups.delete(element);
    });
};

const stateKey = (blockElement: Element, viewID: string) =>
    `${blockElement.getAttribute("data-av-id")}/${viewID}`;

export const getSubItemsState = (blockElement: Element, viewID: string, persistent = false): ISubItemsRequest => {
    let views = states.get(blockElement);
    if (!views) {
        views = new Map();
        states.set(blockElement, views);
    }
    let state = views.get(viewID);
    if (!state) {
        const saved = persistent ? window.siyuan.storage?.[STORAGE_KEY]?.[stateKey(blockElement, viewID)] : undefined;
        const groupExpandedIDs: Record<string, string[]> = {};
        if (saved && typeof saved === "object" && !Array.isArray(saved)) {
            Object.entries(saved).forEach(([groupID, ids]) => {
                if (Array.isArray(ids)) {
                    groupExpandedIDs[groupID] = ids.filter((id): id is string => typeof id === "string");
                }
            });
        }
        state = {groupExpandedIDs, childPaging: {}};
        views.set(viewID, state);
    }
    return state;
};

const canPersist = (protyle: IProtyle) => Boolean(protyle.notebookId && !isEncryptedBox(protyle.notebookId) &&
    !protyle.options.history && !window.siyuan.isPublish);

export const getSubItemsRequest = (blockElement: Element, protyle: IProtyle, viewID?: string, query?: string) => {
    const id = viewID || blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "";
    const search = query ?? blockElement.querySelector('[data-type="av-search"]')?.textContent?.trim() ?? "";
    const context = `${id}/${search}`;
    if (queryContexts.has(blockElement) && queryContexts.get(blockElement) !== context) {
        blockElement.querySelectorAll<HTMLElement>(".av__body").forEach(body => { delete body.dataset.rootPage; });
    }
    queryContexts.set(blockElement, context);
    const searchKey = `${id}/search:${search}`;
    states.get(blockElement)?.forEach((_state, key, views) => {
        if (key.startsWith(`${id}/search:`) && (!search || key !== searchKey)) {
            views.delete(key);
        }
    });
    return getSubItemsState(blockElement, search ? searchKey : id, !search && canPersist(protyle));
};

export const restoreSubItemsView = (blockElement: Element, protyle: IProtyle, data: IAV,
                                    requested: ISubItemsRequest, query: string) => {
    if (!data.view.nested) return false;
    const restored = getSubItemsRequest(blockElement, protyle, data.viewID, query);
    if (restored === requested || JSON.stringify(restored) === JSON.stringify(requested)) return false;
    // 首次读取由内核确定视图，按其身份重新读取已保存的展开状态。
    blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, data.viewID);
    return true;
};

export const toggleSubItems = (blockElement: Element, protyle: IProtyle, groupID: string, itemID: string, expanded: boolean) => {
    const viewID = blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "";
    const state = getSubItemsRequest(blockElement, protyle, viewID);
    const ids = new Set(state.groupExpandedIDs[groupID] || []);
    if (expanded) {
        ids.add(itemID);
    } else {
        ids.delete(itemID);
    }
    state.groupExpandedIDs[groupID] = [...ids];
    if (canPersist(protyle) && !blockElement.querySelector('[data-type="av-search"]')?.textContent?.trim()) {
        const value = {...window.siyuan.storage[STORAGE_KEY], [stateKey(blockElement, viewID)]: state.groupExpandedIDs};
        window.siyuan.storage[STORAGE_KEY] = value;
        void setStorageVal(STORAGE_KEY, value);
    }
};

export const loadMoreSubItems = (blockElement: Element, protyle: IProtyle, groupID: string, parentID: string,
                               page: number, pageSize: number) => {
    const state = getSubItemsRequest(blockElement, protyle);
    state.childPaging[groupID ? `${groupID}/${parentID}` : parentID] = {page: Math.max(1, page), pageSize};
};

export const reconcileSubItems = (blockElement: HTMLElement, protyle: IProtyle, data: IAV, query: string) => {
    blockElement.toggleAttribute("data-sub-items", Boolean(data.subItems?.enabled));
    blockElement.toggleAttribute("data-sub-items-nested", Boolean(data.view.nested));
    if (query || !data.view.nested) {
        return;
    }
    const state = getSubItemsRequest(blockElement, protyle, data.viewID);
    const groups = data.view.groups?.length ? data.view.groups : [data.view];
    groups.forEach(view => {
        const groupID = data.view.groups?.length ? view.id : "";
        const ids = new Set(state.groupExpandedIDs[groupID] || []);
        (view as IAVTable).rows?.forEach(row => {
            if (row.hierarchy?.expanded) {
                ids.add(row.id);
            }
        });
        state.groupExpandedIDs[groupID] = [...ids];
        Object.entries(view.nested?.childPaging || {}).forEach(([parentID, paging]) => {
            state.childPaging[groupID ? `${groupID}/${parentID}` : parentID] = {page: paging.page, pageSize: paging.pageSize};
        });
    });
};

export const getSubItemsControlHTML = (row: IAVRow, data: IAVTable) => {
    const hierarchy = row.hierarchy;
    if (!hierarchy) {
        return "";
    }
    const paging = data.nested?.childPaging?.[row.id];
    return `<span class="av__sub-items" style="padding-left:${hierarchy.depth * 20}px">${hierarchy.childCount ?
        `<button class="block__icon block__icon--show" data-type="av-sub-items-toggle" aria-expanded="${hierarchy.expanded}" aria-label="${window.siyuan.languages[hierarchy.expanded ? "collapse" : "expand"]}"><svg${hierarchy.expanded ? ' style="transform:rotate(90deg)"' : ""}><use xlink:href="#iconRight"></use></svg></button>` :
        '<span class="av__sub-items-space"></span>'}${hierarchy.expanded && paging ?
        `${paging.page > 1 ? `<button class="block__icon block__icon--show" data-type="av-sub-items-more" data-page="${paging.page - 1}" data-page-size="${paging.pageSize}" aria-label="${window.siyuan.languages.previous}"><svg><use xlink:href="#iconLeft"></use></svg></button>` : ""}${paging.page * paging.pageSize < paging.total ? `<button class="block__icon block__icon--show" data-type="av-sub-items-more" data-page="${paging.page + 1}" data-page-size="${paging.pageSize}" aria-label="${window.siyuan.languages.next}"><svg><use xlink:href="#iconRight"></use></svg></button>` : ""}` : ""}</span>`;
};
