export const DEFAULT_ASSET_OPEN: Config.IAssetOpen = {
    click: "follow-tab",
    ctrlClick: "folder",
    altClick: "current",
    shiftClick: "app",
};

const ASSET_OPEN_ACTIONS: Config.TAssetOpenAction[] = [
    "follow-tab",
    "current",
    "right",
    "bottom",
    "background",
    "new-window",
    "app",
    "folder",
];

export type TAssetOpenGesture = keyof Config.IAssetOpen;

const ASSET_OPEN_GESTURES: TAssetOpenGesture[] = ["click", "ctrlClick", "altClick", "shiftClick"];

export const normalizeAssetOpenConfig = (config?: Config.IAssetOpen): Config.IAssetOpen => ({
    click: normalizeAssetOpenAction(config?.click, DEFAULT_ASSET_OPEN.click),
    ctrlClick: normalizeAssetOpenAction(config?.ctrlClick, DEFAULT_ASSET_OPEN.ctrlClick),
    altClick: normalizeAssetOpenAction(config?.altClick, DEFAULT_ASSET_OPEN.altClick),
    shiftClick: normalizeAssetOpenAction(config?.shiftClick, DEFAULT_ASSET_OPEN.shiftClick),
});

const normalizeAssetOpenAction = (
    action: Config.TAssetOpenAction | undefined,
    fallback: Config.TAssetOpenAction,
) => ASSET_OPEN_ACTIONS.includes(action) ? action : fallback;

export const resolveAssetOpenGesture = (options: {
    altKey?: boolean,
    shiftKey?: boolean,
    ctrlKey?: boolean,
}): TAssetOpenGesture => {
    const modifierCount = Number(!!options.altKey) + Number(!!options.shiftKey) + Number(!!options.ctrlKey);
    if (modifierCount !== 1) {
        return "click";
    }
    if (options.altKey) {
        return "altClick";
    }
    if (options.shiftKey) {
        return "shiftClick";
    }
    return "ctrlClick";
};

export const resolveAssetOpenAction = (
    config: Config.IAssetOpen | undefined,
    options: {
        altKey?: boolean,
        shiftKey?: boolean,
        ctrlKey?: boolean,
    },
) => normalizeAssetOpenConfig(config)[resolveAssetOpenGesture(options)];

export const resolveExecutableAssetOpenAction = (
    action: Config.TAssetOpenAction,
    options: {
        previewable: boolean,
        noSplitScreen: boolean,
    },
): Config.TAssetOpenAction => {
    if (!options.previewable) {
        return action === "folder" ? "folder" : "app";
    }
    if (action === "follow-tab") {
        return options.noSplitScreen ? "current" : "right";
    }
    return action;
};

export const getAssetOpenGestures = (
    config: Config.IAssetOpen | undefined,
    action: Config.TAssetOpenAction,
    options: {
        previewable: boolean,
        noSplitScreen: boolean,
    },
) => {
    const normalizedConfig = normalizeAssetOpenConfig(config);
    return ASSET_OPEN_GESTURES.filter((gesture) =>
        resolveExecutableAssetOpenAction(normalizedConfig[gesture], options) === action);
};
