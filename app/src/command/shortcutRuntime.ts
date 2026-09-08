import type {App} from "../index";
import {captureCommandContext} from "./context";
import {getCommandRegistry} from "./service";
import {getPluginCommandId, supportsPluginCommandSource} from "../plugin/commandAdapter";
import {getKeymapBindings, getKeymapItem} from "../util/keymapBindings";
import {matchHotKey} from "../protyle/util/hotKey";
import {IShortcutCandidate, resolveShortcut} from "./shortcutResolver";
import type {ICommandContextSnapshot} from "./types";

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
    const matches: Array<{id: string}> = [];
    app.plugins.forEach(plugin => plugin.commands.forEach(command => {
        if (!supportsPluginCommandSource(command, source)) {
            return;
        }
        const item = getKeymapItem(window.siyuan.config.keymap, ["plugin", plugin.name, command.langKey]);
        const hotkey = getKeymapBindings(item || {custom: command.customHotkey}).find(key => matchHotKey(key, event));
        if (hotkey) {
            matches.push({id: getPluginCommandId(plugin.name, command.langKey)});
        }
    }));
    if (!matches.length) {
        return false;
    }
    const context = capture();
    const scopes = {shortcut: "global", editorShortcut: "editor", fileTreeShortcut: "fileTree", dockShortcut: "dock"} as const;
    return runCandidates(app, event, matches.map(item => ({...item, context, scope: scopes[source]})));
};
