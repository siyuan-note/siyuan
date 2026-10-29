import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("dialog close guard covers direct close requests and permits cleanup after completion", () => {
    const compiled = transpileModule(readFileSync("src/dialog/index.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exported = {} as {Dialog: {prototype: object}};
    const scheduled: Array<() => void> = [];
    let panelsDestroyed = 0;
    runInNewContext(compiled, {
        exports: exported,
        require: () => ({
            isAbove: () => false,
            Constants: {TIMEOUT_DBLCLICK: 0},
            destroyDialogBlockPanels: () => panelsDestroyed++,
        }),
        document: {removeEventListener: () => {}},
        window: {siyuan: {menus: {menu: {element: {}}}}},
        setTimeout: (callback: () => void) => scheduled.push(callback),
    });
    let allowClose = false;
    const dialog = Object.assign(Object.create(exported.Dialog.prototype), {
        destroying: false,
        closeGuard: () => allowClose,
        element: {dataset: {}, classList: {remove: () => {}}, querySelector: () => ({})},
    });
    dialog.destroy();
    dialog.destroy();
    assert.equal(dialog.destroying, false);
    assert.equal(scheduled.length, 0);
    assert.equal(panelsDestroyed, 0);
    allowClose = true;
    dialog.destroy();
    assert.equal(dialog.destroying, true);
    assert.equal(scheduled.length, 1);
    assert.equal(panelsDestroyed, 1);
    dialog.destroy();
    assert.equal(scheduled.length, 1);
});
