import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = transpileModule(readFileSync("src/mobile/util/bindBottomSheetDialog.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = () => {
    let open = true;
    let observer: () => void;
    let freezes = 0;
    let cancelled = 0;
    const sheet = {style: {transition: "", transform: "", visibility: ""}, offsetHeight: 240,
        classList: {add() {}}, querySelector: (): null => null, querySelectorAll: (): HTMLElement[] => [], prepend() {}};
    const root = {isConnected: true, dataset: {dialogClosing: "false"},
        classList: {add() {}, contains: () => open},
        querySelector: (selector: string) => selector === ".b3-dialog__container" ? sheet : {},
    };
    const layout = {resize() {}, setMode() {}, getBounds() {}, setPreferredHeight() {},
        freeze() { freezes++; }, dispose() {}};
    const api: any = {};
    runInNewContext(source, {exports: api,
        require: () => ({bindMobileSheetLayout: () => layout,
            bindKeyboardSheetState: () => () => {},
            bindBottomSheetDrag: () => Object.assign(() => {}, {cancel() {}}),
            waitForSheetViewport: (options: {open(): void}) => {options.open(); return () => cancelled++;}}),
        document: {createElement: () => ({className: "", setAttribute() {}, remove() {}})},
        window: {innerHeight: 800, siyuan: {mobile: {size: {portrait: {height1: 800}}}}},
        MutationObserver: class {
            constructor(callback: () => void) { observer = callback; }
            observe() {}
            disconnect() {}
        },
    });
    const dispose = api.bindBottomSheetDialog({element: root}, async () => true);
    return {sheet, root, dispose, freezes: () => freezes, cancelled: () => cancelled,
        close: (accepted: boolean) => {open = false; root.dataset.dialogClosing = String(accepted); observer();}};
};

for (const transition of ["", "none"]) {
    test(`accepted close hands a dragged sheet back to its CSS exit transition (${transition || "released"})`, () => {
        const s = setup();
        s.sheet.style.transition = transition;
        s.sheet.style.transform = "translateY(80px)";
        s.close(true);
        assert.equal(s.freezes(), 1);
        assert.equal(s.cancelled(), 1);
        assert.equal(s.sheet.style.transition, "");
        assert.equal(s.sheet.style.transform, "");
        s.dispose();
    });
}

test("a panel that has not entered closing state keeps its entrance or gesture positioning", () => {
    const s = setup();
    s.sheet.style.transition = "none";
    s.sheet.style.transform = "translateY(100%)";
    s.close(false);
    assert.equal(s.freezes(), 0);
    assert.equal(s.sheet.style.transition, "none");
    assert.equal(s.sheet.style.transform, "translateY(100%)");
    s.dispose();
});
