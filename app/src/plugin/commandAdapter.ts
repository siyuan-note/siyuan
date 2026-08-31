import {getCommandRegistry} from "../command/service";
import type {ICommandContextSnapshot, ICommandDefinition} from "../command/types";

interface IPluginCommandOwner {
    name: string;
    displayName: string;
    i18n: Record<string, string>;
}

interface IPluginCommandRegistration {
    registry: ReturnType<typeof getCommandRegistry>;
    disposers: Set<() => boolean>;
}

const registrations = new WeakMap<object, IPluginCommandRegistration>();
const inactiveOwners = new WeakSet<object>();

export const getPluginCommandId = (pluginName: string, langKey: string) =>
    `plugin/${encodeURIComponent(pluginName)}/${encodeURIComponent(langKey)}`;

const isMobileContext = (context: ICommandContextSnapshot) =>
    context.environment === "mobile" || context.environment === "browser-mobile";

const hasPluginDockContext = (context: ICommandContextSnapshot) =>
    Boolean(context.dock?.element && context.dock.type !== "backlink-bottom");

export const resolvePluginCommandCallback = (command: ICommand, context: ICommandContextSnapshot) => {
    if (context.source === "globalShortcut") {
        return command.globalCallback ? () => command.globalCallback() : undefined;
    }
    if (context.source === "commandPanel") {
        if (command.callback) {
            return () => command.callback();
        }
        if (!isMobileContext(context)) {
            if (context.focus === "editor" && context.protyle && command.editorCallback) {
                return () => command.editorCallback(context.protyle);
            }
            if (context.focus === "fileTree" && context.fileTree?.model && command.fileTreeCallback) {
                return () => command.fileTreeCallback(
                    context.fileTree.model as import("../layout/dock/Files").Files,
                );
            }
            if (context.focus === "dock" && hasPluginDockContext(context) && command.dockCallback) {
                return () => command.dockCallback(context.dock.element);
            }
        }
        if (command.globalCallback && ["desktop", "browser-desktop"].includes(context.environment)) {
            return () => command.globalCallback();
        }
        return undefined;
    }
    if (context.source === "editorShortcut" && context.protyle && command.editorCallback) {
        return () => command.editorCallback(context.protyle);
    }
    if (context.source === "fileTreeShortcut" && context.fileTree?.model && command.fileTreeCallback) {
        return () => command.fileTreeCallback(
            context.fileTree.model as import("../layout/dock/Files").Files,
        );
    }
    if (context.source === "dockShortcut" && hasPluginDockContext(context) && command.dockCallback) {
        return () => command.dockCallback(context.dock.element);
    }
    if (context.source === "shortcut") {
        if (command.callback &&
            !command.fileTreeCallback && !command.editorCallback && !command.dockCallback && !command.globalCallback) {
            return () => command.callback();
        }
    }
    return undefined;
};

export const createPluginCommandDefinition = (
    plugin: IPluginCommandOwner,
    command: ICommand,
): ICommandDefinition => {
    const id = getPluginCommandId(plugin.name, command.langKey);
    return {
        id,
        category: "plugin",
        label: () => `${plugin.displayName}: ${command.langText || plugin.i18n[command.langKey] || command.langKey}`,
        keywords: () => [plugin.displayName, plugin.name, command.langKey, id],
        keymapPath: ["plugin", plugin.name, command.langKey],
        hotkey: () => command.customHotkey || "",
        order: 10_000,
        enabled: context => Boolean(resolvePluginCommandCallback(command, context)),
        execute: context => resolvePluginCommandCallback(command, context)?.(),
    };
};

export const registerPluginCommand = (
    app: object,
    plugin: IPluginCommandOwner & object,
    command: ICommand,
) => {
    if (inactiveOwners.has(plugin)) {
        return;
    }
    const registry = getCommandRegistry(app);
    let registration = registrations.get(plugin);
    if (!registration) {
        registration = {registry, disposers: new Set()};
        registrations.set(plugin, registration);
    }
    try {
        registration.disposers.add(registry.register(createPluginCommandDefinition(plugin, command), plugin));
    } catch (error) {
        console.error(`Plugin ${plugin.name} command "${command.langKey}" was not registered:`, error);
    }
};

export const unregisterPluginCommands = (plugin: object) => {
    inactiveOwners.add(plugin);
    const registration = registrations.get(plugin);
    if (!registration) {
        return 0;
    }
    let count = 0;
    registration.disposers.forEach(dispose => {
        if (dispose()) {
            count++;
        }
    });
    registration.disposers.clear();
    registration.registry.unregisterOwner(plugin);
    registrations.delete(plugin);
    return count;
};
