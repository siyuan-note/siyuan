import {
    getDockEntryKey,
    getDockEntryPosition,
    getEntryCatalogChildren,
} from "./catalog";
import {mergeEntryOrderPreservingUnknown, reorderEntrySlots} from "./order";

export const DOCK_ORDER_SCOPE_BY_POSITION = {
    LeftTop: "dock.order.LeftTop",
    LeftBottom: "dock.order.LeftBottom",
    RightTop: "dock.order.RightTop",
    RightBottom: "dock.order.RightBottom",
    BottomLeft: "dock.order.BottomLeft",
    BottomRight: "dock.order.BottomRight",
} as const satisfies Record<TPluginDockPosition, string>;

export type TDockOrderScope = typeof DOCK_ORDER_SCOPE_BY_POSITION[TPluginDockPosition];
export type TDockOrderSnapshot = Record<TDockOrderScope, string[]>;

export const DOCK_ORDER_SCOPES_BY_SIDE: Record<"left" | "right", readonly TDockOrderScope[]> = {
    left: [
        DOCK_ORDER_SCOPE_BY_POSITION.LeftTop,
        DOCK_ORDER_SCOPE_BY_POSITION.LeftBottom,
        DOCK_ORDER_SCOPE_BY_POSITION.BottomLeft,
    ],
    right: [
        DOCK_ORDER_SCOPE_BY_POSITION.RightTop,
        DOCK_ORDER_SCOPE_BY_POSITION.RightBottom,
        DOCK_ORDER_SCOPE_BY_POSITION.BottomRight,
    ],
};

export const DOCK_ORDER_SCOPES: readonly TDockOrderScope[] = [
    ...DOCK_ORDER_SCOPES_BY_SIDE.left,
    ...DOCK_ORDER_SCOPES_BY_SIDE.right,
];

const DOCK_ORDER_SCOPE_SET = new Set<string>(DOCK_ORDER_SCOPES);

const DOCK_ORDER_SCOPE_META: Record<TDockOrderScope, {
    position: TPluginDockPosition;
    labelKey: string;
}> = {
    "dock.order.LeftTop": {position: "LeftTop", labelKey: "moveToLeftTop"},
    "dock.order.LeftBottom": {position: "LeftBottom", labelKey: "moveToLeftBottom"},
    "dock.order.RightTop": {position: "RightTop", labelKey: "moveToRightTop"},
    "dock.order.RightBottom": {position: "RightBottom", labelKey: "moveToRightBottom"},
    "dock.order.BottomLeft": {position: "BottomLeft", labelKey: "moveToBottomLeft"},
    "dock.order.BottomRight": {position: "BottomRight", labelKey: "moveToBottomRight"},
};

export interface IDockOrderLayout {
    leftDock?: {elements: HTMLElement[]};
    rightDock?: {elements: HTMLElement[]};
    bottomDock?: {elements: HTMLElement[]};
}

export interface IDockOrderDefaultEntry {
    key: string;
    position?: TPluginDockPosition;
}

type TDockOrdersByPosition = Partial<Record<TPluginDockPosition, readonly string[]>>;

const createEmptySnapshot = (): TDockOrderSnapshot => Object.fromEntries(
    DOCK_ORDER_SCOPES.map((scope) => [scope, []]),
) as TDockOrderSnapshot;

export const getDockOrderScopePosition = (scope: TDockOrderScope) => DOCK_ORDER_SCOPE_META[scope].position;

export const getDockOrderScopeLabelKey = (scope: TDockOrderScope) => DOCK_ORDER_SCOPE_META[scope].labelKey;

export const isDockOrderScope = (path: string): path is TDockOrderScope => DOCK_ORDER_SCOPE_SET.has(path);

export const getDockOrderContainer = (
    scope: TDockOrderScope,
    layout: IDockOrderLayout = window.siyuan.layout,
) => {
    switch (getDockOrderScopePosition(scope)) {
        case "LeftTop":
            return layout.leftDock?.elements[0];
        case "LeftBottom":
            return layout.leftDock?.elements[1];
        case "RightTop":
            return layout.rightDock?.elements[0];
        case "RightBottom":
            return layout.rightDock?.elements[1];
        case "BottomLeft":
            return layout.bottomDock?.elements[0];
        case "BottomRight":
            return layout.bottomDock?.elements[1];
    }
};

export const createDockEntryOrderSnapshot = (
    current: TDockOrdersByPosition,
    defaults: readonly IDockOrderDefaultEntry[] = [],
) => {
    const snapshot = createEmptySnapshot();
    const seen = new Set<string>();
    DOCK_ORDER_SCOPES.forEach((scope) => {
        const position = getDockOrderScopePosition(scope);
        (current[position] || []).forEach((key) => {
            if (!key || seen.has(key)) {
                return;
            }
            seen.add(key);
            snapshot[scope].push(key);
        });
    });
    defaults.forEach((item) => {
        if (!item.key || !item.position || seen.has(item.key)) {
            return;
        }
        seen.add(item.key);
        snapshot[DOCK_ORDER_SCOPE_BY_POSITION[item.position]].push(item.key);
    });
    return snapshot;
};

const mergeDockEntryOrders = (
    current: TDockOrderSnapshot,
    savedOrders?: Partial<Record<string, readonly string[]>>,
    useCurrentOrder = false,
    loadedKeys: ReadonlySet<string> = new Set(DOCK_ORDER_SCOPES.flatMap((scope) => current[scope])),
) => {
    const snapshot = createEmptySnapshot();
    DOCK_ORDER_SCOPES.forEach((scope) => {
        const currentKeys = new Set(current[scope]);
        const savedOrder = savedOrders?.[scope]?.filter((key) => !loadedKeys.has(key) || currentKeys.has(key));
        snapshot[scope] = mergeEntryOrderPreservingUnknown(
            current[scope],
            savedOrder ? [...savedOrder] : undefined,
            useCurrentOrder ? current[scope] : undefined,
        );
    });
    return snapshot;
};

export const mergeDockEntryOrderSnapshot = (
    current: TDockOrderSnapshot,
    savedOrders?: Partial<Record<string, readonly string[]>>,
) => mergeDockEntryOrders(current, savedOrders);

export const mergeCurrentDockEntryOrders = (
    current: TDockOrderSnapshot,
    savedOrders?: Partial<Record<string, readonly string[]>>,
) => mergeDockEntryOrders(current, savedOrders, true);

const getContainerEntryKeys = (container?: HTMLElement) => {
    if (!container) {
        return [];
    }
    return Array.from(container.children).reduce<string[]>((keys, item) => {
        if (!item.classList.contains("dock__item")) {
            return keys;
        }
        const key = getDockEntryKey(item);
        if (key) {
            keys.push(key);
        }
        return keys;
    }, []);
};

export const getDockEntryOrderSnapshot = (
    layout: IDockOrderLayout = window.siyuan.layout,
) => {
    const current: TDockOrdersByPosition = {};
    DOCK_ORDER_SCOPES.forEach((scope) => {
        current[getDockOrderScopePosition(scope)] = getContainerEntryKeys(getDockOrderContainer(scope, layout));
    });
    const defaults = (getEntryCatalogChildren("dock") || []).map((item) => ({
        key: item.key,
        position: getDockEntryPosition(item.key),
    }));
    return createDockEntryOrderSnapshot(current, defaults);
};

export const applyDockEntryOrderSnapshot = (
    snapshot: TDockOrderSnapshot,
    layout: IDockOrderLayout = window.siyuan.layout,
) => {
    let changed = false;
    DOCK_ORDER_SCOPES.forEach((scope) => {
        const container = getDockOrderContainer(scope, layout);
        if (!container) {
            return;
        }
        const items = Array.from(container.children).filter((item): item is HTMLElement =>
            item.classList.contains("dock__item"));
        const ordered = reorderEntrySlots(items, snapshot[scope], getDockEntryKey);
        if (ordered.every((item, index) => item === items[index])) {
            return;
        }
        ordered.forEach((item) => container.append(item));
        changed = true;
    });
    return changed;
};
