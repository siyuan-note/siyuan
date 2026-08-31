export const DESKTOP_COMMAND_PANEL_GENERAL_KEYS = [
    "addToDatabase", "fileTree", "outline", "bookmark", "tag", "dailyNote", "inbox", "backlinks",
    "graphView", "globalGraph", "closeAll", "closeLeft", "closeOthers", "closeRight", "closeTab",
    "closeUnmodified", "config", "dataHistory", "editReadonly", "enter", "enterBack", "globalSearch", "goBack",
    "goForward", "goToEditTabNext", "goToEditTabPrev", "goToTab1", "goToTab2", "goToTab3", "goToTab4",
    "goToTab5", "goToTab6", "goToTab7", "goToTab8", "goToTab9", "goToTabNext", "goToTabPrev", "lockScreen",
    "mainMenu", "move", "newFile", "recentDocs", "replace", "riffCard", "search", "selectOpen1", "syncNow",
    "splitLR", "splitMoveB", "splitMoveR", "splitTB", "switchLeftDock", "switchRightDock", "switchBottomDock",
    "tabToWindow", "stickSearch", "toggleDock", "toggleLeftDockPanel", "toggleRightDockPanel",
    "toggleBottomDockPanel", "unsplitAll", "unsplit", "recentClosed", "increaseEditorFontSize",
    "decreaseEditorFontSize", "resetEditorFontSize", "toggleWin",
] as const;

export const MOBILE_COMMAND_PANEL_GENERAL_KEYS = [
    "addToDatabase", "fileTree", "outline", "bookmark", "tag", "dailyNote", "inbox", "backlinks",
    "dataHistory", "editReadonly", "enter", "enterBack", "globalSearch", "lockScreen", "mainMenu", "move",
    "newFile", "recentDocs", "replace", "riffCard", "search", "selectOpen1", "syncNow", "increaseEditorFontSize",
    "decreaseEditorFontSize", "resetEditorFontSize",
] as const;

export const COMMAND_PANEL_EDITOR_KEYS = ["switchReadonly", "switchAdjust"] as const;

export type TNativeCommandRequirement = "none" | "editor" | "editorOrFileTree";

export interface INativeCommandCatalogItem {
    id: string;
    legacyId: string;
    keymapPath: readonly ["general", string] | readonly ["editor", "general", string];
    desktop: boolean;
    mobile: boolean;
    browser: boolean;
    requirement: TNativeCommandRequirement;
    order: number;
}

export type TNativeCommandEnvironment =
    "desktop" |
    "desktop-window" |
    "mobile" |
    "browser-desktop" |
    "browser-mobile";

const mobileKeys = new Set<string>(MOBILE_COMMAND_PANEL_GENERAL_KEYS);
const editorRequiredKeys = new Set<string>(["enter", "enterBack"]);
const editorOrFileTreeRequiredKeys = new Set<string>(["addToDatabase", "move"]);

export const NATIVE_COMMAND_CATALOG: INativeCommandCatalogItem[] = [
    ...DESKTOP_COMMAND_PANEL_GENERAL_KEYS.map((legacyId, order) => ({
        id: `core.general.${legacyId}`,
        legacyId,
        keymapPath: ["general", legacyId] as const,
        desktop: true,
        mobile: mobileKeys.has(legacyId),
        browser: legacyId !== "toggleWin",
        requirement: editorRequiredKeys.has(legacyId) ? "editor" as const :
            editorOrFileTreeRequiredKeys.has(legacyId) ? "editorOrFileTree" as const : "none" as const,
        order,
    })),
    ...COMMAND_PANEL_EDITOR_KEYS.map((legacyId, index) => ({
        id: `core.editor.general.${legacyId}`,
        legacyId,
        keymapPath: ["editor", "general", legacyId] as const,
        desktop: true,
        mobile: true,
        browser: true,
        requirement: "editor" as const,
        order: DESKTOP_COMMAND_PANEL_GENERAL_KEYS.length + index,
    })),
];

const commandsByLegacyId = new Map(NATIVE_COMMAND_CATALOG.map(item => [item.legacyId, item]));

export const getNativeCommandByLegacyId = (legacyId: string) => commandsByLegacyId.get(legacyId);

export const orderNativeCommands = (generalKeys: string[], editorKeys: string[]) => [
    ...generalKeys
        .map(key => getNativeCommandByLegacyId(key))
        .filter((item): item is INativeCommandCatalogItem => Boolean(item?.keymapPath[0] === "general")),
    ...editorKeys
        .map(key => getNativeCommandByLegacyId(key))
        .filter((item): item is INativeCommandCatalogItem => Boolean(item?.keymapPath[0] === "editor")),
];

export const isNativeCommandSupported = (
    item: INativeCommandCatalogItem,
    environment: TNativeCommandEnvironment,
) => {
    if (environment.startsWith("browser-") && !item.browser) {
        return false;
    }
    return ["mobile", "browser-mobile"].includes(environment) ? item.mobile : item.desktop;
};
