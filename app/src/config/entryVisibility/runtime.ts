import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {
    getEntryCatalogChildren,
    getEntryCatalogNode,
    getEntryOrderParents,
    getEntryParentPath,
    getEntryPaths,
} from "./catalog";
import {reorderEntrySlots, resolveEntryOrder} from "./order";

export const ENTRY_VISIBILITY_VERSION = 2;
export const ENTRY_PROFILE_SIMPLE = "simple";
export const ENTRY_PROFILE_FULL = "full";

const getConfig = () => window.siyuan.config.appearance.entryVisibility;

export const getActiveEntryProfile = () => {
    const config = getConfig();
    return config.profiles.find((item) => item.id === config.active);
};

const getBaseVisibility = (path: string, base: Config.TEntryVisibilityBase) =>
    base === ENTRY_PROFILE_FULL || getEntryCatalogNode(path)?.simple !== false;

export const isEntryVisible = (path: string): boolean => {
    /// #if MOBILE
    return true;
    /// #else
    const config = getConfig();
    let visible: boolean;
    if (config.active === ENTRY_PROFILE_FULL) {
        visible = true;
    } else if (config.active === ENTRY_PROFILE_SIMPLE) {
        visible = getBaseVisibility(path, ENTRY_PROFILE_SIMPLE);
    } else {
        const profile = getActiveEntryProfile();
        visible = typeof profile?.entries[path] === "boolean"
            ? profile.entries[path]
            : getBaseVisibility(path, profile?.base || ENTRY_PROFILE_FULL);
    }
    if (!visible) {
        return false;
    }
    const parentPath = getEntryParentPath(path);
    if (parentPath && getEntryCatalogNode(parentPath)) {
        return isEntryVisible(parentPath);
    }
    return true;
    /// #endif
};

export const createEntryProfileSnapshot = (base: Config.TEntryVisibilityBase) => {
    return getEntryPaths().reduce<Record<string, boolean>>((entries, path) => {
        entries[path] = getBaseVisibility(path, base);
        return entries;
    }, {});
};

export const getEntryOrder = (parentPath: string, profile = getActiveEntryProfile()) => {
    const nodes = getEntryCatalogChildren(parentPath) || [];
    const defaultOrder = nodes.map((item) => item.key);
    const separatorKeys = new Set(nodes.filter((item) => item.type === "separator").map((item) => item.key));
    return resolveEntryOrder(defaultOrder, profile?.orders?.[parentPath], separatorKeys);
};

export const createEntryOrderSnapshot = (current = false) => getEntryOrderParents()
    .reduce<Record<string, string[]>>((orders, parentPath) => {
        const nodes = getEntryCatalogChildren(parentPath) || [];
        orders[parentPath] = current
            ? getEntryOrder(parentPath)
            : nodes.map((item) => item.key);
        return orders;
    }, {});

let savePending: Config.IEntryVisibility | undefined;
let saveRunning = false;

const flushEntryVisibility = () => {
    if (saveRunning || !savePending) {
        return;
    }
    saveRunning = true;
    const next = savePending;
    savePending = undefined;
    fetchPost("/api/setting/setEntryVisibility", next, (response) => {
        saveRunning = false;
        if (response.code === 0 && !savePending) {
            applyEntryVisibility(response.data as Config.IEntryVisibility);
        }
        flushEntryVisibility();
    });
};

export const saveEntryVisibility = (config: Config.IEntryVisibility) => {
    applyEntryVisibilityLocal(config);
    savePending = config;
    flushEntryVisibility();
};

const entryScope = (menuElement: HTMLElement): string => {
    switch (menuElement.dataset.name) {
        case Constants.MENU_DOC_TREE_PANEL_MORE:
            return "docTree.panel";
        case Constants.MENU_DOC_TREE_MORE:
            if (menuElement.dataset.from === Constants.MENU_FROM_DOC_TREE_MORE_NOTEBOOK) {
                return "docTree.notebook";
            }
            if (menuElement.dataset.from === Constants.MENU_FROM_DOC_TREE_MORE_DOC) {
                return "docTree.document";
            }
            if (menuElement.dataset.from === Constants.MENU_FROM_DOC_TREE_MORE_ITEMS) {
                return "docTree.multi";
            }
            return "";
        case Constants.MENU_TITLE:
            return "document.title";
        case Constants.MENU_BREADCRUMB_MORE:
            return "document.more";
        case Constants.MENU_BLOCK_SINGLE:
            return "gutter.single";
        case Constants.MENU_BLOCK_MULTI:
            return "gutter.multi";
        case Constants.MENU_INLINE_CONTEXT:
            return "inline.text";
        case Constants.MENU_INLINE_IMG:
            return "inline.image";
        case Constants.MENU_INLINE_REF:
            return "inline.ref";
        case Constants.MENU_INLINE_A:
            return "inline.link";
        case Constants.MENU_INLINE_FILE_ANNOTATION_REF:
            return "inline.fileAnnotation";
        case Constants.MENU_INLINE_TAG:
            return "inline.tag";
        case Constants.MENU_INLINE_MATH:
            return "inline.math";
        default:
            return "";
    }
};

const normalizeSeparators = (itemsElement: Element) => {
    Array.from(itemsElement.children).forEach((item) => {
        const submenu = item.querySelector(":scope > .b3-menu__submenu > .b3-menu__items");
        if (submenu) {
            normalizeSeparators(submenu);
            if (!submenu.querySelector(":scope > .b3-menu__item")) {
                item.remove();
            }
        }
    });
    let hasItem = false;
    let previousSeparator = false;
    const children = Array.from(itemsElement.children);
    children.forEach((item, index) => {
        if (item.classList.contains("b3-menu__separator")) {
            const hasNextItem = children.slice(index + 1).some((next) =>
                !next.classList.contains("b3-menu__separator") && next.isConnected);
            if (!hasItem || !hasNextItem || previousSeparator) {
                item.remove();
            } else {
                previousSeparator = true;
            }
            return;
        }
        hasItem = true;
        previousSeparator = false;
    });
};

const sortMenuItems = (itemsElement: Element, prefix: string) => {
    const catalogNodes = getEntryCatalogChildren(prefix);
    if (catalogNodes) {
        const children = Array.from(itemsElement.children);
        reorderEntrySlots(children, getEntryOrder(prefix), (item) => item.getAttribute("data-id"))
            .forEach((item) => itemsElement.append(item));
    }
    Array.from(itemsElement.children).forEach((item) => {
        if (!item.classList.contains("b3-menu__item")) {
            return;
        }
        const id = item.getAttribute("data-id");
        const submenu = item.querySelector(":scope > .b3-menu__submenu > .b3-menu__items");
        if (id && submenu && getEntryCatalogNode(`${prefix}.${id}`)) {
            sortMenuItems(submenu, `${prefix}.${id}`);
        }
    });
};

const filterMenuItems = (itemsElement: Element, prefix: string) => {
    Array.from(itemsElement.children).forEach((item) => {
        if (!item.classList.contains("b3-menu__item")) {
            return;
        }
        const id = item.getAttribute("data-id");
        const path = id ? `${prefix}.${id}` : "";
        if (path && getEntryCatalogNode(path) && !isEntryVisible(path)) {
            item.remove();
            return;
        }
        const submenu = item.querySelector(":scope > .b3-menu__submenu > .b3-menu__items");
        if (submenu) {
            filterMenuItems(submenu, path || prefix);
        }
    });
};

export const applyMenuEntryVisibility = (menuElement: HTMLElement) => {
    /// #if !MOBILE
    const scope = entryScope(menuElement);
    if (!scope) {
        return;
    }
    const itemsElement = menuElement.querySelector(":scope > .b3-menu__items") || menuElement.lastElementChild;
    if (!itemsElement) {
        return;
    }
    sortMenuItems(itemsElement, scope);
    filterMenuItems(itemsElement, scope);
    normalizeSeparators(itemsElement);
    /// #endif
};

export const applyDockEntryVisibility = () => {
    /// #if !MOBILE
    document.querySelectorAll<HTMLElement>(".dock__item[data-type]").forEach((item) => {
        const type = item.dataset.type;
        const path = `dock.${type}`;
        if (!getEntryCatalogNode(path)) {
            return;
        }
        const visible = isEntryVisible(path);
        if (!visible && item.classList.contains("dock__item--active")) {
            const dock = [window.siyuan.layout.leftDock, window.siyuan.layout.rightDock, window.siyuan.layout.bottomDock]
                .find((candidate) => candidate?.elements.some((element) => element.contains(item)));
            dock?.toggleModel(type, false, false, false, true);
        }
        item.classList.toggle("fn__none", !visible);
    });
    /// #endif
};

const applyEntryVisibilityLocal = (config: Config.IEntryVisibility) => {
    window.siyuan.config.appearance.entryVisibility = config;
    /// #if !MOBILE
    window.siyuan.menus?.menu?.remove();
    applyDockEntryVisibility();
    window.dispatchEvent(new CustomEvent("siyuan-entry-visibility"));
    /// #endif
};

export const applyEntryVisibility = (config: Config.IEntryVisibility) => {
    if (saveRunning || savePending) {
        return;
    }
    applyEntryVisibilityLocal(config);
};
