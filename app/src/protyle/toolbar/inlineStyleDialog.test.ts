import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("inline style persistence delegates pending saves and reports failure or success to the lifecycle", async () => {
    let click: (event: unknown) => Promise<void>;
    let confirm: () => Promise<boolean>;
    let complete: (value: {code: number; msg?: string}) => void;
    let saves = 0;
    let changes = 0;
    let closes = 0;
    const errors: string[] = [];
    const data = {version: 2, styles: [] as unknown[], order: {style1: [] as string[]}};
    const controls = new Map();
    const control = (selector: string) => {
        if (!controls.has(selector)) controls.set(selector, {
            classList: {toggle() {}}, querySelectorAll: (): HTMLElement[] => [], addEventListener() {},
        });
        return controls.get(selector);
    };
    class Dialog {
        element = {querySelector: control, addEventListener: (_: string, callback: typeof click) => { click = callback; }};
        runPending(task: () => Promise<boolean>) {
            confirm = task;
            return Promise.resolve(false);
        }
        destroy() { closes++; }
    }
    const exports = {} as typeof import("./inlineStyleDialog");
    const dependencies = {
        MobileDialog: Dialog, isMobile: () => true, escapeHtml: (value: string) => value,
        normalizeInlineStyles: (value: object) => value, getInlineStylesCache: () => data,
        getProperties: (): string[] => [], getThemeColorEditorHTML: () => "", getBuiltinEditorHTML: () => "",
        bindThemeColorEditor: () => ({}), bindBuiltinEditor: () => ({}),
        getOrderedStyleKeys: (): string[] => [], bindColorListDrag() {},
        saveInlineStyles: (draft: unknown) => {
            assert.equal(JSON.stringify(draft), JSON.stringify(data));
            saves++;
            return new Promise(resolve => { complete = resolve; });
        },
        showMessage: (message: string) => { errors.push(message); }, setInlineStyle() {},
    };
    runInNewContext(transpileModule(readFileSync("src/protyle/toolbar/inlineStyleDialog.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, require: () => dependencies, window: {siyuan: {config: {}, languages: {}}}});
    exports.openInlineStyleDialog("style1", () => { changes++; });
    const save = {dataset: {action: "save"}, hasAttribute: () => false,
        classList: {contains: () => false}, closest: (selector: string) => selector === "[data-action]" ? save : null};
    await click({target: save, preventDefault() {}, stopPropagation() {}});
    assert.equal(saves, 0, "persistence must be delegated to the shared pending lifecycle");
    const failed = confirm();
    complete({code: -1, msg: "Save failed"});
    assert.equal(await failed, false);
    assert.equal(changes, 0);
    assert.equal(closes, 0);
    assert.deepEqual(errors, ["Save failed"]);
    const retry = confirm();
    complete({code: 0});
    assert.equal(await retry, true);
    assert.equal(saves, 2);
    assert.equal(changes, 1);
    assert.equal(closes, 0, "the shared lifecycle owns successful closure");
});
