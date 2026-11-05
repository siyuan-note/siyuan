import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("plugin settings await confirmation, retain failed drafts and guard repeated saves", async () => {
    const buttons = [0, 1].map(() => ({click: () => {},
        addEventListener(_name: string, callback: () => void) { this.click = callback; }}));
    let task: () => Promise<boolean>;
    let destroyed = 0;
    let guarded = 0;
    let options: {destroyCallback: () => void};
    const exports: {Setting?: typeof import("./Setting").Setting} = {};
    runInNewContext(transpileModule(readFileSync("src/plugin/Setting.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports, document: {}, window: {siyuan: {languages: {}}},
        require: (name: string) => name === "../dialog/mobileDialog" ? {
            MobileDialog: class {
                element = {
                    querySelector: () => ({}), querySelectorAll: () => buttons,
                };
                constructor(value: typeof options) { options = value; }
                focusWhenReady() {}
                runPending(callback: typeof task) { guarded++; task = callback; }
                destroy() { destroyed++; options.destroyCallback(); }
            },
        } : name === "../util/functions" ? {isMobile: () => true} :
            name === "../config/setting/windowContext" ? {isSettingsWindow: () => false} :
                name === "../util/genID" ? {genUUID: () => "fixture"} : {},
    });
    let saves = 0;
    let cleanups = 0;
    let release: () => void;
    let reject = true;
    const setting = new exports.Setting({confirmCallback: async () => {
        saves++;
        await new Promise<void>(resolve => { release = resolve; });
        if (reject) throw new Error("plugin save failed");
    }, destroyCallback: () => cleanups++});
    setting.open("Fixture");
    buttons[1].click();
    assert.equal(guarded, 1, "confirmation delegates repeated-click and close protection to MobileDialog");
    assert.equal(saves, 0);
    const failed = task();
    assert.equal(saves, 1);
    assert.equal(destroyed, 0);
    release();
    await assert.rejects(failed, /plugin save failed/);
    assert.equal(cleanups, 0, "failed confirmation leaves plugin controls mounted");
    reject = false;
    buttons[1].click();
    const retry = task();
    release();
    assert.equal(await retry, true, "only successful confirmation permits the shared dialog to close");
    assert.equal(saves, 2);
    buttons[0].click();
    assert.equal(cleanups, 1);
    assert.equal(destroyed, 1);
    assert.equal(saves, 2, "cancel does not confirm");
});

for (const mobile of [false, true]) {
    test(`${mobile ? "mobile" : "desktop"} plugin settings leave input and textarea focus to the user`, () => {
        const bindings: {input: unknown; enter: boolean; focus: boolean}[] = [];
        let requestedFocus = 0;
        const itemElement = {insertAdjacentElement() {}, lastElementChild: {insertAdjacentElement() {}}};
        const content = {insertAdjacentHTML() {}, lastElementChild: itemElement};
        const buttons = [0, 1].map(() => ({addEventListener() {}}));
        const exports: {Setting?: typeof import("./Setting").Setting} = {};
        runInNewContext(transpileModule(readFileSync("src/plugin/Setting.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS},
        }).outputText, {exports, document: {}, window: {siyuan: {languages: {}}},
            require: (name: string) => name === "../dialog/mobileDialog" ? {
                MobileDialog: class {
                    element = {querySelector: () => content, querySelectorAll: () => buttons};
                    bindInput(input: unknown, _callback: () => void, enter: boolean, focus = true) {
                        bindings.push({input, enter, focus});
                    }
                    focusWhenReady() { requestedFocus++; }
                },
            } : name === "../util/functions" ? {isMobile: () => mobile} :
                name === "../config/setting/windowContext" ? {isSettingsWindow: () => false} :
                    name === "../util/genID" ? {genUUID: () => "fixture"} : {},
        });
        const setting = new exports.Setting({});
        const control = (tagName: string) => ({tagName, classList: {contains: () => false, add() {}, remove() {}}}) as unknown as HTMLElement;
        const input = control("INPUT");
        const textarea = control("TEXTAREA");
        setting.addItem({title: "Input", actionElement: input});
        setting.addItem({title: "Textarea", createActionElement: () => textarea});
        for (let i = 0; i < 2; i++) {
            setting.open("Fixture");
            assert.deepEqual(bindings.slice(i * 2), [
                {input, enter: true, focus: false}, {input: textarea, enter: false, focus: false},
            ]);
            assert.equal(requestedFocus, 0, "opening and reopening must not request input focus");
        }
    });
}
