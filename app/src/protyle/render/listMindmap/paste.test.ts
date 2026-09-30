import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const handler = view.members.find(item => item.name?.getText(source) === "pasteImages");
assert.ok(handler);
const compiled = transpileModule(`class View { ${handler.getText(source)} }
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const create = () => {
    const context: any = {};
    runInNewContext(compiled, context);
    const calls: {id: string, files: unknown[]}[] = [];
    const images = [{name: "image.png", type: "image/png"}, {name: "photo.jpg", type: "image/jpeg"}];
    let finish: () => void;
    const target = Object.assign(new context.View(), {
        readOnly: false, selectedId: "node",
        model: {nodes: new Map([["node", {virtual: false}]])},
        options: {onPasteImages: (id: string, files: unknown[]) => calls.push({id, files})},
        finishThen: (action: () => void) => { finish = action; },
    });
    const event = {
        defaultPrevented: false,
        target: {isContentEditable: false, closest: (): object | null => null},
        clipboardData: {files: [...images, {name: "file.pdf", type: "application/pdf"}]},
        preventDefault() { this.defaultPrevented = true; },
    };
    return {target, event, calls, images, finish: () => finish?.()};
};

test("selected mind map nodes accept clipboard images after finishing the previous editor", () => {
    const current = create();
    current.target.pasteImages(current.event);
    assert.equal(current.event.defaultPrevented, true);
    assert.equal(current.calls.length, 0);
    current.finish();
    assert.equal(current.calls[0].id, "node");
    assert.deepEqual(Array.from(current.calls[0].files), current.images);
});

test("mind map image paste respects edit state, selection and read-only boundaries", () => {
    for (const mode of ["readonly", "editing", "relation", "summary", "virtual", "missing", "unselected",
        "input", "editable", "handled", "text", "export"]) {
        const current = create();
        switch (mode) {
            case "readonly": current.target.readOnly = true; break;
            case "editing": current.target.editingId = "node"; break;
            case "relation": current.target.relationFrom = "node"; break;
            case "summary": current.target.summaryFrom = "node"; break;
            case "virtual": current.target.model.nodes.get("node").virtual = true; break;
            case "missing": current.target.model.nodes.clear(); break;
            case "unselected": current.target.selectedId = undefined; break;
            case "input": current.event.target.closest = () => ({}); break;
            case "editable": current.event.target.isContentEditable = true; break;
            case "handled": current.event.defaultPrevented = true; break;
            case "text": current.event.clipboardData.files = []; break;
            case "export": current.target.options.onPasteImages = undefined; break;
        }
        current.target.pasteImages(current.event);
        current.finish();
        assert.equal(current.calls.length, 0, mode);
        assert.equal(current.event.defaultPrevented, mode === "handled", mode);
    }
});

test("delayed image paste never follows a changed selection or deleted node", () => {
    for (const change of ["selection", "delete", "readonly"]) {
        const current = create();
        current.target.pasteImages(current.event);
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
