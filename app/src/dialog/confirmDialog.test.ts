import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/dialog/confirmDialog.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (extra = true, labels: [string?, string?] = []) => {
    let content: string;
    const calls: string[] = [];
    const inserted: {id?: string, textContent?: string}[] = [];
    let click: (event: unknown) => void;
    let destroy: () => void;
    const element = {
        addEventListener: (_name: string, listener: typeof click) => click = listener,
        setAttribute: () => {},
        querySelectorAll: (): never[] => [],
        querySelector: () => ({before: (...nodes: typeof inserted) => inserted.push(...nodes), focus: () => {}}),
    };
    const exports: any = {};
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {languages: {cancel: "Cancel", confirm: "Confirm"}}},
        document: {activeElement: null, createElement: () => ({})},
        require: () => ({
            isMobile: () => false,
            Constants: {DIALOG_CONFIRM: "confirm"},
            Dialog: class {
                element = element;
                constructor(options: {content: string, destroyCallback: () => void}) {
                    content = options.content;
                    destroy = options.destroyCallback;
                }
                destroy() {
                    destroy();
                }
            },
        }),
    });
    exports.confirmDialog({title: "Title", text: "Text", confirm: () => { calls.push("confirm"); },
        cancel: () => calls.push("cancel"), confirmLabel: labels[0], cancelLabel: labels[1],
        extraAction: extra ? {label: "Move and keep sorting", callback: () => calls.push("move")} : undefined});
    return {
        content,
        calls,
        inserted,
        close: () => destroy(),
        click: (id: string, detail?: string) => click({target: {id, parentElement: element}, detail}),
    };
};

test("the extra action is inserted before confirmation and does not cancel on destruction", () => {
    const f = fixture();
    assert.equal(f.inserted[0].id, "extraDialogConfirmBtn");
    assert.equal(f.inserted[0].textContent, "Move and keep sorting");
    f.click("extraDialogConfirmBtn");
    assert.deepEqual(f.calls, ["move"]);
});

test("closing and canceling the dialog never trigger the extra action", () => {
    for (const action of ["close", "cancel", "escape"]) {
        const f = fixture();
        if (action === "close") {
            f.close();
        } else {
            f.click(action === "cancel" ? "cancelDialogConfirmBtn" : "", action === "escape" ? "Escape" : undefined);
        }
        assert.deepEqual(f.calls, ["cancel"]);
    }
});

test("confirmation and Enter retain their original action with or without the extra button", async () => {
    for (const extra of [true, false]) {
        for (const enter of [true, false]) {
            const f = fixture(extra);
            assert.equal(f.inserted.length, extra ? 2 : 0);
            f.click(enter ? "" : "confirmDialogConfirmBtn", enter ? "Enter" : undefined);
            await new Promise(resolve => setImmediate(resolve));
            assert.deepEqual(f.calls, ["confirm"]);
        }
    }
});

test("custom button labels preserve the standard confirm and cancel actions", () => {
    const labels: [string, string] = ["Install now", "Not now"];
    const f = fixture(false, labels);
    assert.match(f.content, /id="cancelDialogConfirmBtn">Not now<\/button>/);
    assert.match(f.content, /id="confirmDialogConfirmBtn">Install now<\/button>/);
    f.click("cancelDialogConfirmBtn");
    assert.deepEqual(f.calls, ["cancel"]);
    const defaults = fixture(false);
    assert.match(defaults.content, /id="cancelDialogConfirmBtn">Cancel<\/button>/);
    assert.match(defaults.content, /id="confirmDialogConfirmBtn">Confirm<\/button>/);
});
