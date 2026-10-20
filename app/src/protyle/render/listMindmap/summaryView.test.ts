import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import {buildListMindmapSummaryConnector, LIST_MINDMAP_CONNECTOR_STYLES} from "./connectors";
import {layoutListMindmapSummaries} from "./summary";
import type {ListMindmapModel, ListMindmapNode} from "./model";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const declaration = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(declaration && isClassDeclaration(declaration));
const methods = declaration.members.filter(item => ["drawSummaries", "drawSummaryPreview"].includes(item.name?.getText(source)));
assert.equal(methods.length, 2);
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
            const sandbox: any = {Path2D: PathFixture, buildListMindmapSummaryConnector, layoutListMindmapSummaries};
            runInNewContext(compiled, sandbox);
            const view = new sandbox.View();
            const child: ListMindmapNode = {id: "a", parentId: "root", children: [], contentBlocks: [], virtual: false, collapsed: false};
            const root: ListMindmapNode = {id: "root", children: [child], contentBlocks: [], virtual: true, collapsed: false};
            const range = {parentId: "root", nodeIds: ["a"]};
            const model: ListMindmapModel = {list: undefined, root, nodes: new Map([["root", root], ["a", child]]),
                metadata: {version: 1, nodes: {}, relations: [], connectorStyle}};
            const positions = new Map([["a", {id: "a", x: 100, y: 40, width: 120, height: 50}]]);
            Object.assign(view, {model, positions, summaryPositions: new Map(), summaryRanges: [range],
                summarySelecting: true, options: {}, scale, linePaths: [], summaryElements: new Map()});
            const strokes: PathFixture[] = [];
            const context = {save: () => {}, restore: () => {}, setLineDash: () => {},
                stroke: (path: PathFixture) => strokes.push(path)};
            view.drawSummaryPreview(context, "blue");
            assert.equal(strokes.length, 1);
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
        }
    }
});
