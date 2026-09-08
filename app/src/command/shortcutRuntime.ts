import type {App} from "../index";
import {captureCommandContext} from "./context";
import {getCommandRegistry} from "./service";
import type {CommandRegistry} from "./registry";
import {getNativeCommandId} from "./nativeCommands";
import {getPluginCommandId, supportsPluginCommandSource} from "../plugin/commandAdapter";
import {getKeymapBindings, getKeymapItem, visitKeymapItems} from "../util/keymapBindings";
import {matchHotKey} from "../protyle/util/hotKey";
import {canShareShortcutPaths, getShortcutScopes, SHARED_NATIVE_SHORTCUTS} from "./shortcutCatalog";
import {IShortcutCandidate, resolveShortcut} from "./shortcutResolver";
import type {ICommandContextSnapshot, TCommandSource} from "./types";
import {areProtylePluginExtensionsEnabled} from "../protyle/runtimeCapabilities";

const reportError = (error: unknown) => console.error("Shortcut command failed:", error);
const handledEvents = new WeakSet<KeyboardEvent>();

export const captureShortcutContext = (app: App, event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const fileTree = target.closest(".sy__file");
    const context = captureCommandContext({app, source: "shortcut",
        fileLiElements: fileTree ? Array.from(fileTree.querySelectorAll(".b3-list-item--focus")) : undefined});
    const textInput = Boolean(target.closest("input, textarea"));
    const editorFocused = !textInput && Boolean(context.protyle?.wysiwyg?.element?.contains(target));
    const dockFocused = !textInput && Boolean(context.dock?.element.contains(target));
    context.focus = editorFocused ? "editor" : fileTree && !textInput ? "fileTree" : dockFocused ? "dock" : "global";
    if (!editorFocused) {
        context.protyle = undefined;
        context.range = undefined;
        context.document = undefined;
        context.block = undefined;
        context.tableCell = undefined;
        context.selectedBlocks = [];
    }
    if (context.focus !== "fileTree") {
        context.fileTree = undefined;
    }
    if (context.focus !== "dock") {
        context.dock = undefined;
    }
    return context;
};

const runCandidates = (app: App, event: KeyboardEvent, candidates: IShortcutCandidate[],
                       registry = getCommandRegistry(app)) => {
    const resolved = resolveShortcut(registry, candidates, reportError);
    if (!resolved) {
        return false;
    }
    handledEvents.add(event);
    event.preventDefault();
    event.stopImmediatePropagation();
    void resolved.run().catch(reportError);
    return true;
};

export const dispatchPluginShortcut = (app: App, event: KeyboardEvent,
                                       source: "shortcut" | "editorShortcut" | "fileTreeShortcut" | "dockShortcut",
                                       capture: () => ICommandContextSnapshot) => {
    if (handledEvents.has(event)) {
        return true;
    }
    const matches: Array<{id: string; priority?: number}> = [];
    app.plugins.forEach(plugin => plugin.commands.forEach(command => {
        if (!supportsPluginCommandSource(command, source)) {
            return;
        }
        const item = getKeymapItem(window.siyuan.config.keymap, ["plugin", plugin.name, command.langKey]);
        const hotkey = getKeymapBindings(item || {custom: command.customHotkey}).find(key => matchHotKey(key, event));
        if (hotkey) {
            const scope = ({shortcut: "global", editorShortcut: "editor", fileTreeShortcut: "fileTree", dockShortcut: "dock"})[source];
            matches.push({id: getPluginCommandId(plugin.name, command.langKey),
                priority: item?.bindings?.priority?.[`${scope}:${hotkey}`]});
        }
    }));
    if (!matches.length) {
        return false;
    }
    const context = capture();
    return runCandidates(app, event, matches.map(item => ({...item, context,
        scope: source === "shortcut" ? "global" : context.focus})));
};

// 共用绑定在捕获阶段统一选择；未接入的按键继续使用原有事件入口。
export const dispatchSharedShortcut = (app: App, event: KeyboardEvent, ensureCommands: () => CommandRegistry) => {
    if (handledEvents.has(event) || event.defaultPrevented || event.isComposing || !event.key ||
        (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !/^F\d{1,2}$/.test(event.key))) {
        return false;
    }
    const target = event.target as HTMLElement;
    if (target.closest(".config-keymap, .b3-menu, .av__panel, .av__mask") ||
        document.getElementById("progress") || document.getElementById("errorLog")) {
        return false;
    }
    const matches: Array<{path: string[]; hotkey: string; priorities?: Record<string, number>}> = [];
    visitKeymapItems(window.siyuan.config.keymap, (item, path) => {
        const hotkey = getKeymapBindings(item).find(key => matchHotKey(key, event));
        if (hotkey) {
            matches.push({path, hotkey, priorities: item.bindings?.priority});
        }
    });
    if (matches.length < 2 || !canShareShortcutPaths(matches.map(item => item.path), app.plugins)) {
        return false;
    }
    const context = captureShortcutContext(app, event);
    const candidates: IShortcutCandidate[] = [];
    const sources: Record<string, TCommandSource> = {
        global: "shortcut", editor: "editorShortcut", fileTree: "fileTreeShortcut", dock: "dockShortcut",
    };
    matches.forEach(({path, hotkey, priorities}) => {
        const scopes = getShortcutScopes(path, app.plugins);
        const scope = scopes.includes(context.focus) ? context.focus : scopes.includes("global") ? "global" : undefined;
        if (!scope || (scope === "editor" && (!context.protyle || !areProtylePluginExtensionsEnabled(context.protyle)))) {
            return;
        }
        if (["mobile", "browser-mobile"].includes(context.environment) && scope !== "global") {
            return;
        }
        const priority = priorities?.[`${scope}:${hotkey}`];
        if (path[0] === "general") {
            if (event.repeat || !SHARED_NATIVE_SHORTCUTS.includes(path[1])) {
                return;
            }
            candidates.push({id: getNativeCommandId(path[1]), context, scope, priority});
        } else {
            candidates.push({id: getPluginCommandId(path[1], path[2]),
                context: {...context, source: sources[scope]}, scope, priority});
        }
    });
    if (!runCandidates(app, event, candidates, ensureCommands())) {
        // 已仲裁的共用绑定不再进入旧命令分支，浏览器默认输入仍可继续。
        event.stopImmediatePropagation();
    }
    return true;
};
