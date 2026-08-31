import {getEnglishCommandLabel} from "./english";
import {
    getNativeCommandByLegacyId,
    isNativeCommandSupported,
    orderNativeCommands,
    type INativeCommandCatalogItem,
} from "./nativeCatalog";
import {getCommandRegistry} from "./service";
import type {ICommandContextSnapshot, ICommandDefinition} from "./types";

export type TNativeCommandExecutor = (
    command: string,
    context: ICommandContextSnapshot,
) => unknown | Promise<unknown>;

const initializedApps = new WeakSet<object>();

const getHotkey = (item: INativeCommandCatalogItem) => {
    if (item.keymapPath[0] === "general") {
        return window.siyuan.config.keymap.general[item.keymapPath[1]]?.custom || "";
    }
    return window.siyuan.config.keymap.editor[item.keymapPath[1]][item.keymapPath[2]]?.custom || "";
};

const matchesContext = (item: INativeCommandCatalogItem, context: ICommandContextSnapshot) => {
    if (item.requirement === "editor") {
        return Boolean(context.protyle);
    }
    if (item.requirement === "editorOrFileTree") {
        return Boolean(context.protyle || context.fileTree?.elements.length);
    }
    return true;
};

const createNativeCommand = (
    item: INativeCommandCatalogItem,
    order: number,
    execute: TNativeCommandExecutor,
): ICommandDefinition => ({
    id: item.id,
    category: "core",
    label: () => window.siyuan.languages[item.legacyId] || item.legacyId,
    englishLabel: () => getEnglishCommandLabel(item.legacyId),
    keywords: () => [item.legacyId, ...item.keymapPath],
    keymapPath: item.keymapPath,
    hotkey: () => getHotkey(item),
    order,
    platform: environment => isNativeCommandSupported(item, environment),
    enabled: context => matchesContext(item, context),
    execute: context => execute(item.legacyId, context),
});

export const ensureNativeCommands = (app: object, execute: TNativeCommandExecutor) => {
    if (initializedApps.has(app)) {
        return;
    }
    const registry = getCommandRegistry(app);
    const items = orderNativeCommands(
        Object.keys(window.siyuan.config.keymap.general),
        Object.keys(window.siyuan.config.keymap.editor.general),
    );
    const owner = {};
    const disposers: Array<() => boolean> = [];
    try {
        items.forEach((item, order) =>
            disposers.push(registry.register(createNativeCommand(item, order, execute), owner)));
        initializedApps.add(app);
    } catch (error) {
        disposers.reverse().forEach(dispose => dispose());
        throw error;
    }
};

export const getNativeCommandId = (legacyId: string) => getNativeCommandByLegacyId(legacyId)?.id;
