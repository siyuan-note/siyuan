import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {describe, it} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {isTableLikeView} from "./viewType";

const source = readFileSync("src/protyle/render/av/cell.ts", "utf8");
const compiled = transpileModule(source.slice(source.indexOf("const updateCellValueByInput ="),
    source.indexOf("export const updateCellsValue =")), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;

const createEditor = (changed: boolean, viewType = "table") => {
    const saved: unknown[][] = [];
    let focusCount = 0;
    let removed = false;
    const input = {value: "updated value", dataset: {changed: changed ? "true" : undefined}};
    const mask = {
        querySelector: () => input,
        remove: () => {
            removed = true;
        },
    };
    const protyle = {};
    const block = {
        getAttribute: (name: string) => name === "data-av-type" ? viewType : "database-id",
    };
    const cells = [{dataset: {}, classList: {add: () => {}}}];
    const context = {
        isTableLikeView,
        document: {
            querySelector: (selector: string) => selector === ".av__mask" ? mask : null,
            querySelectorAll: () => [mask],
        },
        hasClosestByClassName: (_element: unknown, className: string) =>
            className === "av__row" ? {dataset: {id: "row-id"}} : null,
        updateCellsValue: (...args: unknown[]) => saved.push(args),
        addDragFill: () => {},
        focusBlock: () => focusCount++,
    };
    const submit = runInNewContext(`${compiled}\nupdateCellValueByInput;`, context);
    return {
        close: (restoreFocus = false) => submit(protyle, "block", block, cells, restoreFocus),
        saved,
        protyle,
        block,
        cells,
        isRemoved: () => removed,
        focusCount: () => focusCount,
    };
};

describe("database cell editor navigation", () => {
    it("submits list property edits using the row identity and restores focus", () => {
        const editor = createEditor(true, "list");
        editor.close(true);
        assert.deepEqual(editor.saved[0], [editor.protyle, editor.block, "updated value", editor.cells]);
        assert.equal(editor.focusCount(), 1);
        assert.equal(editor.isRemoved(), true);
    });
    it("submits edited content to the original cell without focusing the departing document", () => {
        const editor = createEditor(true);
        editor.close();
        assert.equal(editor.saved.length, 1);
        assert.deepEqual(editor.saved[0], [editor.protyle, editor.block, "updated value", editor.cells]);
        assert.equal(editor.isRemoved(), true);
        assert.equal(editor.focusCount(), 0);
    });

    it("closes unchanged content without submitting or restoring focus", () => {
        const editor = createEditor(false);
        editor.close();
        assert.equal(editor.saved.length, 0);
        assert.equal(editor.isRemoved(), true);
        assert.equal(editor.focusCount(), 0);
    });

    it("preserves focus restoration when finishing editing inside the document", () => {
        for (const changed of [false, true]) {
            const editor = createEditor(changed);
            editor.close(true);
            assert.equal(editor.focusCount(), 1);
            assert.equal(editor.isRemoved(), true);
        }
    });
});
