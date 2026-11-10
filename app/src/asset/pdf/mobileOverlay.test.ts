import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = transpileModule(readFileSync("src/asset/pdf/overlay_manager.js", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = (mobile = true) => {
    const sheets: {finish: () => void, requested: boolean, focus?: unknown}[] = [];
    const exports: any = {};
    runInNewContext(source, {exports, require: () => ({openPdfMobileOverlay: (_element: unknown, onClose: () => void) => {
        if (!mobile) return;
        let complete: () => void;
        const closed = new Promise<void>(resolve => { complete = resolve; });
        const sheet = {requested: false, focus: undefined as unknown, finish: () => { onClose(); complete(); }};
        sheets.push(sheet);
        return {closed, dialog: {destroy: () => { sheet.requested = true; },
            focusWhenReady: (target: () => unknown) => { sheet.focus = target(); }}};
    }})});
    const element = () => {
        const classes = new Set<string>();
        return {classList: {add: (value: string) => classes.add(value), remove: (value: string) => classes.delete(value)},
            addEventListener() {}, classes};
    };
    return {manager: new exports.OverlayManager(), sheets, element};
};

test("PDF mobile close waits for actual sheet disposal before reopening the same element", async () => {
    const s = setup();
    const element = s.element();
    await s.manager.register(element);
    await s.manager.open(element);
    const close = s.manager.close();
    const reopen = s.manager.open(element);
    await Promise.resolve();
    assert.equal(s.sheets.length, 1);
    assert.equal(s.sheets[0].requested, true);
    s.sheets[0].finish();
    await close;
    await reopen;
    assert.equal(s.sheets.length, 2);
    assert.equal(s.manager.active, element);
    const input = {};
    assert.equal(s.manager.focus(input), true);
    assert.equal(s.sheets[1].focus, input);
});

test("PDF force-close serializes disposal before moving another overlay into its sheet", async () => {
    const s = setup();
    const first = s.element();
    const second = s.element();
    await s.manager.register(first);
    await s.manager.register(second, true);
    await s.manager.open(first);
    const next = s.manager.open(second);
    await Promise.resolve();
    assert.equal(s.sheets.length, 1);
    s.sheets[0].finish();
    await next;
    assert.equal(s.manager.active, second);
    assert.equal(s.sheets.length, 2);
});

test("PDF desktop overlays retain their original class-based behavior", async () => {
    const s = setup(false);
    const element = s.element();
    await s.manager.register(element);
    await s.manager.open(element);
    assert.ok(element.classes.has("dialog--open"));
    assert.equal(s.manager.focus({}), false);
    await s.manager.close();
    assert.equal(s.manager.active, null);
    assert.equal(element.classes.has("dialog--open"), false);
});
