import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync(__dirname + "/touchBlockSelection.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (multi = false, editable = true, nested = false) => {
    const calls: string[] = [];
    const highlight = {classList: {remove: () => calls.push("highlight")}};
    const root = {querySelector: () => ({}), querySelectorAll: () => [highlight]};
    const target = {isContentEditable: editable, closest: () => nested ? {} : root};
    const protyle = {wysiwyg: {element: root}, toolbar: {isMultiSelectMode: () => multi}};
    const exports = {} as typeof import("./touchBlockSelection");
    runInNewContext(compiled, {
        exports,
        require: () => ({hideElements: () => calls.push("selection"), countBlockWord: () => calls.push("status")}),
    });
    return {calls, down: (overrides: Partial<PointerEvent> = {}) => {
        exports.clearTouchBlockSelection(protyle as unknown as IProtyle, {
            target, pointerType: "touch", button: 0, ...overrides,
        } as unknown as PointerEvent);
    }};
};

test("native content touch without mouse events clears block selection and hover feedback", () => {
    for (const pointerType of ["touch", "pen"]) {
        const f = fixture();
        f.down({pointerType});
        assert.deepEqual(f.calls, ["selection", "status", "highlight"]);
    }
});

test("mouse and modified gestures retain their selection handling", () => {
    for (const event of [{pointerType: "mouse"}, {button: 2}, {ctrlKey: true}, {metaKey: true},
        {altKey: true}, {shiftKey: true}]) {
        const f = fixture();
        f.down(event);
        assert.deepEqual(f.calls, []);
    }
});

test("multi-select mode, noneditable controls and nested editors keep their selections", () => {
    for (const args of [[true, true, false], [false, false, false], [false, true, true]]) {
        const f = fixture(...args);
        f.down();
        assert.deepEqual(f.calls, []);
    }
});
