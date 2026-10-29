import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const handler = view.members.find(item => item.name?.getText(source) === "pasteSelection");
assert.ok(handler);
const compiled = transpileModule(`class View { ${handler.getText(source)} }
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const create = () => {
    const context: any = {};
    runInNewContext(compiled, context);
    const calls: {id: string, kind: string, data: {files: unknown[], textPlain: string}}[] = [];
    const images = [{name: "image.png", type: "image/png"}, {name: "photo.jpg", type: "image/jpeg"}];
    let finish: () => void;
    const target = Object.assign(new context.View(), {
        readOnly: false, selectedId: "node",
        model: {nodes: new Map([["node", {virtual: false}]])},
        getSelectedIds() { return this.selectedId ? [this.selectedId] : []; },
        options: {onPaste: (id: string, kind: string, data: {files: unknown[], textPlain: string}) => calls.push({id, kind, data})},
        finishThen: (action: () => void) => { finish = action; },
    });
    const event = {
        defaultPrevented: false,
        target: {isContentEditable: false, closest: (): object | null => null},
        clipboardData: {files: [...images, {name: "file.pdf", type: "application/pdf"}],
            getData: (type: string) => ({"text/plain": "", "text/html": "", "text/siyuan": ""}[type] || "")},
        preventDefault() { this.defaultPrevented = true; },
    };
    return {target, event, calls, images, finish: () => finish?.()};
};

test("selected mind map nodes paste all clipboard files into a new child after finishing the previous editor", () => {
    const current = create();
    current.target.pasteSelection(current.event);
    assert.equal(current.event.defaultPrevented, true);
    assert.equal(current.calls.length, 0);
    current.finish();
    assert.equal(current.calls[0].id, "node");
    assert.equal(current.calls[0].kind, "child");
    assert.deepEqual(Array.from(current.calls[0].data.files), current.event.clipboardData.files);
});

test("mind map paste respects edit state, selection and read-only boundaries", () => {
    for (const mode of ["readonly", "editing", "composing", "relation", "multiple", "missing", "unselected",
        "input", "editable", "handled", "text", "export"]) {
        const current = create();
        switch (mode) {
            case "readonly": current.target.readOnly = true; break;
            case "editing": current.target.editingId = "node"; break;
            case "composing": current.target.selectionComposing = true; break;
            case "relation": current.target.relationFrom = "node"; break;
            case "multiple": current.target.getSelectedIds = () => ["node", "other"]; break;
            case "missing": current.target.model.nodes.clear(); break;
            case "unselected": current.target.selectedId = undefined; break;
            case "input": current.event.target.closest = () => ({}); break;
            case "editable": current.event.target.isContentEditable = true; break;
            case "handled": current.event.defaultPrevented = true; break;
            case "text": current.event.clipboardData.files = []; break;
            case "export": current.target.options.onPaste = undefined; break;
        }
        current.target.pasteSelection(current.event);
        current.finish();
        assert.equal(current.calls.length, 0, mode);
        assert.equal(current.event.defaultPrevented, mode === "handled", mode);
    }
});

test("the selection input preserves node paste until native composition starts", () => {
    const current = create();
    current.event.target.isContentEditable = true;
    current.target.selectionInput = current.event.target;
    current.target.pasteSelection(current.event);
    current.finish();
    assert.equal(current.event.defaultPrevented, true);
    assert.equal(current.calls.length, 1);
    current.event.defaultPrevented = false;
    current.target.selectionComposing = true;
    current.target.pasteSelection(current.event);
    assert.equal(current.event.defaultPrevented, false);
    assert.equal(current.calls.length, 1);
});

test("delayed node paste never follows a changed selection or deleted node", () => {
    for (const change of ["selection", "delete", "readonly"]) {
        const current = create();
        current.target.pasteSelection(current.event);
        if (change === "selection") {
            current.target.selectedId = "other";
        } else if (change === "delete") {
            current.target.model.nodes.clear();
        } else {
            current.target.readOnly = true;
        }
        current.finish();
        assert.equal(current.calls.length, 0, change);
    }
});

test("plain text and virtual-root child paste are supported, while sibling paste requires a real node", () => {
    for (const virtual of [false, true]) {
        for (const sibling of [false, true]) {
            const current = create();
            current.event.clipboardData.files = [];
            current.event.clipboardData.getData = type => type === "text/plain" ? "Copied text" : "";
            current.target.model.nodes.get("node").virtual = virtual;
            current.target.pasteSibling = sibling;
            current.target.pasteSelection(current.event);
            current.finish();
            assert.equal(current.calls.length, virtual && sibling ? 0 : 1);
            if (current.calls.length) {
                assert.equal(current.calls[0].data.textPlain, "Copied text");
                assert.equal(current.calls[0].kind, sibling ? "sibling" : "child");
            }
        }
    }
});
