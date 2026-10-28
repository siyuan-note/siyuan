import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../testSupport/loadModule";

const fixture = (multi = false, editable = true, nested = false) => {
    const calls: string[] = [];
    const highlight = {classList: {remove: () => calls.push("highlight")}};
    const root = {querySelector: () => ({}), querySelectorAll: () => [highlight]};
    const target = {isContentEditable: editable, closest: () => nested ? {} : root};
    const protyle = {wysiwyg: {element: root}, toolbar: {isMultiSelectMode: () => multi}};
    const exports = loadModule<typeof import("./touchBlockSelection")>(
        "src/protyle/wysiwyg/touchBlockSelection.ts", {
            require: () => ({hideElements: () => calls.push("selection"), countBlockWord: () => calls.push("status")}),
        }, ScriptTarget.ES2021);
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
