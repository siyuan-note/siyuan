export type TShortcutScope = "editor" | "fileTree" | "dock" | "global" | "system";

export const getShortcutId = (path: readonly string[]) => path[0] === "plugin" ?
    `plugin/${encodeURIComponent(path[1])}/${encodeURIComponent(path[2])}` : `core.${path.join(".")}`;

interface IShortcutPlugin {
    name: string;
    commands: Array<{
        langKey: string;
        callback?: unknown;
        execute?: unknown;
        editorCallback?: unknown;
        fileTreeCallback?: unknown;
        dockCallback?: unknown;
        globalCallback?: unknown;
    }>;
}

// 这些命令的快捷键只执行标签页切换，无编辑器局部执行分支。
export const SHARED_NATIVE_SHORTCUTS = [
    "goToTab1", "goToTab2", "goToTab3", "goToTab4", "goToTab5", "goToTab6", "goToTab7", "goToTab8", "goToTab9",
    "goToTabNext", "goToTabPrev",
];

export const getShortcutScopes = (path: readonly string[], plugins: IShortcutPlugin[] = window.siyuan.ws.app.plugins): TShortcutScope[] => {
    if (path[0] === "general" && SHARED_NATIVE_SHORTCUTS.includes(path[1])) {
        return ["global"];
    }
    if (path[0] !== "plugin") {
        return [];
    }
    const command = plugins.find(plugin => plugin.name === path[1])?.commands.find(item => item.langKey === path[2]);
    if (!command) {
        return [];
    }
    const scopes: TShortcutScope[] = [];
    if (command.editorCallback) {
        scopes.push("editor");
    }
    if (command.fileTreeCallback) {
        scopes.push("fileTree");
    }
    if (command.dockCallback) {
        scopes.push("dock");
    }
    if (command.globalCallback) {
        scopes.push("system");
    }
    if (!scopes.length && (command.callback || command.execute)) {
        scopes.push("global");
    }
    return scopes;
};

export const canShareKeymap = (path: readonly string[], plugins?: IShortcutPlugin[]) =>
    getShortcutScopes(path, plugins).length > 0;

export const canShareShortcutPaths = (paths: readonly (readonly string[])[], plugins?: IShortcutPlugin[]) => {
    const scopes = paths.map(path => getShortcutScopes(path, plugins));
    // 系统级注册会先于窗口按键事件触发，共用绑定必须属于相同的触发入口。
    return scopes.every(scope => scope.length > 0 && scope.includes("system") === scopes[0].includes("system"));
};

export interface IShortcutOrder {
    id: string;
    scope: TShortcutScope;
    priority?: number;
    order?: number;
}

export const compareShortcutBindings = (first: IShortcutOrder, second: IShortcutOrder) => {
    const scope = (first.scope === "global" ? 1 : 0) - (second.scope === "global" ? 1 : 0);
    const priority = (Number.isFinite(second.priority) ? second.priority : 0) -
        (Number.isFinite(first.priority) ? first.priority : 0);
    return scope || priority || (first.order ?? 0) - (second.order ?? 0) ||
        (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
};
