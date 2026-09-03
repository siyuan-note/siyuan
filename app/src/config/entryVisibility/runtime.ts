import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {
    getEntryCatalogDefaultVisibility,
    getEntryCatalogChildren,
    getEntryCatalogNode,
    getDockEntryKey,
    getEntryOrderParents,
    getEntryParentPath,
    getEntryPaths,
    isEntryCatalogNodeConfigurable,
    refreshDockCatalog,
    refreshTopBarCatalog,
    TOP_BAR_ROOT_PATH,
} from "./catalog";
import {
    mergeEntryOrderPreservingUnknown,
    reorderEntrySlots,
    resolveEntryOrder,
    resolveEntryOrderWithBoundaryDefaults,
} from "./order";
import {getDocTreeEntryScope} from "./docTreeScope";
import {getBuiltinProfileEntryVisibility, getProfileEntryVisibility} from "./profile";
import {TOOLBAR_ENTRY_ROOT_PATH} from "../../protyle/toolbar/defaults";
import {resolveToolbarItems} from "../../protyle/toolbar/entryVisibility";
import {syncDockBarVisibility} from "../../layout/dock/barVisibility";
import {genUUID} from "../../util/genID";
import {
    applyDockEntryOrderSnapshot,
    getDockEntryOrderSnapshot,
    isDockOrderScope,
    mergeCurrentDockEntryOrders,
    mergeDockEntryOrderSnapshot,
} from "./dockOrder";

export const ENTRY_VISIBILITY_VERSION = 4;
export const ENTRY_PROFILE_SIMPLE = "simple";
export const ENTRY_PROFILE_FULL = "full";
export type TEntryVisibilityTemplate = typeof ENTRY_PROFILE_SIMPLE | typeof ENTRY_PROFILE_FULL;

const getConfig = () => window.siyuan.config.appearance.entryVisibility;

export const getActiveEntryProfile = () => {
    const config = getConfig();
    return config.profiles.find((item) => item.id === config.active);
};

const getTemplateVisibility = (path: string, template: TEntryVisibilityTemplate) =>
    getBuiltinProfileEntryVisibility(
        template,
        getEntryCatalogNode(path)?.simple !== false,
        getEntryCatalogDefaultVisibility(path),
    );

export const isEntryVisible = (path: string): boolean => {
    /// #if MOBILE
    return true;
    /// #else
    const config = getConfig();
    const active = config.active;
    let visible: boolean;
    if (active === ENTRY_PROFILE_FULL) {
        visible = getTemplateVisibility(path, ENTRY_PROFILE_FULL);
    } else if (active === ENTRY_PROFILE_SIMPLE) {
        visible = getTemplateVisibility(path, ENTRY_PROFILE_SIMPLE);
    } else {
        visible = getProfileEntryVisibility(getActiveEntryProfile(), path, getEntryCatalogDefaultVisibility(path));
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

export const createEntryProfileSnapshot = (template: TEntryVisibilityTemplate) => {
    return getEntryPaths().reduce<Record<string, boolean>>((entries, path) => {
        entries[path] = getTemplateVisibility(path, template);
        return entries;
    }, {});
};

export const getEntryOrder = (parentPath: string, profile = getActiveEntryProfile()) => {
    if (isDockOrderScope(parentPath)) {
        return mergeDockEntryOrderSnapshot(getDockEntryOrderSnapshot(), profile?.orders)[parentPath];
    }
    const nodes = getEntryCatalogChildren(parentPath) || [];
    const defaultOrder = nodes.map((item) => item.key);
    const separatorKeys = new Set(nodes.filter((item) => item.type === "separator").map((item) => item.key));
    if (parentPath === TOP_BAR_ROOT_PATH) {
        return resolveEntryOrderWithBoundaryDefaults(defaultOrder, profile?.orders?.[parentPath], "drag", separatorKeys);
    }
    return resolveEntryOrder(defaultOrder, profile?.orders?.[parentPath], separatorKeys);
};

export const createEntryOrderSnapshot = (current = false) => {
    refreshDockCatalog(window.siyuan.ws?.app?.plugins || []);
    const orders = getEntryOrderParents().reduce<Record<string, string[]>>((result, parentPath) => {
        const nodes = getEntryCatalogChildren(parentPath) || [];
        result[parentPath] = current
            ? getEntryOrder(parentPath)
            : nodes.map((item) => item.key);
        return result;
    }, {});
    return {...orders, ...getDockEntryOrderSnapshot()};
};

const cloneEntryVisibilityConfig = () => JSON.parse(JSON.stringify(
    window.siyuan.config.appearance.entryVisibility
)) as Config.IEntryVisibility;

const uniqueEntryProfileName = (name: string, profiles: Config.IEntryVisibilityProfile[]) => {
    if (!profiles.some((item) => item.name === name)) {
        return name;
    }
    let index = 2;
    while (profiles.some((item) => item.name === `${name} (${index})`)) {
        index++;
    }
    return `${name} (${index})`;
};

const getWritableEntryProfile = (config: Config.IEntryVisibility) => {
    const activeProfile = config.profiles.find((item) => item.id === config.active);
    if (activeProfile) {
        return activeProfile;
    }
    const template = config.active === ENTRY_PROFILE_SIMPLE ? ENTRY_PROFILE_SIMPLE : ENTRY_PROFILE_FULL;
    const profile: Config.IEntryVisibilityProfile = {
        id: genUUID(),
        name: uniqueEntryProfileName(window.siyuan.languages.entryCustomProfile, config.profiles),
        entries: createEntryProfileSnapshot(template),
        orders: createEntryOrderSnapshot(true),
    };
    config.profiles.push(profile);
    config.active = profile.id;
    return profile;
};

export const setEntryVisibilityValue = (path: string, visible: boolean) => {
    const node = getEntryCatalogNode(path);
    if (window.siyuan.config.readonly || !node || !isEntryCatalogNodeConfigurable(node)) {
        return;
    }
    const config = cloneEntryVisibilityConfig();
    const profile = getWritableEntryProfile(config);
    profile.entries[path] = visible;
    saveEntryVisibility(config);
};

export const setEntryOrderValue = (parentPath: string, order: string[]) => {
    const dockOrder = isDockOrderScope(parentPath) ? getDockEntryOrderSnapshot()[parentPath] : undefined;
    const nodes = dockOrder ? undefined : getEntryCatalogChildren(parentPath);
    if (window.siyuan.config.readonly || (!dockOrder && !nodes)) {
        return;
    }
    const config = cloneEntryVisibilityConfig();
    const profile = getWritableEntryProfile(config);
    const defaultOrder = dockOrder || nodes.map((item) => item.key);
    const separatorKeys = new Set(nodes?.filter((item) => item.type === "separator").map((item) => item.key));
    profile.orders[parentPath] = mergeEntryOrderPreservingUnknown(
        defaultOrder,
        profile.orders[parentPath],
        order,
        separatorKeys,
    );
    saveEntryVisibility(config);
};

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

export const syncDockEntryOrders = () => {
    if (window.siyuan.config.readonly) {
        return;
    }
    refreshDockCatalog(window.siyuan.ws?.app?.plugins || []);
    const currentOrders = getDockEntryOrderSnapshot();
    const config = cloneEntryVisibilityConfig();
    const profile = getWritableEntryProfile(config);
    profile.orders ||= {};
    Object.assign(profile.orders, mergeCurrentDockEntryOrders(currentOrders, profile.orders));
    saveEntryVisibility(config);
};

const entryScope = (menuElement: HTMLElement): string => {
    switch (menuElement.dataset.name) {
        case Constants.MENU_DOC_TREE_PANEL_MORE:
            return "docTree.panel";
        case Constants.MENU_DOC_TREE_MORE:
            return getDocTreeEntryScope(menuElement.dataset.from, {
                notebook: Constants.MENU_FROM_DOC_TREE_MORE_NOTEBOOK,
                notebooks: Constants.MENU_FROM_DOC_TREE_MORE_NOTEBOOKS,
                doc: Constants.MENU_FROM_DOC_TREE_MORE_DOC,
                docs: Constants.MENU_FROM_DOC_TREE_MORE_DOCS,
                items: Constants.MENU_FROM_DOC_TREE_MORE_ITEMS,
            });
        case Constants.MENU_TAB:
            return "tab";
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
        const id = item.getAttribute("data-id");
        const path = id ? `${prefix}.${id}` : "";
        if (item.classList.contains("b3-menu__separator")) {
            if (path && getEntryCatalogNode(path) && !isEntryVisible(path)) {
                item.remove();
            }
            return;
        }
        if (!item.classList.contains("b3-menu__item")) {
            return;
        }
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
    refreshDockCatalog(window.siyuan.ws?.app?.plugins || []);
    applyDockEntryOrderSnapshot(mergeDockEntryOrderSnapshot(
        getDockEntryOrderSnapshot(),
        getActiveEntryProfile()?.orders,
    ));
    document.querySelectorAll<HTMLElement>(".dock__item[data-type]").forEach((item) => {
        const type = item.dataset.type;
        const key = getDockEntryKey(item);
        const path = key ? `dock.${key}` : "";
        if (!getEntryCatalogNode(path)) {
            return;
        }
        const visible = isEntryVisible(path);
        if (!visible && item.classList.contains("dock__item--active")) {
            const dock = [window.siyuan.layout.leftDock, window.siyuan.layout.rightDock, window.siyuan.layout.bottomDock]
                .find((candidate) => candidate?.elements.some((element) => element.contains(item)));
            dock?.toggleModel(type, false, false, false, true, false);
        }
        item.classList.toggle("fn__none", !visible);
    });
    syncDockBarVisibility();
    /// #endif
};

export const applyToolbarEntryVisibility = (toolbarElement: HTMLElement) => {
    /// #if !MOBILE
    const children = Array.from(toolbarElement.children) as HTMLElement[];
    const resolveKey = (item: HTMLElement) => {
        const id = item.dataset.id;
        return id && getEntryCatalogNode(`${TOOLBAR_ENTRY_ROOT_PATH}.${id}`) ? id : undefined;
    };
    const result = resolveToolbarItems(children, {
        getKey: resolveKey,
        isSeparator: (item) => item.classList.contains("protyle-toolbar__divider"),
        isVisible: (key) => isEntryVisible(`${TOOLBAR_ENTRY_ROOT_PATH}.${key}`),
        order: getEntryOrder(TOOLBAR_ENTRY_ROOT_PATH),
    });
    result.ordered.forEach((item) => toolbarElement.append(item));
    const visibleItems = new Set(result.visible);
    result.ordered.forEach((item) => item.classList.toggle("fn__none", !visibleItems.has(item)));
    const empty = !result.visible.some((item) => item.classList.contains("protyle-toolbar__item"));
    toolbarElement.toggleAttribute("data-entry-empty", empty);
    if (empty) {
        toolbarElement.classList.add("fn__none");
    }
    /// #endif
};

export const refreshTopBarEntryCatalog = () => {
    /// #if !MOBILE
    refreshTopBarCatalog(window.siyuan.ws?.app?.plugins || []);
    /// #endif
};

export const applyTopBarEntryVisibility = () => {
    /// #if !MOBILE
    const toolbarElement = document.getElementById("toolbar");
    const barMoreElement = document.getElementById("barMore");
    const dragElement = document.getElementById("drag");
    if (!toolbarElement || !barMoreElement || !dragElement) {
        return;
    }
    refreshTopBarEntryCatalog();
    const entryElements = Array.from(toolbarElement.querySelectorAll<HTMLElement>(
        ":scope > [data-topbar-entry]"));
    const elementByKey = new Map(entryElements.map((item) => [item.dataset.topbarEntry, item]));
    getEntryOrder(TOP_BAR_ROOT_PATH).forEach((key) => {
        const item = key === "drag" ? dragElement : elementByKey.get(key);
        if (item) {
            barMoreElement.before(item);
        }
    });
    entryElements.forEach((item) => {
        const key = item.dataset.topbarEntry;
        const path = key ? `${TOP_BAR_ROOT_PATH}.${key}` : "";
        if (path && getEntryCatalogNode(path) && !isEntryVisible(path)) {
            item.setAttribute("data-entry-hidden", "true");
        } else {
            item.removeAttribute("data-entry-hidden");
        }
    });
    /// #endif
};

const applyEntryVisibilityLocal = (config: Config.IEntryVisibility) => {
    window.siyuan.config.appearance.entryVisibility = config;
    /// #if !MOBILE
    window.siyuan.menus?.menu?.remove();
    applyTopBarEntryVisibility();
    applyDockEntryVisibility();
    document.querySelectorAll<HTMLElement>(".protyle-toolbar").forEach(applyToolbarEntryVisibility);
    window.dispatchEvent(new CustomEvent("siyuan-entry-visibility"));
    /// #endif
};

export const applyEntryVisibility = (config: Config.IEntryVisibility) => {
    if (saveRunning || savePending) {
        return;
    }
    applyEntryVisibilityLocal(config);
};
