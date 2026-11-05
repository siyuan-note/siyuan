import {fetchSyncPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {toggleMenu} from "../menus/menuToggle";
import {initDocTreeMenu} from "../menus/navigation";
import {notebookTreeItem} from "../layout/dock/docTree/rowData";
import {renderDocTreeRow} from "../layout/dock/docTree/row";
import type {IDocTreeItem} from "../layout/dock/docTree/types";

export interface IOpenDocTreeMenuOptions {
    position?: {x: number, y: number, w?: number, h?: number};
    items: {notebookId: string, id?: string}[];
}

const validID = (id: unknown): id is string => typeof id === "string" && /^\d{14}-[a-z0-9]{7}$/.test(id);

const getNotebook = (id: string) => window.siyuan.notebooks?.find(notebook => notebook.id === id &&
    !notebook.closed && (!notebook.encrypted || notebook.unlocked &&
        (notebook.state === undefined || notebook.state === "Unlocked")));

const normalizeOptions = (options: IOpenDocTreeMenuOptions) => {
    if (!options || !Array.isArray(options.items) || options.items.length === 0) {
        return;
    }
    const position = options.position;
    if (position !== undefined && (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) ||
        [position.w, position.h].some(value => value !== undefined && (!Number.isFinite(value) || value < 0)))) {
        return;
    }
    if (!isMobile() && !position) {
        return;
    }
    const keys = new Set<string>();
    const items: IOpenDocTreeMenuOptions["items"] = [];
    for (const item of options.items) {
        if (!item || !validID(item.notebookId) || item.id !== undefined && !validID(item.id)) {
            return;
        }
        const key = JSON.stringify([item.id === undefined ? "notebook" : "document", item.notebookId, item.id]);
        if (!keys.has(key)) {
            items.push({notebookId: item.notebookId, id: item.id});
            keys.add(key);
        }
    }
    return {items, position: position ? {x: position.x, y: position.y, w: position.w, h: position.h} : undefined};
};

const resolveItem = async (target: IOpenDocTreeMenuOptions["items"][number],
                           isCurrent: () => boolean): Promise<IDocTreeItem | undefined> => {
    const notebook = getNotebook(target.notebookId);
    if (!notebook || !isCurrent()) {
        return;
    }
    if (target.id === undefined) {
        return notebookTreeItem({...notebook});
    }
    const {id, notebookId} = target;
    if (id === notebookId) {
        if (!window.siyuan.config.fileTree.boxDocEnabled) {
            return;
        }
        const info = await fetchSyncPost("/api/block/getBlockInfo", {id, notebook: notebookId}, undefined, false);
        if (!isCurrent() || info.code !== 0 || !info.data || info.data.box !== notebookId ||
            info.data.rootID !== id || info.data.path !== `/${id}.sy`) {
            return;
        }
        const doc = await fetchSyncPost("/api/block/getDocInfo", {id, notebook: notebookId}, undefined, false);
        if (!isCurrent() || doc.code !== 0 || !doc.data || doc.data.id !== id || doc.data.rootID !== id ||
            typeof doc.data.name !== "string" || !Number.isInteger(doc.data.subFileCount) || doc.data.subFileCount < 0) {
            return;
        }
        const file: IFile = {
            id, path: info.data.path, name: doc.data.name, icon: doc.data.icon, subFileCount: doc.data.subFileCount,
            count: doc.data.refCount, name1: "", alias: "", memo: "", bookmark: "", hMtime: "", hCtime: "", hSize: "",
            childrenSortMode: null, titleEmpty: info.data.rootTitleEmpty,
        };
        return {...notebookTreeItem({...notebook}), kind: "document", path: file.path, name: file.name,
            subFileCount: file.subFileCount, file, occurrenceKey: `document:${notebookId}:${id}`};
    }
    const located = await fetchSyncPost("/api/filetree/locateDocTreeItem", {notebook: notebookId, id}, undefined, false);
    if (!isCurrent() || located.code !== 0 || located.data?.box !== notebookId || located.data.id !== id) {
        return;
    }
    const steps = located.data.steps;
    const step = steps?.[steps.length - 1];
    if (!step || step.id !== id || !Number.isInteger(step.index) || step.index < 0 ||
        typeof step.path !== "string" || !step.revision) {
        return;
    }
    const response = await fetchSyncPost("/api/filetree/listDocTreeRange", {
        notebook: notebookId, parentID: step.parentID, offset: step.index, limit: 1, revision: step.revision,
    }, undefined, false);
    if (!isCurrent() || response.code !== 0) {
        return;
    }
    const range = response.data;
    const file = range?.files?.[0];
    const path = `${step.path === "/" ? "" : step.path.replace(/\.sy$/, "")}/${id}.sy`;
    if (!range || range.stale || range.box !== notebookId || range.parentID !== step.parentID ||
        range.path !== step.path || range.revision !== step.revision || range.offset !== step.index ||
        range.files?.length !== 1 || !file || file.id !== id || file.path !== path ||
        typeof file.name !== "string" || !Number.isInteger(file.subFileCount) || file.subFileCount < 0 ||
        !Number.isInteger(range.effectiveSortMode)) {
        return;
    }
    return {
        id, notebookId, kind: "document", path, name: file.name, subFileCount: file.subFileCount,
        file, notebook: {...notebook}, occurrenceKey: `document:${notebookId}:${id}`,
        parentID: step.parentID, childrenSortMode: file.childrenSortMode ?? null,
        effectiveSortMode: range.effectiveSortMode, depth: steps.length - 1, index: step.index, setSize: range.total,
    };
};

const hasAmbiguousDocuments = (items: IDocTreeItem[]) => {
    const ids = new Map<string, string>();
    const paths = new Map<string, string>();
    return items.some(item => {
        if (item.kind !== "document") {
            return false;
        }
        if (ids.has(item.id) && ids.get(item.id) !== item.notebookId ||
            paths.has(item.path) && paths.get(item.path) !== item.notebookId) {
            return true;
        }
        ids.set(item.id, item.notebookId);
        paths.set(item.path, item.notebookId);
        return false;
    });
};

export const openDocTreeMenu = async (options: IOpenDocTreeMenuOptions): Promise<boolean> => {
    const normalized = normalizeOptions(options);
    if (!normalized || !window.siyuan.menus?.menu || !window.siyuan.ws?.app || !document.body ||
        normalized.items.some(item => !getNotebook(item.notebookId))) {
        return false;
    }
    let opened = false;
    await toggleMenu({
        target: document.body,
        toggle: false,
        build: async (menu, session) => {
            const isCurrent = () => session.isCurrent() && window.siyuan.menus.menu === menu;
            const isAvailable = (item: IDocTreeItem) => getNotebook(item.notebookId) &&
                (item.kind !== "document" || item.id !== item.notebookId || window.siyuan.config.fileTree.boxDocEnabled);
            try {
                const items: IDocTreeItem[] = [];
                for (const target of normalized.items) {
                    const item = await resolveItem(target, isCurrent);
                    if (!isCurrent()) {
                        return;
                    }
                    if (!item) {
                        menu.remove();
                        return;
                    }
                    items.push(item);
                }
                if (!isCurrent() || items.some(item => !isAvailable(item)) || hasAmbiguousDocuments(items)) {
                    if (isCurrent()) { menu.remove(); }
                    return;
                }
                let elements: NodeListOf<HTMLElement>;
                initDocTreeMenu(window.siyuan.ws.app, {
                    items,
                    target: document.body,
                    position: normalized.position,
                    isCurrent,
                    elements: () => {
                        if (!elements) {
                            const snapshot = document.createElement("ul");
                            items.forEach(item => snapshot.append(renderDocTreeRow(item, {mobile: isMobile()})));
                            elements = snapshot.querySelectorAll<HTMLElement>("li[data-tree-key]");
                        }
                        return elements;
                    },
                });
                if (!isCurrent() || items.some(item => !isAvailable(item))) {
                    if (isCurrent()) { menu.remove(); }
                    return;
                }
                if (isMobile()) {
                    menu.fullscreen("bottom", undefined, {isCurrent});
                } else {
                    menu.popup(normalized.position, isCurrent);
                }
                opened = isCurrent() && !menu.element.classList.contains("fn__none");
            } catch {
                if (isCurrent()) {
                    menu.remove();
                }
            }
        },
    });
    return opened;
};
