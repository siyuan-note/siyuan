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

const keyboardEvent = (key: string, header = false) => ({
    key,
    target: {localName: "div", closest: () => header ? {} : null},
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
    const body = {};
    const range = {commonAncestorContainer: foreignRange ? {} : body};
    const protyle = {
        disabled,
        options: {},
        element: {contains: (node: unknown) => node === body || (node as any)?.localName === "div"},
        undo: {undo: () => calls.push("undo"), redo: () => calls.push("redo")},
    };
    const bindings = new Proxy({}, {get: (_target, key) => key});
    const edit = loadFunction("src/boot/globalEvent/keydown.ts", "editKeydown", {
        getAllEditor: () => [{protyle}],
        getSelection: () => ({rangeCount: hasRange ? 1 : 0, getRangeAt: () => range}),
        getActiveTab: (): null => null,
        document: {querySelector: (): null => null},
        window: {siyuan: {config: {keymap: {general: bindings, editor: {general: bindings}}}}},
        hasClosestByClassName: () => false,
        isOnlyMeta: () => false,
        matchHotKey: (binding: string, event: {key: string}) => binding === event.key,
        execByCommand: ({command}: {command: string}) => calls.push(command),
    });
    return {edit: (event: any) => edit({}, event), calls};
};

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
