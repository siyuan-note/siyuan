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
export type TDockEntryMover = (
    scope: TDockOrderScope,
    item: HTMLElement,
    previousItem?: HTMLElement,
) => void;

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

const normalizeDockEntryOrderSnapshot = (
    orders?: Partial<Record<string, readonly string[]>>,
) => {
    const snapshot = createEmptySnapshot();
    const seen = new Set<string>();
    DOCK_ORDER_SCOPES.forEach((scope) => {
        const order = orders?.[scope];
        if (!Array.isArray(order)) {
            return;
        }
        order.forEach((key) => {
            if (typeof key !== "string" || !key || seen.has(key)) {
                return;
            }
            seen.add(key);
            snapshot[scope].push(key);
        });
    });
    return snapshot;
};

const getDockEntryOwners = (snapshot: TDockOrderSnapshot) => {
    const owners = new Map<string, TDockOrderScope>();
    DOCK_ORDER_SCOPES.forEach((scope) => snapshot[scope].forEach((key) => owners.set(key, scope)));
    return owners;
};

const hasDockEntryOrders = (orders?: Partial<Record<string, readonly string[]>>) =>
    DOCK_ORDER_SCOPES.some((scope) => Array.isArray(orders?.[scope]));

const normalizeCurrentPlacementSavedOrders = (
    orders: Partial<Record<string, readonly string[]>>,
    currentOwners: ReadonlyMap<string, TDockOrderScope>,
) => {
    const snapshot = createEmptySnapshot();
    const seen = new Set<string>();
    DOCK_ORDER_SCOPES.forEach((scope) => {
        const order = orders[scope];
        if (!Array.isArray(order)) {
            return;
        }
        order.forEach((key) => {
            const currentOwner = currentOwners.get(key);
            if (!key || seen.has(key) || currentOwner && currentOwner !== scope) {
                return;
            }
            seen.add(key);
            snapshot[scope].push(key);
        });
    });
    return snapshot;
};

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
    useCurrentPlacement = false,
) => {
    const normalizedCurrent = normalizeDockEntryOrderSnapshot(current);
    if (!hasDockEntryOrders(savedOrders)) {
        return normalizedCurrent;
    }
    const currentOwners = getDockEntryOwners(normalizedCurrent);
    const normalizedSaved = useCurrentPlacement
        ? normalizeCurrentPlacementSavedOrders(savedOrders, currentOwners)
        : normalizeDockEntryOrderSnapshot(savedOrders);
    const savedOwners = getDockEntryOwners(normalizedSaved);
    const snapshot = createEmptySnapshot();
    DOCK_ORDER_SCOPES.forEach((scope) => {
        const currentOrder = normalizedCurrent[scope];
        const savedOrder = normalizedSaved[scope];
        const defaultOrder = useCurrentPlacement
            ? currentOrder
            : currentOrder.filter((key) => !savedOwners.has(key) || savedOwners.get(key) === scope);
        if (!useCurrentPlacement) {
            const defaultKeys = new Set(defaultOrder);
            savedOrder.forEach((key) => {
                if (currentOwners.has(key) && !defaultKeys.has(key)) {
                    defaultKeys.add(key);
                    defaultOrder.push(key);
                }
            });
        }
        snapshot[scope] = mergeEntryOrderPreservingUnknown(
            defaultOrder,
            savedOrder,
            useCurrentPlacement ? currentOrder : undefined,
        );
    });
    return normalizeDockEntryOrderSnapshot(snapshot);
};

export const mergeDockEntryOrderSnapshot = (
    current: TDockOrderSnapshot,
    savedOrders?: Partial<Record<string, readonly string[]>>,
) => mergeDockEntryOrders(current, savedOrders);

export const mergeCurrentDockEntryOrders = (
    current: TDockOrderSnapshot,
    savedOrders?: Partial<Record<string, readonly string[]>>,
) => mergeDockEntryOrders(current, savedOrders, true);

export const moveDockEntryOrderSnapshot = (
    snapshot: TDockOrderSnapshot,
    sourceKey: string,
    targetScope: TDockOrderScope,
    targetKey?: string,
    after = false,
) => {
    if (!sourceKey || !isDockOrderScope(targetScope) || sourceKey === targetKey) {
        return;
    }
    const normalized = normalizeDockEntryOrderSnapshot(snapshot);
    const sourceScope = DOCK_ORDER_SCOPES.find((scope) => normalized[scope].includes(sourceKey));
    if (!sourceScope) {
        return;
    }
    if (targetKey && !normalized[targetScope].includes(targetKey)) {
        return;
    }
    const moved = normalizeDockEntryOrderSnapshot(normalized);
    DOCK_ORDER_SCOPES.forEach((scope) => {
        moved[scope] = moved[scope].filter((key) => key !== sourceKey);
    });
    const targetOrder = moved[targetScope];
    const targetIndex = targetKey
        ? targetOrder.indexOf(targetKey) + (after ? 1 : 0)
        : targetOrder.length;
    targetOrder.splice(targetIndex, 0, sourceKey);
    const changed = DOCK_ORDER_SCOPES.some((scope) =>
        normalized[scope].length !== moved[scope].length ||
        normalized[scope].some((key, index) => key !== moved[scope][index]));
    return changed ? moved : undefined;
};

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

export const getCurrentDockEntryOrderSnapshot = (
    layout: IDockOrderLayout = window.siyuan.layout,
) => {
    const current: TDockOrdersByPosition = {};
    DOCK_ORDER_SCOPES.forEach((scope) => {
        current[getDockOrderScopePosition(scope)] = getContainerEntryKeys(getDockOrderContainer(scope, layout));
    });
    return createDockEntryOrderSnapshot(current);
};

export const getDockEntryOrderSnapshot = (
    layout: IDockOrderLayout = window.siyuan.layout,
) => {
    const snapshot = getCurrentDockEntryOrderSnapshot(layout);
    const seen = new Set(DOCK_ORDER_SCOPES.flatMap((scope) => snapshot[scope]));
    const defaults = (getEntryCatalogChildren("dock") || []).map((item) => ({
        key: item.key,
        position: getDockEntryPosition(item.key),
    }));
    defaults.forEach((item) => {
        if (!item.key || !item.position || seen.has(item.key)) {
            return;
        }
        seen.add(item.key);
        snapshot[DOCK_ORDER_SCOPE_BY_POSITION[item.position]].push(item.key);
    });
    return snapshot;
};

export const applyDockEntryOrderSnapshot = (
    snapshot: TDockOrderSnapshot,
    layout: IDockOrderLayout = window.siyuan.layout,
    mover?: TDockEntryMover,
) => {
    const normalized = normalizeDockEntryOrderSnapshot(snapshot);
    const moveItem: TDockEntryMover = mover || ((scope, item, previousItem) => {
        const container = getDockOrderContainer(scope, layout);
        if (!container) {
            return;
        }
        if (previousItem && Array.from(container.children).includes(previousItem)) {
            previousItem.after(item);
            return;
        }
        const firstItem = Array.from(container.children).find((child) => child.classList.contains("dock__item"));
        if (firstItem && firstItem !== item) {
            firstItem.before(item);
        } else if (!Array.from(container.children).includes(item)) {
            container.append(item);
        }
    });
    const itemsByKey = new Map<string, HTMLElement>();
    DOCK_ORDER_SCOPES.forEach((scope) => {
        const container = getDockOrderContainer(scope, layout);
        if (!container) {
            return;
        }
        Array.from(container.children).forEach((item) => {
            if (!item.classList.contains("dock__item")) {
                return;
            }
            const key = getDockEntryKey(item);
            if (key && !itemsByKey.has(key)) {
                itemsByKey.set(key, item as HTMLElement);
            }
        });
    });
    let changed = false;
    DOCK_ORDER_SCOPES.forEach((scope) => {
        const container = getDockOrderContainer(scope, layout);
        if (!container) {
            return;
        }
        let previousItem: HTMLElement | undefined;
        normalized[scope].forEach((key) => {
            const item = itemsByKey.get(key);
            if (!item) {
                return;
            }
            if (!Array.from(container.children).includes(item)) {
                moveItem(scope, item, previousItem);
                changed = true;
            }
            previousItem = item;
        });
    });
    DOCK_ORDER_SCOPES.forEach((scope) => {
        const container = getDockOrderContainer(scope, layout);
        if (!container) {
            return;
        }
        const items = Array.from(container.children).filter((item): item is HTMLElement =>
            item.classList.contains("dock__item"));
        const ordered = reorderEntrySlots<HTMLElement>(items, normalized[scope], getDockEntryKey);
        let previousItem: HTMLElement | undefined;
        ordered.forEach((item, index) => {
            const liveItems = Array.from(container.children).filter((child) =>
                child.classList.contains("dock__item"));
            if (liveItems[index] !== item) {
                moveItem(scope, item, previousItem);
                changed = true;
            }
            previousItem = item;
        });
    });
    return changed;
};
