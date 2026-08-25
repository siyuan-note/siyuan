export const MOBILE_SIDE_PANEL_CONFIG_VERSION = 3 as const;
export const MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT = "siyuan-mobile-side-panel-config-change";

export const MOBILE_SIDE_PANEL_DOCK_IDS = [
    "file",
    "outline",
    "bookmark",
    "tag",
    "backlink",
    "inbox",
    "agent",
] as const;

export type MobileSidePanelBuiltInDockId = typeof MOBILE_SIDE_PANEL_DOCK_IDS[number];
export type MobileSidePanelDockId = string;
export type MobileSidePanelSide = "left" | "right";

export interface IMobileSidePanelPluginDock {
    id: string,
    side: MobileSidePanelSide,
    index?: number,
}

export interface IMobileSidePanelConfig {
    version: typeof MOBILE_SIDE_PANEL_CONFIG_VERSION,
    left: MobileSidePanelDockId[],
    right: MobileSidePanelDockId[],
    pluginDockIds: string[],
}

export type MobileSidePanelConfigEvent = {
    type: "move",
    id: MobileSidePanelDockId,
    side: MobileSidePanelSide,
    index?: number,
} | {
    type: "reorder",
    side: MobileSidePanelSide,
    fromIndex: number,
    toIndex: number,
} | {
    type: "reset",
};

export const DEFAULT_MOBILE_SIDE_PANEL_LEFT: readonly MobileSidePanelBuiltInDockId[] = [
    "file",
    "bookmark",
    "tag",
    "inbox",
];

export const DEFAULT_MOBILE_SIDE_PANEL_RIGHT: readonly MobileSidePanelBuiltInDockId[] = [
    "outline",
    "backlink",
    "agent",
];

export const DEFAULT_MOBILE_SIDE_PANEL_CONFIG: Readonly<IMobileSidePanelConfig> = {
    version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
    left: [...DEFAULT_MOBILE_SIDE_PANEL_LEFT],
    right: [...DEFAULT_MOBILE_SIDE_PANEL_RIGHT],
    pluginDockIds: [],
};

const mobileSidePanelDockIdSet = new Set<string>(MOBILE_SIDE_PANEL_DOCK_IDS);

export const isMobileSidePanelBuiltInDockId = (value: unknown): value is MobileSidePanelBuiltInDockId => {
    return typeof value === "string" && mobileSidePanelDockIdSet.has(value);
};

const normalizePluginDocks = (pluginDocks: readonly IMobileSidePanelPluginDock[]) => {
    const used = new Set<string>();
    return pluginDocks
        .map((dock, order) => ({...dock, order}))
        .filter((dock) => {
            if (!dock.id || isMobileSidePanelBuiltInDockId(dock.id) || used.has(dock.id)) {
                return false;
            }
            used.add(dock.id);
            return true;
        })
        .sort((first, second) =>
            (first.index ?? 1000) - (second.index ?? 1000) || first.order - second.order);
};

export const createDefaultMobileSidePanelConfig = (
    pluginDocks: readonly IMobileSidePanelPluginDock[] = [],
): IMobileSidePanelConfig => {
    const config: IMobileSidePanelConfig = {
        version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
        left: [...DEFAULT_MOBILE_SIDE_PANEL_LEFT],
        right: [...DEFAULT_MOBILE_SIDE_PANEL_RIGHT],
        pluginDockIds: [],
    };
    normalizePluginDocks(pluginDocks).forEach((dock) => {
        config[dock.side].push(dock.id);
    });
    config.pluginDockIds = [...config.left, ...config.right].filter(id => !isMobileSidePanelBuiltInDockId(id));
    return config;
};

const addValidDockIds = (
    target: MobileSidePanelDockId[],
    values: unknown[],
    validPluginDockIds: Set<string>,
    used: Set<MobileSidePanelDockId>,
) => {
    values.forEach((value) => {
        if (typeof value === "string" &&
            (isMobileSidePanelBuiltInDockId(value) || validPluginDockIds.has(value)) && !used.has(value)) {
            target.push(value);
            used.add(value);
        }
    });
};

const moveDefaultDockToEmptySide = (
    config: IMobileSidePanelConfig,
    side: MobileSidePanelSide,
) => {
    if (config[side].length > 0) {
        return;
    }
    const sourceSide: MobileSidePanelSide = side === "left" ? "right" : "left";
    const defaults = side === "left" ? DEFAULT_MOBILE_SIDE_PANEL_LEFT : DEFAULT_MOBILE_SIDE_PANEL_RIGHT;
    const dockId = defaults.find((id) => config[sourceSide].includes(id)) || config[sourceSide][0];
    config[sourceSide].splice(config[sourceSide].indexOf(dockId), 1);
    config[side].push(dockId);
};

export const normalizeMobileSidePanelConfig = (
    storedValue: unknown,
    pluginDocks: readonly IMobileSidePanelPluginDock[] = [],
): IMobileSidePanelConfig => {
    let value = storedValue;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return createDefaultMobileSidePanelConfig(pluginDocks);
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return createDefaultMobileSidePanelConfig(pluginDocks);
    }

    const record = value as Record<string, unknown>;
    if ((record.version !== 1 && record.version !== 2 && record.version !== MOBILE_SIDE_PANEL_CONFIG_VERSION) ||
        !Array.isArray(record.left) || !Array.isArray(record.right) ||
        (record.version === MOBILE_SIDE_PANEL_CONFIG_VERSION && !Array.isArray(record.pluginDockIds))) {
        return createDefaultMobileSidePanelConfig(pluginDocks);
    }

    const activePluginDocks = normalizePluginDocks(pluginDocks);
    const activePluginDockIds = new Set(activePluginDocks.map(item => item.id));
    const rememberedPluginDockIds = new Set<string>();
    if (record.version === MOBILE_SIDE_PANEL_CONFIG_VERSION) {
        (record.pluginDockIds as unknown[]).forEach((value) => {
            if (typeof value === "string" && value && !isMobileSidePanelBuiltInDockId(value)) {
                rememberedPluginDockIds.add(value);
            }
        });
    }
    const validPluginDockIds = new Set([...rememberedPluginDockIds, ...activePluginDockIds]);
    const config: IMobileSidePanelConfig = {
        version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
        left: [],
        right: [],
        pluginDockIds: [],
    };
    const used = new Set<MobileSidePanelDockId>();
    addValidDockIds(config.left, record.left, validPluginDockIds, used);
    addValidDockIds(config.right, record.right, validPluginDockIds, used);
    DEFAULT_MOBILE_SIDE_PANEL_LEFT.forEach((id) => {
        if (!used.has(id)) {
            config.left.push(id);
            used.add(id);
        }
    });
    DEFAULT_MOBILE_SIDE_PANEL_RIGHT.forEach((id) => {
        if (!used.has(id)) {
            config.right.push(id);
            used.add(id);
        }
    });
    activePluginDocks.forEach((dock, index) => {
        if (!used.has(dock.id)) {
            const sideDockIds = config[dock.side];
            const nextDock = activePluginDocks.slice(index + 1)
                .find(item => item.side === dock.side && sideDockIds.includes(item.id));
            const previousDock = activePluginDocks.slice(0, index).reverse()
                .find(item => item.side === dock.side && sideDockIds.includes(item.id));
            if (nextDock) {
                sideDockIds.splice(sideDockIds.indexOf(nextDock.id), 0, dock.id);
            } else if (previousDock) {
                sideDockIds.splice(sideDockIds.indexOf(previousDock.id) + 1, 0, dock.id);
            } else {
                sideDockIds.push(dock.id);
            }
            used.add(dock.id);
        }
    });
    config.pluginDockIds = [...config.left, ...config.right].filter((id) => validPluginDockIds.has(id));
    moveDefaultDockToEmptySide(config, "left");
    moveDefaultDockToEmptySide(config, "right");
    return config;
};

const clampIndex = (index: number | undefined, length: number) => {
    if (typeof index !== "number" || !Number.isInteger(index)) {
        return length;
    }
    return Math.max(0, Math.min(index, length));
};

const getAvailableDockIds = (pluginDocks: readonly IMobileSidePanelPluginDock[]) => {
    return new Set<string>([
        ...MOBILE_SIDE_PANEL_DOCK_IDS,
        ...normalizePluginDocks(pluginDocks).map(item => item.id),
    ]);
};

export const reduceMobileSidePanelConfig = (
    state: IMobileSidePanelConfig,
    event: MobileSidePanelConfigEvent,
    pluginDocks: readonly IMobileSidePanelPluginDock[] = [],
): IMobileSidePanelConfig => {
    if (event.type === "reset") {
        return createDefaultMobileSidePanelConfig(pluginDocks);
    }

    const currentState = normalizeMobileSidePanelConfig(state, pluginDocks);
    const config: IMobileSidePanelConfig = {
        version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
        left: [...currentState.left],
        right: [...currentState.right],
        pluginDockIds: [...currentState.pluginDockIds],
    };
    const availableDockIds = getAvailableDockIds(pluginDocks);
    if (event.type === "reorder") {
        const docks = config[event.side];
        const visibleDocks = docks.filter(id => availableDockIds.has(id));
        if (!Number.isInteger(event.fromIndex) || !Number.isInteger(event.toIndex) ||
            event.fromIndex < 0 || event.fromIndex >= visibleDocks.length ||
            event.toIndex < 0 || event.toIndex >= visibleDocks.length || event.fromIndex === event.toIndex) {
            return currentState;
        }
        const sourceIndex = docks.indexOf(visibleDocks[event.fromIndex]);
        const targetIndex = docks.indexOf(visibleDocks[event.toIndex]);
        [docks[sourceIndex], docks[targetIndex]] = [docks[targetIndex], docks[sourceIndex]];
        return config;
    }

    const sourceSide = config.left.includes(event.id) ? "left" : config.right.includes(event.id) ? "right" : undefined;
    if (!sourceSide || !availableDockIds.has(event.id)) {
        return currentState;
    }
    const source = config[sourceSide];
    const target = config[event.side];
    const visibleSource = source.filter(id => availableDockIds.has(id));
    if (sourceSide !== event.side && visibleSource.length === 1) {
        return currentState;
    }
    source.splice(source.indexOf(event.id), 1);
    const visibleTarget = target.filter(id => availableDockIds.has(id));
    const visibleTargetIndex = clampIndex(event.index, visibleTarget.length);
    const targetIndex = visibleTargetIndex === visibleTarget.length ? target.length :
        target.indexOf(visibleTarget[visibleTargetIndex]);
    target.splice(targetIndex, 0, event.id);
    return config;
};
