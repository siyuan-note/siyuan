import {getKeymapBindings, IShortcutKeymap, normalizeShortcutKey} from "../util/keymapBindings";
import {compareShortcutBindings} from "../command/shortcutCatalog";

interface IPluginGlobalShortcutCommand {
    langKey?: string;
    customHotkey?: string;
    execute?: (context: ICommandContext) => void | Promise<void>;
    globalCallback?: (context?: ICommandContext) => void;
    when?: (context: ICommandContext) => boolean;
    enabled?: (context: ICommandContext) => boolean;
}

interface IPluginGlobalShortcutOwner {
    name?: string;
    commands: IPluginGlobalShortcutCommand[];
}

export const dispatchPluginGlobalShortcut = (plugins: IPluginGlobalShortcutOwner[], hotkey: string,
                                            keymap?: Record<string, Record<string, IShortcutKeymap>>, mac = true) => {
    const context: ICommandContext = {source: "globalShortcut", focus: "global"};
    const candidates = plugins.flatMap((plugin, index) => plugin.commands.map((command, commandIndex) => {
        const item = keymap?.[plugin.name]?.[command.langKey];
        const key = getKeymapBindings(item || {custom: command.customHotkey})
            .find(key => normalizeShortcutKey(key, mac) === normalizeShortcutKey(hotkey, mac));
        return {command, item, id: `plugin/${encodeURIComponent(plugin.name ?? String(index))}/${encodeURIComponent(command.langKey ?? String(commandIndex))}`,
            scope: "system" as const, priority: item?.bindings?.priority?.[`system:${key}`], key};
    })).filter(({command, key}) => command.globalCallback && key).sort(compareShortcutBindings);
    for (const {command} of candidates) {
        try {
            if ((command.when && !command.when(context)) || (command.enabled && !command.enabled(context))) {
                continue;
            }
        } catch (error) {
            console.error("Global shortcut condition failed:", error);
            continue;
        }
        try {
            if (command.execute) {
                void Promise.resolve(command.execute(context)).catch(error => console.error("Global shortcut failed:", error));
            } else {
                void Promise.resolve(command.globalCallback(context)).catch(error => console.error("Global shortcut failed:", error));
            }
        } catch (error) {
            console.error("Global shortcut failed:", error);
        }
        return true;
    }
    return false;
};
