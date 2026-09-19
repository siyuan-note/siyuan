import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const loadFunction = (path: string, name: string, globals: Record<string, unknown>) => {
    const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === name));
    assert.ok(declaration);
    const compiled = transpileModule(`${declaration.getText(source)}\nexports.subject = ${name};`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports: any = {};
    runInNewContext(compiled, {exports, ...globals});
    return exports.subject;
};

const keyboardEvent = (key: string, control: boolean | string = false) => ({
    key,
    target: {
        localName: "div",
        closest: (selector: string) => selector.split(", ").some(value =>
            control === true ? [".tabs-header", ".protyle-action"].includes(value) : control === value) ? {} : null,
    },
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
});

test("readonly body and tab header preserve keyboard defaults and bubbling", async () => {
    const bind = loadFunction("src/protyle/wysiwyg/keydown.ts", "keydown", {
        bindVerticalNavigationReset: (): void => undefined,
        getAVTemplateInteractiveElement: () => false,
        hasClosestByAttribute: () => false,
    });
    for (const [disabled, header] of [[true, false], [true, true], [false, true]]) {
        let listener: (event: any) => Promise<void>;
        bind({disabled}, {addEventListener: (_type: string, callback: typeof listener) => listener = callback});
        for (const key of ["copy", "commandPanel", "editReadonly", "search", "customShortcut", "Tab", "ArrowDown", "Escape"]) {
            const event = keyboardEvent(key, header);
            await listener(event);
            assert.equal(event.defaultPrevented, false, key);
            assert.equal(event.propagationStopped, false, key);
        }
    }
});

const globalFixture = (disabled: boolean, hasRange = true, foreignRange = false) => {
    const calls: string[] = [];
    const contexts: Array<{protyle: unknown, previousRange?: unknown}> = [];
    const body = {localName: "div", closest: (): null => null};
    const range = {commonAncestorContainer: foreignRange ? {} : body};
    const protyle = {
        disabled,
        options: {render: {}},
        block: {id: "doc", rootID: "doc"},
        preview: {element: {classList: {contains: () => true}}},
        getInstance: () => ({isFullscreen: () => false, setFullscreen: () => calls.push("fullscreen")}),
        element: {contains: (node: unknown) => node === body || (node as any)?.localName === "div"},
        wysiwyg: {element: {contains: (node: unknown) => node === body || (node as any)?.localName === "div"}},
        undo: {undo: () => calls.push("undo"), redo: () => calls.push("redo")},
    };
    const bindings = new Proxy({}, {get: (_target, key) => key});
    const globals = {
        getAllEditor: () => [{protyle}],
        getSelection: () => ({rangeCount: hasRange ? 1 : 0, getRangeAt: () => range}),
        getActiveTab: (): null => null,
        document: {body, querySelector: (): null => null},
        areProtylePluginExtensionsEnabled: () => true,
        captureCommandContext: (context: {range?: unknown}) => ({...context, range: context.range || range}),
        dispatchPluginShortcut: (_app: unknown, event: {key: string, preventDefault: () => void},
                                 source: string, capture: () => {protyle: unknown, range?: unknown}) => {
            if (event.key !== "pluginShortcut") {
                return false;
            }
            assert.equal(source, "editorShortcut");
            const context = capture();
            contexts.push({protyle: context.protyle, previousRange: context.range});
            calls.push("plugin");
            event.preventDefault();
            return true;
        },
        window: {siyuan: {config: {keymap: {general: bindings, editor: {general: bindings}}}}},
        hasClosestByClassName: () => false,
        isOnlyMeta: () => false,
        matchHotKey: (binding: string, event: {key: string}) => binding === event.key,
        execByCommand: (context: {command: string, protyle: unknown, previousRange?: unknown}) => {
            calls.push(context.command);
            contexts.push(context);
        },
        onlyProtyleCommand: (context: {command: string, protyle: unknown, previousRange?: unknown}) => {
            calls.push(context.command);
            contexts.push(context);
        },
        isEncryptedBox: () => false,
        fetchPost: () => calls.push("spaceRepetition"),
        zoomOut: () => calls.push("exitFocus"),
        openBacklink: () => calls.push("backlinks"),
        openGraph: () => calls.push("graphView"),
        openOutline: () => calls.push("outline"),
        reloadProtyle: () => calls.push("refresh"),
        toggleEditMode: () => calls.push("editMode"),
        saveLayout: (): void => undefined,
    };
    const documentKeydown = loadFunction("src/boot/globalEvent/keydown.ts", "documentKeydown", globals);
    const edit = loadFunction("src/boot/globalEvent/keydown.ts", "editKeydown", {...globals, documentKeydown});
    return {edit: (event: any) => edit({}, event), calls, contexts, protyle, range, body, globals};
};

test("readonly plugin shortcuts receive the editor with a valid selection or no selection", () => {
    for (const bodyTarget of [false, true]) {
        for (const [hasRange, foreignRange] of [[true, false], [false, false], [true, true]]) {
            const fixture = globalFixture(true, hasRange, foreignRange);
            const event = keyboardEvent("pluginShortcut");
            if (bodyTarget) {
                event.target = fixture.body;
            }
            assert.equal(fixture.edit(event), true);
            assert.deepEqual(fixture.calls, ["plugin"]);
            assert.equal(event.defaultPrevented, true);
            assert.equal(fixture.contexts[0].protyle, fixture.protyle);
            assert.equal(fixture.contexts[0].previousRange, hasRange && !foreignRange ? fixture.range : undefined);
        }
    }
});

test("readonly plugin fallback excludes controls, composition, editable and restricted editors", () => {
    for (const control of [true, "button", '[role="tab"]', '[role="checkbox"]', "input", "textarea"]) {
        const fixture = globalFixture(true);
        const event = keyboardEvent("pluginShortcut", control);
        if (control === "input" || control === "textarea") {
            Object.assign(event.target, {tagName: control.toUpperCase()});
        }
        assert.equal(fixture.edit(event), false);
        assert.deepEqual(fixture.calls, []);
    }
    const editable = globalFixture(false);
    assert.equal(editable.edit(keyboardEvent("pluginShortcut")), false);
    const composing = globalFixture(true);
    assert.equal(composing.edit({...keyboardEvent("pluginShortcut"), isComposing: true}), false);
    const restricted = globalFixture(true);
    restricted.globals.areProtylePluginExtensionsEnabled = () => false;
    const edit = loadFunction("src/boot/globalEvent/keydown.ts", "editKeydown", {
        ...restricted.globals, documentKeydown: () => false,
    });
    assert.equal(edit({}, keyboardEvent("pluginShortcut")), false);
    assert.deepEqual(restricted.calls, []);
});

test("readonly content mutations are consumed before command execution, even without a valid selection", () => {
    for (const [hasRange, foreignRange] of [[true, false], [false, false], [true, true]]) {
        const fixture = globalFixture(true, hasRange, foreignRange);
        for (const command of ["move", "addToDatabase", "quickMakeCard", "duplicate", "duplicateCompletely", "undo", "redo"]) {
            const event = keyboardEvent(command);
            assert.equal(fixture.edit(event), true, command);
            assert.equal(event.defaultPrevented, true, command);
        }
        assert.deepEqual(fixture.calls, []);
    }
});

test("readonly search remains contextual while unmatched shortcuts reach global dispatch", () => {
    const fixture = globalFixture(true);
    assert.equal(fixture.edit(keyboardEvent("search")), true);
    assert.deepEqual(fixture.calls, ["search"]);
    for (const command of ["commandPanel", "editReadonly", "customShortcut"]) {
        const event = keyboardEvent(command);
        assert.equal(fixture.edit(event), false);
        assert.equal(event.defaultPrevented, false);
    }
});

test("tab headers and stale selections do not execute commands on the old text selection", () => {
    const header = globalFixture(false);
    assert.equal(header.edit(keyboardEvent("undo", true)), false);
    assert.deepEqual(header.calls, []);
    const stale = globalFixture(false, true, true);
    assert.equal(stale.edit(keyboardEvent("copyPlainText")), false);
    assert.deepEqual(stale.calls, []);
});

test("editable undo still executes", () => {
    for (const [hasRange, foreignRange] of [[true, false], [false, false], [true, true]]) {
        const fixture = globalFixture(false, hasRange, foreignRange);
        assert.equal(fixture.edit(keyboardEvent("undo")), true);
        assert.deepEqual(fixture.calls, ["undo"]);
    }
});

test("document readonly shortcut works without a body selection", () => {
    for (const disabled of [false, true]) {
        for (const [hasRange, foreignRange] of [[true, false], [false, false], [true, true]]) {
            const fixture = globalFixture(disabled, hasRange, foreignRange);
            assert.equal(fixture.edit(keyboardEvent("switchReadonly")), true);
            assert.deepEqual(fixture.calls, ["switchReadonly"]);
        }
    }
});

test("editor controls dispatch document commands without carrying stale body selections", () => {
    for (const disabled of [false, true]) {
        for (const [hasRange, foreignRange] of [[true, false], [false, false], [true, true]]) {
            for (const command of ["switchReadonly", "switchAdjust", "search", "replace", "spaceRepetition",
                "exitFocus", "backlinks", "graphView", "outline", "refresh", "fullscreen", "editMode"]) {
                const fixture = globalFixture(disabled, hasRange, foreignRange);
                const event = keyboardEvent(command, true);
                assert.equal(fixture.edit(event), true, command);
                assert.equal(event.defaultPrevented, true, command);
                assert.deepEqual(fixture.calls, [command]);
                for (const context of fixture.contexts) {
                    assert.equal(context.protyle, fixture.protyle);
                    assert.equal(context.previousRange, undefined);
                }
            }
        }
    }
});

test("editor controls cannot execute body commands even with a retained selection", () => {
    for (const disabled of [false, true]) {
        for (const control of [true, "button", '[role="tab"]', '[role="checkbox"]']) {
            const fixture = globalFixture(disabled);
            for (const command of ["undo", "redo", "duplicate", "duplicateCompletely", "quickMakeCard", "move",
                "addToDatabase", "copyRichText", "copyPlainText", "copyBlockRef", "focusBreadcrumb", "customShortcut"]) {
                fixture.edit(keyboardEvent(command, control));
            }
            assert.deepEqual(fixture.calls, []);
            assert.equal(fixture.edit(keyboardEvent("switchAdjust", control)), true);
            assert.deepEqual(fixture.calls, ["switchAdjust"]);
        }
    }
});

test("document search retains the selection only for body focus in the same editor", () => {
    for (const foreignRange of [false, true]) {
        const fixture = globalFixture(false, true, foreignRange);
        assert.equal(fixture.edit(keyboardEvent("search")), true);
        assert.equal(fixture.contexts[0].previousRange, foreignRange ? undefined : fixture.range);
    }
});

test("body shortcuts follow the current document while preserving focused panel priority", () => {
    const calls: string[] = [];
    const element = (selector: string) => ({closest: (value: string) => value.split(", ").includes(selector)});
    const body = element("body");
    const firstDocument = element(".protyle");
    const secondDocument = element(".protyle");
    const filePanel = element(".sy__file");
    let activeDocument = firstDocument;
    let activePanel: ReturnType<typeof element> | undefined = undefined;
    const dispatch = loadFunction("src/boot/globalEvent/keydown.ts", "windowKeyDown", {
        filterHotkey: () => false,
        switchDialog: undefined,
        searchKeydown: () => false,
        isWindow: () => false,
        bindMenuKeydown: () => false,
        bindAVPanelKeydown: () => false,
        document: {body, querySelector: () => activePanel},
        getActiveTab: () => ({panelElement: activeDocument}),
        editKeydown: () => {
            calls.push(activeDocument === firstDocument ? "first" : "second");
            return true;
        },
        fileTreeKeydown: () => {
            calls.push("files");
            return true;
        },
    });
    const event = {...keyboardEvent("switchReadonly"), target: body};
    dispatch({}, event);
    activeDocument = secondDocument;
    dispatch({}, event);
    activePanel = filePanel;
    dispatch({}, event);
    assert.deepEqual(calls, ["first", "second", "files"]);
});

test("readonly cross-block Escape bypasses stale panel shortcut focus", () => {
    const calls: string[] = [];
    const body = {tagName: "BODY", closest: (): null => null};
    const filePanel = {
        closest: (selector: string) => selector.split(", ").some(value =>
            [".layout__tab--active", ".sy__file"].includes(value)) ? filePanel : null,
    };
    const startContainer = {};
    const endContainer = {};
    const startBlock = {};
    const endBlock = {};
    const range = {startContainer, endContainer};
    const protyle = {
        disabled: true,
        wysiwyg: {element: {contains: (element: unknown) => element === startBlock || element === endBlock}},
    };
    const selection = {rangeCount: 1, getRangeAt: () => range};
    const globals = {
        getSelection: () => selection,
        hasClosestBlock: (element: unknown) => element === startContainer ? startBlock : endBlock,
        getAllEditor: () => [{protyle}],
        hideElements: () => calls.push("hide"),
        selectBlocksByRange: () => calls.push("select"),
    };
    const getReadonlyBlockSelectionProtyle = loadFunction("src/boot/globalEvent/keydown.ts",
        "getReadonlyBlockSelectionProtyle", globals);
    const selectReadonlyBlocksByRange = loadFunction("src/boot/globalEvent/keydown.ts",
        "selectReadonlyBlocksByRange", {...globals, getReadonlyBlockSelectionProtyle});
    const dispatch = loadFunction("src/boot/globalEvent/keydown.ts", "windowKeyDown", {
        ...globals,
        getReadonlyBlockSelectionProtyle,
        selectReadonlyBlocksByRange,
        filterHotkey: () => false,
        switchDialog: undefined,
        searchKeydown: () => false,
        isWindow: () => false,
        bindMenuKeydown: () => false,
        bindAVPanelKeydown: () => false,
        document: {
            body,
            activeElement: null,
            querySelector: (selector: string) => selector === ".layout__tab--active" ? filePanel : null,
        },
        getActiveTab: (): null => null,
        editKeydown: () => false,
        fileTreeKeydown: () => {
            calls.push("file");
            return true;
        },
        panelTreeKeydown: () => false,
        EDITOR_FONT_SIZE_COMMANDS: [],
        getKeymapBindings: (): string[] => [],
        matchHotKey: () => false,
        isNotCtrl: () => true,
        hasClosestByClassName: (_element: unknown, className: string) => className === "protyle-content",
        getAllDocks: (): unknown[] => [],
        formatPainter: {deactivate: () => false},
        cancelDrag: (): void => undefined,
        window: {
            siyuan: {
                config: {readonly: false, keymap: {general: new Proxy({}, {get: () => ({})})}},
                menus: {menu: {element: {classList: {contains: () => true}}}},
                dialogs: [],
                blockPanels: [],
                backStack: [],
            },
        },
    });
    const event = {
        ...keyboardEvent("Escape"),
        target: body,
        repeat: false,
        isComposing: false,
        keyCode: 27,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
    };
    dispatch({}, event);
    assert.deepEqual(calls, ["hide", "select"]);
    assert.equal(event.defaultPrevented, true);
});

test("native command availability protects readonly content across command panel and shortcuts", () => {
    const matches = loadFunction("src/command/nativeCommands.ts", "matchesContext", {});
    for (const legacyId of ["move", "addToDatabase"]) {
        const item = {legacyId, requirement: "editorOrFileTree"};
        assert.equal(matches(item, {focus: "editor", protyle: {disabled: true}}), false);
        assert.equal(matches(item, {focus: "editor", protyle: {disabled: false}}), true);
        assert.equal(matches(item, {focus: "fileTree", fileTree: {elements: [{}]}}), true);
    }
    assert.equal(matches({legacyId: "search", requirement: "none"}, {protyle: {disabled: true}}), true);
    assert.equal(matches({legacyId: "switchReadonly", requirement: "editor"}, {protyle: {disabled: true}}), true);
});
