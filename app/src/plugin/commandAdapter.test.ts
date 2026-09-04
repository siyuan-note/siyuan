import {afterEach, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getCommandRegistry} from "../command/service";
import type {ICommandContextSnapshot} from "../command/types";
import {
    createPluginCommandDefinition,
    getPluginCommandId,
    registerPluginCommand,
    resolvePluginCommandCallback,
    unregisterPluginCommands,
} from "./commandAdapter";

const owners: object[] = [];

afterEach(() => {
    owners.forEach(owner => unregisterPluginCommands(owner));
    owners.length = 0;
});

const createContext = (
    overrides: Partial<ICommandContextSnapshot> = {},
): ICommandContextSnapshot => ({
    app: {},
    source: "commandPanel",
    environment: "desktop",
    focus: "global",
    selectedBlocks: [],
    ...overrides,
});

describe("plugin command adapter", () => {
    it("creates collision-safe IDs and live metadata", () => {
        const plugin = {name: "sample/plugin", displayName: "Sample", i18n: {open: "Open"}};
        const command = {langKey: "open:item", customHotkey: "Ctrl+A"} as ICommand;
        const definition = createPluginCommandDefinition(plugin, command);

        assert.equal(definition.id, "plugin/sample%2Fplugin/open%3Aitem");
        assert.equal(getPluginCommandId("first", "open"), "plugin/first/open");
        assert.notEqual(getPluginCommandId("first", "open"), getPluginCommandId("second", "open"));
        assert.equal(definition.label(), "Sample: open:item");
        assert.equal(definition.hotkey?.(), "Ctrl+A");
        command.customHotkey = "Ctrl+B";
        command.langText = "Open item";
        assert.equal(definition.hotkey?.(), "Ctrl+B");
        assert.equal(definition.label(), "Sample: Open item");
    });

    it("keeps the command panel callback precedence", () => {
        const calls: string[] = [];
        const protyle = {} as IProtyle;
        const range = {startContainer: {isConnected: true}} as unknown as Range;
        let receivedContext: ICommandContext | undefined;
        const command = {
            langKey: "sample",
            callback: (context) => {
                calls.push("callback");
                receivedContext = context;
            },
            editorCallback: () => calls.push("editor"),
            globalCallback: () => calls.push("global"),
        } as ICommand;
        const callback = resolvePluginCommandCallback(command, createContext({
            focus: "editor",
            protyle,
            range,
        }));

        callback?.();
        assert.deepEqual(calls, ["callback"]);
        assert.deepEqual(receivedContext, {
            source: "commandPanel",
            focus: "editor",
            protyle,
            range,
            fileTree: undefined,
            dock: undefined,
        });
    });

    it("prefers execute over legacy callbacks", async () => {
        const calls: string[] = [];
        const protyle = {} as IProtyle;
        const range = {startContainer: {isConnected: true}} as unknown as Range;
        let receivedContext: ICommandContext | undefined;
        const command = {
            langKey: "sample",
            execute(context) {
                calls.push("execute");
                receivedContext = context;
            },
            callback: () => calls.push("callback"),
            editorCallback: () => calls.push("editor"),
        } as ICommand;

        await resolvePluginCommandCallback(command, createContext({
            focus: "editor",
            protyle,
            range,
        }))?.();

        assert.deepEqual(calls, ["execute"]);
        assert.deepEqual(receivedContext, {
            source: "commandPanel",
            focus: "editor",
            protyle,
            range,
            fileTree: undefined,
            dock: undefined,
        });
    });

    it("preserves the plugin command as the callback receiver", () => {
        const receivers: unknown[] = [];
        const command = {
            langKey: "sample",
            callback() {
                receivers.push(this);
            },
            globalCallback() {
                receivers.push(this);
            },
        } as ICommand;

        resolvePluginCommandCallback(command, createContext())?.();
        resolvePluginCommandCallback(command, createContext({source: "globalShortcut"}))?.();

        assert.deepEqual(receivers, [command, command]);
    });

    it("dispatches editor, file tree, and dock callbacks from the captured context", () => {
        const calls: unknown[] = [];
        const contexts: Array<ICommandContext | undefined> = [];
        const protyle = {} as IProtyle;
        const range = {startContainer: {isConnected: true}} as unknown as Range;
        const files = {} as import("../layout/dock/Files").Files;
        const dockElement = {} as HTMLElement;
        const command = {
            langKey: "sample",
            editorCallback: (value, context) => {
                calls.push(value);
                contexts.push(context);
            },
            fileTreeCallback: (value, context) => {
                calls.push(value);
                contexts.push(context);
            },
            dockCallback: (value, context) => {
                calls.push(value);
                contexts.push(context);
            },
        } as ICommand;

        resolvePluginCommandCallback(command, createContext({focus: "editor", protyle, range}))?.();
        resolvePluginCommandCallback(command, createContext({
            focus: "fileTree",
            fileTree: {model: files, elements: [], ids: [], paths: []},
        }))?.();
        resolvePluginCommandCallback(command, createContext({
            focus: "dock",
            dock: {element: dockElement},
        }))?.();

        assert.deepEqual(calls, [protyle, files, dockElement]);
        assert.deepEqual(contexts, [{
            source: "commandPanel",
            focus: "editor",
            protyle,
            range,
            fileTree: undefined,
            dock: undefined,
        }, {
            source: "commandPanel",
            focus: "fileTree",
            protyle: undefined,
            range: undefined,
            fileTree: files,
            dock: undefined,
        }, {
            source: "commandPanel",
            focus: "dock",
            protyle: undefined,
            range: undefined,
            fileTree: undefined,
            dock: dockElement,
        }]);
    });

    it("executes unified commands from scoped shortcuts", async () => {
        const sources: ICommandContext["source"][] = [];
        const command = {
            langKey: "sample",
            execute: (context) => {
                sources.push(context.source);
            },
        } as ICommand;
        const protyle = {} as IProtyle;
        const files = {} as import("../layout/dock/Files").Files;
        const dockElement = {} as HTMLElement;

        await resolvePluginCommandCallback(command, createContext({
            source: "editorShortcut",
            focus: "editor",
            protyle,
        }))?.();
        await resolvePluginCommandCallback(command, createContext({
            source: "fileTreeShortcut",
            focus: "fileTree",
            fileTree: {model: files, elements: [], ids: [], paths: []},
        }))?.();
        await resolvePluginCommandCallback(command, createContext({
            source: "dockShortcut",
            focus: "dock",
            dock: {element: dockElement},
        }))?.();
        await resolvePluginCommandCallback(command, createContext({source: "shortcut"}))?.();

        assert.deepEqual(sources, ["editorShortcut", "fileTreeShortcut", "dockShortcut", "shortcut"]);
    });

    it("omits a detached range from the plugin command context", () => {
        const range = {startContainer: {isConnected: false}} as unknown as Range;
        let receivedContext: ICommandContext | undefined;
        const command = {
            langKey: "sample",
            callback: (context) => {
                receivedContext = context;
            },
        } as ICommand;

        resolvePluginCommandCallback(command, createContext({range}))?.();

        assert.equal(receivedContext?.range, undefined);
    });

    it("does not enable specialized callbacks on mobile", () => {
        const command = {langKey: "sample", editorCallback: () => undefined} as ICommand;
        const context = createContext({
            environment: "mobile",
            focus: "editor",
            protyle: {} as IProtyle,
        });

        assert.equal(resolvePluginCommandCallback(command, context), undefined);
    });

    it("does not treat the bottom backlink panel as a plugin dock", () => {
        const command = {langKey: "sample", dockCallback: () => undefined} as ICommand;
        const context = createContext({
            focus: "dock",
            dock: {type: "backlink-bottom", element: {} as HTMLElement},
        });

        assert.equal(resolvePluginCommandCallback(command, context), undefined);
        assert.equal(resolvePluginCommandCallback(command, {...context, source: "dockShortcut"}), undefined);
    });

    it("keeps unavailable scoped commands visible as disabled entries", async () => {
        const app = {};
        const plugin = {name: "scoped", displayName: "Scoped", i18n: {editor: "Editor"}};
        const command = {langKey: "editor", editorCallback: () => undefined} as ICommand;
        owners.push(plugin);
        registerPluginCommand(app, plugin, command);
        const registry = getCommandRegistry(app);
        const context = createContext({app});
        const commandId = getPluginCommandId(plugin.name, command.langKey);

        assert.deepEqual(registry.list(context).map(item => item.id), [commandId]);
        assert.equal((await registry.execute(commandId, context)).status, "disabled");
    });

    it("uses global callbacks only for global shortcuts or a main command panel", () => {
        let calls = 0;
        const command = {langKey: "sample", globalCallback: () => calls++} as ICommand;

        resolvePluginCommandCallback(command, createContext())?.();
        assert.equal(calls, 1);
        assert.equal(resolvePluginCommandCallback(command, createContext({environment: "desktop-window"})), undefined);
        assert.equal(resolvePluginCommandCallback(command, createContext({environment: "mobile"})), undefined);
        assert.equal(resolvePluginCommandCallback(command, createContext({environment: "browser-mobile"})), undefined);
        resolvePluginCommandCallback(command, createContext({
            source: "globalShortcut",
            environment: "desktop-window",
        }))?.();
        assert.equal(calls, 2);
    });

    it("preserves generic shortcut restrictions", () => {
        let calls = 0;
        const generic = {langKey: "generic", callback: () => calls++} as ICommand;
        const specialized = {
            langKey: "specialized",
            callback: () => calls++,
            editorCallback: () => calls++,
        } as ICommand;

        ["global", "editor", "fileTree", "dock"].forEach(focus => {
            resolvePluginCommandCallback(generic, createContext({
                source: "shortcut",
                focus: focus as ICommandContextSnapshot["focus"],
            }))?.();
        });
        resolvePluginCommandCallback(generic, createContext({
            source: "shortcut",
            environment: "mobile",
            focus: "editor",
        }))?.();
        assert.equal(resolvePluginCommandCallback(specialized, createContext({source: "shortcut"})), undefined);
        assert.equal(calls, 5);
    });

    it("keeps scoped shortcut callbacks separate", () => {
        const calls: string[] = [];
        const command = {
            langKey: "scoped",
            callback: () => calls.push("generic"),
            editorCallback: () => calls.push("editor"),
            fileTreeCallback: () => calls.push("fileTree"),
            dockCallback: () => calls.push("dock"),
        } as ICommand;
        const protyle = {} as IProtyle;
        const files = {} as import("../layout/dock/Files").Files;
        const element = {} as HTMLElement;

        resolvePluginCommandCallback(command, createContext({source: "editorShortcut", protyle}))?.();
        resolvePluginCommandCallback(command, createContext({
            source: "fileTreeShortcut",
            fileTree: {model: files, elements: [], ids: [], paths: []},
        }))?.();
        resolvePluginCommandCallback(command, createContext({
            source: "dockShortcut",
            dock: {element},
        }))?.();
        assert.equal(resolvePluginCommandCallback(command, createContext({source: "shortcut"})), undefined);
        assert.deepEqual(calls, ["editor", "fileTree", "dock"]);
    });

    it("registers the first duplicate command and removes it with its owner", async () => {
        const app = {};
        const plugin = {name: "sample", displayName: "Sample", i18n: {first: "First"}};
        const calls: string[] = [];
        owners.push(plugin);
        const originalError = console.error;
        console.error = () => undefined;
        try {
            registerPluginCommand(app, plugin, {langKey: "first", callback: () => calls.push("first")} as ICommand);
            registerPluginCommand(app, plugin, {langKey: "first", callback: () => calls.push("second")} as ICommand);
        } finally {
            console.error = originalError;
        }
        const registry = getCommandRegistry(app);
        const context = createContext({app});
        const commandId = getPluginCommandId("sample", "first");

        assert.equal((await registry.execute(commandId, context)).status, "executed");
        assert.deepEqual(calls, ["first"]);
        assert.equal(unregisterPluginCommands(plugin), 1);
        assert.equal(registry.get(commandId), undefined);
        registerPluginCommand(app, plugin, {langKey: "late", callback: () => undefined} as ICommand);
        assert.equal(registry.get(getPluginCommandId("sample", "late")), undefined);
    });

    it("keeps a reloaded instance when the old owner is cleaned again", async () => {
        const app = {};
        const oldPlugin = {name: "sample", displayName: "Old", i18n: {open: "Open"}};
        const newPlugin = {name: "sample", displayName: "New", i18n: {open: "Open"}};
        const calls: string[] = [];
        owners.push(oldPlugin, newPlugin);
        registerPluginCommand(app, oldPlugin, {langKey: "open", callback: () => calls.push("old")} as ICommand);
        assert.equal(unregisterPluginCommands(oldPlugin), 1);
        assert.equal(unregisterPluginCommands(oldPlugin), 0);
        registerPluginCommand(app, newPlugin, {langKey: "open", callback: () => calls.push("new")} as ICommand);
        unregisterPluginCommands(oldPlugin);

        const result = await getCommandRegistry(app).execute(
            getPluginCommandId("sample", "open"),
            createContext({app}),
        );
        assert.equal(result.status, "executed");
        assert.deepEqual(calls, ["new"]);
    });
});
