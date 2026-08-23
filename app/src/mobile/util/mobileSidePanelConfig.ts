export const MOBILE_SIDE_PANEL_CONFIG_VERSION = 1 as const;
export const MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT = "siyuan-mobile-side-panel-config-change";

export const MOBILE_SIDE_PANEL_DOCK_IDS = [
    "file",
    "outline",
    "bookmark",
    "tag",
    "backlink",
    "inbox",
    "plugin",
] as const;

export type MobileSidePanelDockId = typeof MOBILE_SIDE_PANEL_DOCK_IDS[number];
export type MobileSidePanelSide = "left" | "right";

export interface IMobileSidePanelConfig {
    version: typeof MOBILE_SIDE_PANEL_CONFIG_VERSION,
    left: MobileSidePanelDockId[],
    right: MobileSidePanelDockId[],
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

export const DEFAULT_MOBILE_SIDE_PANEL_LEFT: readonly MobileSidePanelDockId[] = [
    "file",
    "bookmark",
    "tag",
    "inbox",
    "plugin",
];

export const DEFAULT_MOBILE_SIDE_PANEL_RIGHT: readonly MobileSidePanelDockId[] = [
    "outline",
    "backlink",
];

export const DEFAULT_MOBILE_SIDE_PANEL_CONFIG: Readonly<IMobileSidePanelConfig> = {
    version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
    left: [...DEFAULT_MOBILE_SIDE_PANEL_LEFT],
    right: [...DEFAULT_MOBILE_SIDE_PANEL_RIGHT],
};

const mobileSidePanelDockIdSet = new Set<string>(MOBILE_SIDE_PANEL_DOCK_IDS);

export const isMobileSidePanelDockId = (value: unknown): value is MobileSidePanelDockId => {
    return typeof value === "string" && mobileSidePanelDockIdSet.has(value);
};

export const createDefaultMobileSidePanelConfig = (): IMobileSidePanelConfig => ({
    version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
    left: [...DEFAULT_MOBILE_SIDE_PANEL_LEFT],
    right: [...DEFAULT_MOBILE_SIDE_PANEL_RIGHT],
});

const addValidDockIds = (
    target: MobileSidePanelDockId[],
    values: unknown[],
    used: Set<MobileSidePanelDockId>,
) => {
    values.forEach((value) => {
        if (isMobileSidePanelDockId(value) && !used.has(value)) {
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

export const normalizeMobileSidePanelConfig = (storedValue: unknown): IMobileSidePanelConfig => {
    let value = storedValue;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return createDefaultMobileSidePanelConfig();
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return createDefaultMobileSidePanelConfig();
    }

    const record = value as Record<string, unknown>;
    if (record.version !== MOBILE_SIDE_PANEL_CONFIG_VERSION ||
        !Array.isArray(record.left) || !Array.isArray(record.right)) {
        return createDefaultMobileSidePanelConfig();
    }

    const config: IMobileSidePanelConfig = {
        version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
        left: [],
        right: [],
    };
    const used = new Set<MobileSidePanelDockId>();
    addValidDockIds(config.left, record.left, used);
    addValidDockIds(config.right, record.right, used);
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

export const reduceMobileSidePanelConfig = (
    state: IMobileSidePanelConfig,
    event: MobileSidePanelConfigEvent,
): IMobileSidePanelConfig => {
    if (event.type === "reset") {
        return createDefaultMobileSidePanelConfig();
    }

    const currentState = normalizeMobileSidePanelConfig(state);
    const config: IMobileSidePanelConfig = {
        version: MOBILE_SIDE_PANEL_CONFIG_VERSION,
        left: [...currentState.left],
        right: [...currentState.right],
    };
    if (event.type === "reorder") {
        const docks = config[event.side];
        if (!Number.isInteger(event.fromIndex) || !Number.isInteger(event.toIndex) ||
            event.fromIndex < 0 || event.fromIndex >= docks.length ||
            event.toIndex < 0 || event.toIndex >= docks.length || event.fromIndex === event.toIndex) {
            return currentState;
        }
        const [dockId] = docks.splice(event.fromIndex, 1);
        docks.splice(event.toIndex, 0, dockId);
        return config;
    }

    if (!isMobileSidePanelDockId(event.id)) {
        return currentState;
    }
    const sourceSide: MobileSidePanelSide = config.left.includes(event.id) ? "left" : "right";
    const source = config[sourceSide];
    const target = config[event.side];
    if (sourceSide !== event.side && source.length === 1) {
        return currentState;
    }
    source.splice(source.indexOf(event.id), 1);
    target.splice(clampIndex(event.index, target.length), 0, event.id);
    return config;
};
