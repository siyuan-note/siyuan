import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);

const createDragLifecycle = (owned = true, hovered = true) => {
    const source = parse("src/layout/dock/Files.ts");
    let assignment: ts.BinaryExpression;
    const visit = (node: ts.Node) => {
        if (ts.isBinaryExpression(node) && node.left.getText(source) === "this.cancelDrag") {
            assignment = node;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(assignment);
    const calls: unknown[] = [];
    const classes = new Set(["dragover", "dragover__top", "sy__file--disablehover"]);
    const row = {style: {opacity: "0.38"}, classList: {remove: (...names: string[]) => names.forEach(name => classes.delete(name))}};
    const hover = {rafId: hovered ? 42 : null, update: hovered ? () => {} : undefined,
        refresh: hovered ? () => {} : undefined, element: hovered ? row : null, positionY: 20, sourceOnlyRoot: true};
    const runtime = {touchDragGhost: {remove: () => calls.push("ghost")}, dragElement: {}, dragTitle: "Private document"};
    const panel = {
        docTree: {release: (key: string) => calls.push(["release", key])},
        dragSelection: owned ? {key: "source"} : undefined, cancelDrag: undefined as (() => void) | undefined,
        element: {querySelectorAll: () => [row]}, parent: {panelElement: {classList: row.classList}},
    };
    const compiled = ts.transpileModule(`(function () {${assignment.getText(source)};}).call(panel);`, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText;
    runInNewContext(compiled, {
        panel, dragOverLastObj: hover, counter: 1, window: {siyuan: runtime},
        cancelAnimationFrame: (id: number) => calls.push(["cancel-frame", id]),
        stopScrollAnimation: () => calls.push("scroll"),
        hideDragTip: () => calls.push("tip"), clearDocumentTabMovePreview: () => calls.push("preview"),
        ipcRenderer: {send: () => {}}, Constants: {}, document: {querySelectorAll: (): Element[] => []},
    });
    return {panel, hover, row, classes, runtime, calls};
};

test("canceling a desktop drag clears retained rows, ghosts and queued hover work", () => {
    const {panel, hover, row, classes, runtime, calls} = createDragLifecycle();
    panel.cancelDrag();
    assert.equal(panel.dragSelection, undefined);
    assert.equal(hover.rafId, null);
    assert.equal(hover.refresh, undefined);
    assert.equal(hover.update, undefined);
    assert.equal(hover.element, null);
    assert.equal(row.style.opacity, "");
    assert.equal(classes.size, 0);
    assert.equal(runtime.touchDragGhost, undefined);
    assert.equal(runtime.dragElement, undefined);
    assert.equal(runtime.dragTitle, "");
    assert.deepEqual(calls, ["scroll", ["release", "source"], ["cancel-frame", 42], "ghost", "tip", "preview"]);
});

test("destroying a tree without its own source preserves another panel's drag", () => {
    for (const hovered of [false, true]) {
        const {panel, runtime, calls} = createDragLifecycle(false, hovered);
        const ghost = runtime.touchDragGhost;
        const source = runtime.dragElement;
        panel.cancelDrag();
        assert.equal(runtime.touchDragGhost, ghost);
        assert.equal(runtime.dragElement, source);
        assert.equal(runtime.dragTitle, "Private document");
        assert.deepEqual(calls, hovered ? ["scroll", ["cancel-frame", 42], "tip"] : []);
    }
});

for (const file of ["src/layout/dock/Files.ts", "src/mobile/dock/MobileFiles.ts"]) {
    test(`${file} ignores a notebook refresh callback after destruction`, () => {
        const source = parse(file);
        const methods = source.statements.find(ts.isClassDeclaration).members.filter(member =>
            ["init", "destroy"].includes(member.name?.getText(source))).map(member => member.getText(source));
        const calls: string[] = [];
        const exports: {Adapter?: new () => {init: (initial: boolean) => void, destroy: () => void, disposed: boolean}} = {};
        runInNewContext(ts.transpileModule(`class Adapter extends Model {${methods.join("\n")}} exports.Adapter = Adapter;`, {
            compilerOptions: {target: ts.ScriptTarget.ES2022},
        }).outputText, {exports, window: {clearTimeout: () => {}},
            Model: class { destroy() { calls.push("model"); } }});
        const adapter = new exports.Adapter();
        Object.assign(adapter, {
            cancelDrag: () => calls.push("drag"), cancelTouchDrag: () => calls.push("touch"),
            lifecycleEvents: {abort: () => calls.push("listeners")}, getOpenPaths: () => calls.push("save"),
            parentDocClick: {cancel: () => {}}, openedFileSelection: {cancel: () => {}},
            pinnedDocs: {destroy: () => calls.push("pins")}, docTree: {destroy: () => calls.push("tree")},
            selectionProgress: {destroy: () => calls.push("progress")},
        });
        const lateNotebookResponse = () => adapter.init(false);
        adapter.destroy();
        lateNotebookResponse();
        assert.equal(adapter.disposed, true);
        assert.ok(calls.includes("tree") && calls.includes("pins") && calls.includes("progress"));
        assert.ok(calls.includes(file.includes("mobile") ? "touch" : "drag"));
    });
}
