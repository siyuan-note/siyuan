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
const methods = declaration.members.filter(item => ["drawSummaries", "drawSummaryPreview", "positionSummaryAction"].includes(item.name?.getText(source)));
assert.equal(methods.length, 3);
const compiled = transpileModule(`class View { ${methods.map(item => item.getText(source)).join("\n")} }
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

class PathFixture {
    commands: (string | number)[][] = [];
    moveTo(...values: number[]) { this.commands.push(["move", ...values]); }
    lineTo(...values: number[]) { this.commands.push(["line", ...values]); }
    bezierCurveTo(...values: number[]) { this.commands.push(["bezier", ...values]); }
    quadraticCurveTo(...values: number[]) { this.commands.push(["quadratic", ...values]); }
}

test("summary previews and committed paths match across styles, zoom levels and the legacy default", () => {
    for (const connectorStyle of [undefined, ...LIST_MINDMAP_CONNECTOR_STYLES]) {
        for (const scale of [.5, 1, 2]) {
            const sandbox: any = {Path2D: PathFixture, buildListMindmapSummaryConnector, layoutListMindmapSummaries, getListMindmapSummarySelection};
            runInNewContext(compiled, sandbox);
            const view = new sandbox.View();
            const children = ["a", "b"].map((id): ListMindmapNode =>
                ({id, parentId: "root", children: [], contentBlocks: [], virtual: false, collapsed: false}));
            const root: ListMindmapNode = {id: "root", children, contentBlocks: [], virtual: true, collapsed: false};
            const range = {parentId: "root", nodeIds: ["a", "b"]};
            const model: ListMindmapModel = {list: undefined, root, nodes: new Map([root, ...children].map(node => [node.id, node])),
                metadata: {version: 1, nodes: {}, relations: [], connectorStyle}};
            const positions = new Map(children.map((node, index) =>
                [node.id, {id: node.id, x: 100, y: 40 + index * 80, width: 120, height: 50}]));
            let selected = ["a"];
            Object.assign(view, {model, positions, summaryPositions: new Map(), getSelectedIds: () => selected,
                inspector: {hidden: false, getBoundingClientRect: () => ({left: 0, right: 0, top: 0, bottom: 0})},
                summaryAction: {offsetWidth: 80, offsetHeight: 32, style: {}, setAttribute: () => {}},
                label: (key: string) => key, offsetX: 0, offsetY: 0, getToolbarBounds: (): DOMRect[] => [],
                viewport: {clientWidth: 600, clientHeight: 400, getBoundingClientRect: () => ({left: 0, top: 0, width: 600, height: 400})},
                options: {}, scale, linePaths: [], summaryElements: new Map()});
            const strokes: PathFixture[] = [];
            const context = {save: () => {}, restore: () => {}, setLineDash: () => {},
                stroke: (path: PathFixture) => strokes.push(path)};
            view.drawSummaryPreview(context, "blue");
            assert.equal(strokes.length, 0, "single selection does not draw a summary preview");
            assert.equal(view.summaryAction.hidden, true);
            selected = ["a", "b"];
            view.drawSummaryPreview(context, "blue");
            assert.equal(strokes.length, 1);
            assert.equal(view.summaryAction.hidden, false);
            const preview = strokes.pop();
            Object.assign(model.metadata, {summaries: [{...range, id: "summary", label: "Summary"}]});
            view.summaryPositions = layoutListMindmapSummaries(model, positions,
                new Map([["summary", {width: 100, height: 40}]]));
            view.summaryElements.set("summary", {style: {}, classList: {toggle: () => {}}, setAttribute: () => {}});
            view.drawSummaries(context, () => ({color: "blue", width: 1.5}));
            assert.equal(strokes.length, 1);
            assert.deepEqual(strokes[0].commands, preview.commands);
            assert.equal(view.linePaths[0].path, strokes[0], "hit testing uses the rendered shape");
            assert.deepEqual(strokes[0].commands, buildListMindmapSummaryConnector(
                view.summaryPositions.get("summary"), connectorStyle || "bezier", () => new PathFixture()).commands);
            strokes.length = 0;
            view.options.printLayout = true;
            view.drawSummaryPreview(context, "blue");
            assert.equal(strokes.length, 0, "creation previews are excluded from exports");
            assert.equal(view.summaryAction.hidden, true, "creation controls are excluded from exports");
        }
    }
});

test("graph summary actions follow canvas transforms, show the batch count and avoid visible controls", () => {
    const sandbox: any = {};
    runInNewContext(compiled, sandbox);
    const view = new sandbox.View();
    const attributes = new Map<string, string>();
    const action = {hidden: true, offsetWidth: 80, offsetHeight: 32, textContent: "", style: {left: "", top: ""},
        setAttribute: (key: string, value: string) => attributes.set(key, value)};
    const position = {id: "preview", x: 276, labelX: 300, labelY: 150, top: 100, bottom: 200, width: 0, height: 0};
    Object.assign(view, {summaryAction: action, viewport: {clientWidth: 600, clientHeight: 400,
        getBoundingClientRect: () => ({left: 20, top: 30, width: 1200, height: 800})},
        inspector: {hidden: true}, positions: new Map(), summaryPositions: new Map(), getToolbarBounds: (): DOMRect[] => [],
        label: (key: string) => key === "listMindmapSummaryBatch" ? "Create ${count} summaries" : "Summary"});
    for (const scale of [.5, 1, 1.5]) {
        Object.assign(view, {scale, offsetX: 12, offsetY: 20});
        view.positionSummaryAction([position], 1);
        assert.equal(action.hidden, false);
        assert.equal(action.textContent, "Summary");
        assert.equal(parseFloat(action.style.left), 12 + position.labelX * scale);
        assert.equal(parseFloat(action.style.top), 20 + (position.top + position.bottom) * scale / 2 - 16);
    }
    Object.assign(view, {scale: 1, offsetX: 0, offsetY: 0,
        getToolbarBounds: () => [{left: 600, right: 900, top: 270, bottom: 410}]});
    view.positionSummaryAction([position], 3);
    assert.equal(action.textContent, "Create 3 summaries");
    assert.equal(attributes.get("aria-label"), action.textContent);
    assert.equal(parseFloat(action.style.top), 60, "a scaled toolbar moves the action above the selected range");
    view.viewport.clientWidth = 240;
    view.positionSummaryAction([position], 3);
    assert.ok(parseFloat(action.style.left) >= 8);
    assert.ok(parseFloat(action.style.left) + action.offsetWidth <= 232);
    view.viewport.clientWidth = 40;
    view.positionSummaryAction([position], 3);
    assert.equal(action.hidden, true, "an action that cannot fit is not clipped into a misleading hit target");
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
        editSummaryLabel: (id: string) => edited.push(id)});
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

test("single, invalid, crossing, duplicate and read-only summary selections never submit", async () => {
    for (const mode of ["single", "empty", "virtual", "crossing", "duplicate", "readonly", "locked", "export"]) {
        const {view, model, calls, select} = create();
        if (mode === "single") { select(["a"]); }
        if (mode === "empty") { select([]); }
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
    for (const outcome of ["success", "selection", "readonly", "destroyed", "failed", "rejected"]) {
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
        else { resolve(outcome === "failed" ? undefined : ["new"]); }
        await pending;
        frames.forEach(action => action());
        assert.equal(view.summaryPending, false);
        assert.deepEqual(edited, outcome === "success" ? ["new"] : [], outcome);
    }
});
