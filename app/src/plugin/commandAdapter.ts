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

const createPluginCommandContext = (context: ICommandContextSnapshot): ICommandContext => ({
    source: context.source,
    focus: context.focus,
    protyle: context.protyle,
    range: context.range?.startContainer.isConnected ? context.range : undefined,
    fileTree: context.fileTree?.model as import("../layout/dock/Files").Files | undefined,
    dock: hasPluginDockContext(context) ? context.dock.element : undefined,
});

export const resolvePluginCommandCallback = (command: ICommand, context: ICommandContextSnapshot) => {
    if (context.source === "globalShortcut") {
        if (!command.globalCallback) {
            return undefined;
        }
        return command.execute ?
            () => command.execute(createPluginCommandContext(context)) :
            () => command.globalCallback(createPluginCommandContext(context));
    }
    if (context.source === "commandPanel") {
        if (command.execute) {
            return () => command.execute(createPluginCommandContext(context));
        }
        if (command.callback) {
            return () => command.callback(createPluginCommandContext(context));
        }
        if (!isMobileContext(context)) {
            if (context.focus === "editor" && context.protyle && command.editorCallback) {
                return () => command.editorCallback(context.protyle, createPluginCommandContext(context));
            }
            if (context.focus === "fileTree" && context.fileTree?.model && command.fileTreeCallback) {
                return () => command.fileTreeCallback(
                    context.fileTree.model as import("../layout/dock/Files").Files,
                    createPluginCommandContext(context),
                );
            }
            if (context.focus === "dock" && hasPluginDockContext(context) && command.dockCallback) {
                return () => command.dockCallback(context.dock.element, createPluginCommandContext(context));
            }
        }
        if (command.globalCallback && ["desktop", "browser-desktop"].includes(context.environment)) {
            return () => command.globalCallback(createPluginCommandContext(context));
        }
        return undefined;
    }
    if (context.source === "editorShortcut" && context.protyle) {
        if (command.execute) {
            return () => command.execute(createPluginCommandContext(context));
        }
        if (command.editorCallback) {
            return () => command.editorCallback(context.protyle, createPluginCommandContext(context));
        }
    }
    if (context.source === "fileTreeShortcut" && context.fileTree?.model) {
        if (command.execute) {
            return () => command.execute(createPluginCommandContext(context));
        }
        if (command.fileTreeCallback) {
            return () => command.fileTreeCallback(
                context.fileTree.model as import("../layout/dock/Files").Files,
                createPluginCommandContext(context),
            );
        }
    }
    if (context.source === "dockShortcut" && hasPluginDockContext(context)) {
        if (command.execute) {
            return () => command.execute(createPluginCommandContext(context));
        }
        if (command.dockCallback) {
            return () => command.dockCallback(context.dock.element, createPluginCommandContext(context));
        }
    }
    if (context.source === "shortcut") {
        if (command.execute) {
            return () => command.execute(createPluginCommandContext(context));
        }
        if (command.callback &&
            !command.fileTreeCallback && !command.editorCallback && !command.dockCallback && !command.globalCallback) {
            return () => command.callback(createPluginCommandContext(context));
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
