export const MOBILE_BOTTOM_BAR_CONFIG_VERSION = 1 as const;

export const MOBILE_BOTTOM_BAR_ACTIONS = [
    "documents",
    "search",
    "newDoc",
    "tabs",
    "recent",
    "outline",
    "bookmark",
    "tag",
    "backlink",
    "inbox",
    "agent",
    "spacedRepetition",
    "command",
] as const;

export type MobileBottomBarAction = typeof MOBILE_BOTTOM_BAR_ACTIONS[number];
export type MobileBottomBarSlot = 0 | 1 | 2 | 3;
export type MobileBottomBarSlots = readonly [
    MobileBottomBarAction,
    MobileBottomBarAction,
    MobileBottomBarAction,
    MobileBottomBarAction,
];

export interface IMobileBottomBarConfig {
    version: typeof MOBILE_BOTTOM_BAR_CONFIG_VERSION,
    actions: MobileBottomBarSlots,
}

export type MobileBottomBarConfigEvent = {
    type: "select-action",
    slot: MobileBottomBarSlot,
    action: MobileBottomBarAction,
} | {
    type: "reset",
};

export const DEFAULT_MOBILE_BOTTOM_BAR_ACTIONS: MobileBottomBarSlots = [
    "documents",
    "search",
    "newDoc",
    "tabs",
];

export const DEFAULT_MOBILE_BOTTOM_BAR_CONFIG: IMobileBottomBarConfig = {
    version: MOBILE_BOTTOM_BAR_CONFIG_VERSION,
    actions: DEFAULT_MOBILE_BOTTOM_BAR_ACTIONS,
};

const mobileBottomBarActionSet = new Set<string>(MOBILE_BOTTOM_BAR_ACTIONS);

export const isMobileBottomBarAction = (value: unknown): value is MobileBottomBarAction => {
    return typeof value === "string" && mobileBottomBarActionSet.has(value);
};

const toMobileBottomBarSlots = (actions: MobileBottomBarAction[]): MobileBottomBarSlots => {
    return [actions[0], actions[1], actions[2], actions[3]];
};

const normalizeMobileBottomBarActions = (storedActions: unknown[]): MobileBottomBarSlots => {
    const actions = new Array<MobileBottomBarAction>(4);
    const usedActions = new Set<MobileBottomBarAction>();

    for (let slot = 0; slot < actions.length; slot++) {
        const action = storedActions[slot];
        if (isMobileBottomBarAction(action) && !usedActions.has(action)) {
            actions[slot] = action;
            usedActions.add(action);
        }
    }

    const fallbackActions: readonly MobileBottomBarAction[] = [
        ...DEFAULT_MOBILE_BOTTOM_BAR_ACTIONS,
        ...MOBILE_BOTTOM_BAR_ACTIONS,
    ];
    let fallbackIndex = 0;
    for (let slot = 0; slot < actions.length; slot++) {
        if (actions[slot]) {
            continue;
        }
        while (usedActions.has(fallbackActions[fallbackIndex])) {
            fallbackIndex++;
        }
        actions[slot] = fallbackActions[fallbackIndex];
        usedActions.add(actions[slot]);
    }

    return toMobileBottomBarSlots(actions);
};

export const createDefaultMobileBottomBarConfig = (): IMobileBottomBarConfig => ({
    version: MOBILE_BOTTOM_BAR_CONFIG_VERSION,
    actions: [...DEFAULT_MOBILE_BOTTOM_BAR_ACTIONS],
});

export const normalizeMobileBottomBarConfig = (storedValue: unknown): IMobileBottomBarConfig => {
    let value = storedValue;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return createDefaultMobileBottomBarConfig();
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return createDefaultMobileBottomBarConfig();
    }

    const record = value as Record<string, unknown>;
    if (record.version !== MOBILE_BOTTOM_BAR_CONFIG_VERSION || !Array.isArray(record.actions)) {
        return createDefaultMobileBottomBarConfig();
    }
    return {
        version: MOBILE_BOTTOM_BAR_CONFIG_VERSION,
        actions: normalizeMobileBottomBarActions(record.actions),
    };
};

export const resolveMobileBottomBarAvailability = (
    storedValue: unknown,
    unavailableActions: readonly MobileBottomBarAction[],
): IMobileBottomBarConfig => {
    const config = normalizeMobileBottomBarConfig(storedValue);
    const unavailable = new Set(unavailableActions);
    const actions = [...config.actions];
    actions.forEach((action, slot) => {
        if (!unavailable.has(action)) {
            return;
        }
        const replacement = MOBILE_BOTTOM_BAR_ACTIONS.find((candidate) =>
            !unavailable.has(candidate) && !actions.includes(candidate)
        );
        if (replacement) {
            actions[slot] = replacement;
        }
    });
    return {
        version: MOBILE_BOTTOM_BAR_CONFIG_VERSION,
        actions: toMobileBottomBarSlots(actions),
    };
};

export const reduceMobileBottomBarConfig = (
    state: IMobileBottomBarConfig,
    event: MobileBottomBarConfigEvent,
): IMobileBottomBarConfig => {
    if (event.type === "reset") {
        return createDefaultMobileBottomBarConfig();
    }

    const currentState = normalizeMobileBottomBarConfig(state);
    const actions = [...currentState.actions];
    const existingSlot = actions.indexOf(event.action);
    if (existingSlot === event.slot) {
        return currentState;
    }
    if (existingSlot >= 0) {
        actions[existingSlot] = actions[event.slot];
    }
    actions[event.slot] = event.action;
    return {
        version: MOBILE_BOTTOM_BAR_CONFIG_VERSION,
        actions: toMobileBottomBarSlots(actions),
    };
};
