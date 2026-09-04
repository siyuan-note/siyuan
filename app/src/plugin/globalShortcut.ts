interface IPluginGlobalShortcutCommand {
    customHotkey?: string;
    execute?: (context: ICommandContext) => void | Promise<void>;
    globalCallback?: (context?: ICommandContext) => void;
}

interface IPluginGlobalShortcutOwner {
    commands: IPluginGlobalShortcutCommand[];
}

export const dispatchPluginGlobalShortcut = (plugins: IPluginGlobalShortcutOwner[], hotkey: string) => {
    const context: ICommandContext = {source: "globalShortcut", focus: "global"};
    for (const plugin of plugins) {
        const command = plugin.commands.find(item => item.globalCallback && item.customHotkey === hotkey);
        if (command) {
            if (command.execute) {
                void command.execute(context);
            } else {
                command.globalCallback(context);
            }
            return true;
        }
    }
    return false;
};
