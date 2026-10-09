import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const fixture = () => {
    const calls: unknown[][] = [];
    const target = {closest: (): unknown => null};
    const foreign = {};
    const block = {getAttribute: () => "NodeParagraph"};
    const top = {};
    const range = {startContainer: block, commonAncestorContainer: block, toString: () => "selected name"};
    const selected: object[] = [];
    const protyle = {disabled: true, lite: false, wysiwyg: {element: {
        contains: (node: unknown) => node === target || node === block,
        querySelectorAll: () => selected,
    }}};
    const event = {
        target, key: "attr", isComposing: false, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
    };
    const selection = {rangeCount: 1, getRangeAt: () => range};
    const code = transpileModule(readFileSync("src/protyle/util/attributeHotkey.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports: {handleReadonlyAttributeHotkey?: (protyle: object, event: object) => boolean} = {};
    runInNewContext(code, {
        exports,
        require: (name: string) => ({
            "../../menus/commonMenuItem": {openAttr: (...args: unknown[]) => calls.push(args)},
            "./hasClosest": {hasClosestBlock: () => block},
            "../wysiwyg/getBlock": {getTopAloneElement: () => top},
            "./hotKey": {matchHotKey: (_keymap: unknown, item: {key: string}) => item.key === "attr"},
        }[name]),
        window: {siyuan: {config: {keymap: {editor: {general: {attr: "attr"}}}}}},
        getSelection: () => selection,
    });
    return {calls, protyle, event, range, selected, selection, target, foreign, block, top,
        run: () => exports.handleReadonlyAttributeHotkey(protyle, event)};
};

test("readonly attribute shortcut opens the current block even with selected text, without naming it", () => {
    const subject = fixture();
    assert.equal(subject.run(), true);
    assert.deepEqual(subject.calls, [[subject.top, "bookmark", subject.protyle]]);
    assert.equal(subject.event.prevented, true);
    assert.equal(subject.event.stopped, true);
});

test("readonly attribute shortcut uses a single explicitly selected block", () => {
    const subject = fixture();
    const selected = {};
    subject.selected.push(selected);
    assert.equal(subject.run(), true);
    assert.equal(subject.calls[0][0], selected);
});

test("attribute shortcut rejects foreign selections, controls, composition and unsupported contexts", () => {
    const changes = [
        (subject: ReturnType<typeof fixture>) => { subject.protyle.disabled = false; },
        (subject: ReturnType<typeof fixture>) => { subject.protyle.lite = true; },
        (subject: ReturnType<typeof fixture>) => { subject.event.isComposing = true; },
        (subject: ReturnType<typeof fixture>) => { subject.event.key = "other"; },
        (subject: ReturnType<typeof fixture>) => { subject.selection.rangeCount = 0; },
        (subject: ReturnType<typeof fixture>) => { subject.range.commonAncestorContainer = subject.foreign as typeof subject.block; },
        (subject: ReturnType<typeof fixture>) => { subject.target.closest = () => ({}); },
        (subject: ReturnType<typeof fixture>) => { subject.block.getAttribute = () => "NodeThematicBreak"; },
    ];
    changes.forEach(change => {
        const subject = fixture();
        change(subject);
        assert.equal(subject.run(), false);
        assert.equal(subject.calls.length, 0);
        assert.equal(subject.event.prevented, false);
    });
});
