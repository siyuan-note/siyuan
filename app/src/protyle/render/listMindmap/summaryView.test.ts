import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import {buildListMindmapSummaryConnector, LIST_MINDMAP_CONNECTOR_STYLES} from "./connectors";
import {addListMindmapSummaryRanges, getListMindmapSummarySelection, getListMindmapSummarySnapshot, layoutListMindmapSummaries} from "./summary";
import type {ListMindmapModel, ListMindmapNode} from "./model";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const declaration = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(declaration && isClassDeclaration(declaration));
const methods = declaration.members.filter(item => ["drawSummaries"].includes(item.name?.getText(source)));
assert.equal(methods.length, 1);
const compiled = transpileModule(`class View { ${methods.map(item => item.getText(source)).join("\n")} }
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

class PathFixture {
    commands: (string | number)[][] = [];
    moveTo(...values: number[]) { this.commands.push(["move", ...values]); }
    lineTo(...values: number[]) { this.commands.push(["line", ...values]); }
    bezierCurveTo(...values: number[]) { this.commands.push(["bezier", ...values]); }
    quadraticCurveTo(...values: number[]) { this.commands.push(["quadratic", ...values]); }
}

test("committed summary paths retain their shapes and hit testing across styles, zoom levels and the legacy default", () => {
    for (const connectorStyle of [undefined, ...LIST_MINDMAP_CONNECTOR_STYLES]) {
        for (const scale of [.5, 1, 2]) {
            const sandbox: any = {Path2D: PathFixture, buildListMindmapSummaryConnector};
            runInNewContext(compiled, sandbox);
            const view = new sandbox.View();
            const children = ["a", "b"].map((id): ListMindmapNode =>
                ({id, parentId: "root", children: [], contentBlocks: [], virtual: false, collapsed: false}));
            const root: ListMindmapNode = {id: "root", children, contentBlocks: [], virtual: true, collapsed: false};
            const model: ListMindmapModel = {list: undefined, root, nodes: new Map([root, ...children].map(node => [node.id, node])),
                metadata: {version: 1, nodes: {}, relations: [], connectorStyle,
                    summaries: [{parentId: "root", nodeIds: ["a", "b"], id: "summary", label: "Summary"}]}};
            const positions = new Map(children.map((node, index) =>
                [node.id, {id: node.id, x: 100, y: 40 + index * 80, width: 120, height: 50}]));
            Object.assign(view, {model, options: {}, scale, linePaths: [], summaryElements: new Map(),
                summaryPositions: layoutListMindmapSummaries(model, positions, new Map([["summary", {width: 100, height: 40}]]))});
            view.summaryElements.set("summary", {style: {}, classList: {toggle: () => {}}, setAttribute: () => {}});
            const strokes: PathFixture[] = [];
            const context = {setLineDash: () => {}, stroke: (path: PathFixture) => strokes.push(path)};
            view.drawSummaries(context, () => ({color: "blue", width: 1.5}));
            assert.equal(strokes.length, 1);
            assert.equal(view.linePaths[0].path, strokes[0], "hit testing uses the rendered shape");
            assert.deepEqual(strokes[0].commands, buildListMindmapSummaryConnector(
                view.summaryPositions.get("summary"), connectorStyle || "bezier", () => new PathFixture()).commands);
        }
    }
});

const creation = declaration.members.find(item => item.name?.getText(source) === "createSummary");
assert.ok(creation);
const creationCode = transpileModule(`class View { ${creation.getText(source)} } globalThis.View = View;`,
    {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
const create = () => {
    const frames: (() => void)[] = [];
    const context: any = {getListMindmapSummarySelection, getListMindmapSummarySnapshot,
        requestAnimationFrame: (action: () => void) => frames.push(action), console: {error: () => {}}};
    runInNewContext(creationCode, context);
    const children = ["a", "b", "c"].map((id): ListMindmapNode => ({id, parentId: "root", children: [], virtual: false, collapsed: false, contentBlocks: []}));
    const root: ListMindmapNode = {id: "root", children, virtual: true, collapsed: false, contentBlocks: []};
    const model: ListMindmapModel = {list: undefined, root, nodes: new Map([root, ...children].map(node => [node.id, node])),
        metadata: {version: 1, nodes: {}, relations: []}};
    let selected = ["a", "b"];
    const calls: {ranges: {parentId: string, nodeIds: string[]}[], expected: string}[] = [];
    const edited: string[] = [];
    const view = Object.assign(new context.View(), {model, getSelectedIds: () => selected,
        options: {onSummaryBatchAdd: async (ranges: {parentId: string, nodeIds: string[]}[], expected: string) => {
            calls.push({ranges, expected});
            return addListMindmapSummaryRanges(model, ranges, () => "new", "Summary");
        }}, updateSelection: () => {}, selectSummary: (id: string) => { view.selectedSummary = id; },
        revealNode: () => {}, editSummaryLabel: (id: string) => edited.push(id)});
    return {view, model, calls, frames, edited, select: (ids: string[]) => selected = ids};
};

test("summary creation consumes the current selection once and retains the snapshot and editable result", async () => {
    const {view, model, calls, frames, edited} = create();
    const expected = getListMindmapSummarySnapshot(model);
    await view.createSummary();
    assert.deepEqual(calls, [{ranges: [{parentId: "root", nodeIds: ["a", "b"]}], expected}]);
    assert.equal(view.summaryPending, false);
    assert.equal(model.metadata.summaries.length, 1);
    frames.forEach(action => action());
    assert.deepEqual(edited, ["new"]);
    await view.createSummary();
    assert.equal(calls.length, 1, "identical ranges do not submit again");
});

test("a single node creates an editable summary and cannot create the same range twice", async () => {
    const {view, model, calls, frames, edited, select} = create();
    select(["a"]);
    const expected = getListMindmapSummarySnapshot(model);
    await view.createSummary();
    assert.deepEqual(calls, [{ranges: [{parentId: "root", nodeIds: ["a"]}], expected}]);
    assert.equal(model.metadata.version, 1, "a single-node summary retains the existing format");
    assert.deepEqual(model.metadata.summaries[0].nodeIds, ["a"]);
    frames.forEach(action => action());
    assert.deepEqual(edited, ["new"]);
    await view.createSummary();
    assert.equal(calls.length, 1, "duplicate single-node ranges are rejected");
});

test("invalid, crossing, duplicate and read-only summary selections never submit", async () => {
    for (const mode of ["empty", "missing", "virtual", "crossing", "duplicate", "readonly", "locked", "export"]) {
        const {view, model, calls, select} = create();
        if (mode === "empty") { select([]); }
        if (mode === "missing") { select(["missing"]); }
        if (mode === "virtual") { select(["root"]); }
        if (mode === "crossing" || mode === "duplicate") {
            addListMindmapSummaryRanges(model, [{parentId: "root", nodeIds: ["a", "b"]}], () => "old", "Old");
            if (mode === "crossing") { select(["b", "c"]); }
        }
        if (mode === "readonly" || mode === "locked") { view.readOnly = true; }
        if (mode === "export") { view.options.onSummaryBatchAdd = undefined; }
        await view.createSummary();
        assert.equal(calls.length, 0, mode);
    }
});

test("pending summaries reject repeated activation and late results preserve a changed selection", async () => {
    for (const outcome of ["success", "multiple", "selection", "readonly", "destroyed", "failed", "rejected"]) {
        const {view, select, frames, edited} = create();
        let resolve: (ids?: string[]) => void;
        let reject: (error: Error) => void;
        let submitted = 0;
        view.options.onSummaryBatchAdd = () => {
            submitted++;
            return new Promise<string[] | undefined>((done, fail) => { resolve = done; reject = fail; });
        };
        const pending = view.createSummary();
        assert.equal(view.summaryPending, true);
        await view.createSummary();
        assert.equal(submitted, 1);
        if (outcome === "selection") { select(["c"]); }
        if (outcome === "readonly") { view.readOnly = true; }
        if (outcome === "destroyed") { view.destroyed = true; }
        if (outcome === "rejected") { reject(new Error("write failed")); }
        else { resolve(outcome === "failed" ? undefined : outcome === "multiple" ? ["new", "second"] : ["new"]); }
        await pending;
        frames.forEach(action => action());
        assert.equal(view.summaryPending, false);
        assert.deepEqual(edited, ["success", "multiple"].includes(outcome) ? ["new"] : [], outcome);
    }
});
