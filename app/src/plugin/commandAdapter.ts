import {getCommandRegistry} from "../command/service";
import type {ICommandContextSnapshot, ICommandDefinition, TCommandSource} from "../command/types";

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

const hasPluginCommandScopedCallback = (command: ICommand) =>
    Boolean(command.globalCallback || command.fileTreeCallback || command.editorCallback || command.dockCallback);

const hasPluginCommandLegacyCallback = (command: ICommand) =>
    Boolean(command.callback || hasPluginCommandScopedCallback(command));

export const supportsPluginCommandSource = (command: ICommand, source: TCommandSource) => {
    if (source === "globalShortcut") {
        return Boolean(command.globalCallback);
    }
    if (source === "editorShortcut") {
        return Boolean(command.editorCallback);
    }
    if (source === "fileTreeShortcut") {
        return Boolean(command.fileTreeCallback);
    }
    if (source === "dockShortcut") {
        return Boolean(command.dockCallback);
    }
    if (source === "shortcut") {
        return Boolean((command.execute || command.callback) && !hasPluginCommandScopedCallback(command));
    }
    return false;
};

const resolvePluginCommandExecution = (
    command: ICommand,
    context: ICommandContextSnapshot,
    legacyCallback: (pluginContext: ICommandContext) => void,
) => () => {
    const pluginContext = createPluginCommandContext(context);
    return command.execute ? command.execute(pluginContext) : legacyCallback(pluginContext);
};

export const resolvePluginCommandCallback = (command: ICommand, context: ICommandContextSnapshot) => {
    if (context.source === "globalShortcut") {
        if (!command.globalCallback) {
            return undefined;
        }
        return resolvePluginCommandExecution(command, context, pluginContext => command.globalCallback(pluginContext));
    }
    if (context.source === "commandPanel") {
        if (command.callback) {
            return resolvePluginCommandExecution(command, context, pluginContext => command.callback(pluginContext));
        }
        if (!isMobileContext(context)) {
            if (context.focus === "editor" && context.protyle && command.editorCallback) {
                return resolvePluginCommandExecution(command, context, pluginContext => {
                    command.editorCallback(context.protyle, pluginContext);
                });
            }
            if (context.focus === "fileTree" && context.fileTree?.model && command.fileTreeCallback) {
                return resolvePluginCommandExecution(command, context, pluginContext => {
                    command.fileTreeCallback(
                        context.fileTree.model as import("../layout/dock/Files").Files,
                        pluginContext,
                    );
                });
            }
            if (context.focus === "dock" && hasPluginDockContext(context) && command.dockCallback) {
                return resolvePluginCommandExecution(command, context, pluginContext => {
                    command.dockCallback(context.dock.element, pluginContext);
                });
            }
        }
        if (command.globalCallback && ["desktop", "browser-desktop"].includes(context.environment)) {
            return resolvePluginCommandExecution(command, context, pluginContext => {
                command.globalCallback(pluginContext);
            });
        }
        if (command.execute && !hasPluginCommandLegacyCallback(command)) {
            return resolvePluginCommandExecution(command, context, () => undefined);
        }
        return undefined;
    }
    if (context.source === "editorShortcut" && context.protyle && command.editorCallback) {
        return resolvePluginCommandExecution(command, context, pluginContext => {
            command.editorCallback(context.protyle, pluginContext);
        });
    }
    if (context.source === "fileTreeShortcut" && context.fileTree?.model && command.fileTreeCallback) {
        return resolvePluginCommandExecution(command, context, pluginContext => {
            command.fileTreeCallback(
                context.fileTree.model as import("../layout/dock/Files").Files,
                pluginContext,
            );
        });
    }
    if (context.source === "dockShortcut" && hasPluginDockContext(context) && command.dockCallback) {
        return resolvePluginCommandExecution(command, context, pluginContext => {
            command.dockCallback(context.dock.element, pluginContext);
        });
    }
    if (context.source === "shortcut") {
        if ((command.execute || command.callback) && !hasPluginCommandScopedCallback(command)) {
            return resolvePluginCommandExecution(command, context, pluginContext => command.callback(pluginContext));
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
