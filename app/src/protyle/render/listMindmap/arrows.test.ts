import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import type {ListMindmapRelation} from "./model";
import {buildListMindmapConnectors} from "./connectors";
import {getMindmapLineColor, resolveListMindmapColors} from "./appearance";

// 执行实际绘制和命中方法，画布替身仅记录路径与箭头，避免依赖图形显示环境。
const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const methods = view.members.filter(item => ["relationPath", "draw", "resizeViewport", "getViewportAnchorY",
    "updateDocumentViewport", "rememberViewport", "findLine", "renderInspector", "makePaletteRow"]
    .includes(item.name?.getText(source)));
assert.equal(methods.length, 9);
const compiled = transpileModule(`class View {
    ${methods.map(item => item.getText(source)).join("\n")}
}
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

type Point = {x: number, y: number};
class TestPath {
    public points: Point[] = [];
    moveTo(x: number, y: number) { this.points.push({x, y}); }
    lineTo(x: number, y: number) { this.points.push({x, y}); }
    bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number) { this.lineTo(x, y); }
    quadraticCurveTo(_a: number, _b: number, x: number, y: number) { this.lineTo(x, y); }
}

const setup = (arrowDirection?: ListMindmapRelation["arrowDirection"]) => {
    let polygon: Point[] = [];
    const polygons: Point[][] = [];
    const strokes: TestPath[] = [];
    const strokeStyles: string[] = [];
    const strokeAlphas: number[] = [];
    const strokeWidths: number[] = [];
    const context = {
        strokeStyle: "",
        lineWidth: 0,
        globalAlpha: 1,
        strokeHit: false,
        setTransform: () => {}, clearRect: () => {}, translate: () => {}, scale: () => {},
        setLineDash: () => {}, closePath: () => {}, save: () => {}, restore: () => {}, resetTransform: () => {},
        beginPath: () => { polygon = []; },
        moveTo: (x: number, y: number) => polygon.push({x, y}),
        lineTo: (x: number, y: number) => polygon.push({x, y}),
        fill: () => polygons.push(polygon),
        stroke: (path: TestPath) => {
            strokes.push(path);
            strokeStyles.push(context.strokeStyle);
            strokeAlphas.push(context.globalAlpha);
            strokeWidths.push(context.lineWidth);
        },
        isPointInStroke: () => context.strokeHit,
    };
    const sandbox: any = {
        buildListMindmapConnectors,
        getMindmapLineColor,
        Path2D: TestPath, window: {devicePixelRatio: 1},
        // 绘制入口会取消上一帧的合并绘制请求，替身环境没有帧调度
        cancelAnimationFrame: () => {}, requestAnimationFrame: () => 1,
        getComputedStyle: (element: {style?: {color?: string}}) => ({
            getPropertyValue: () => "", color: element.style?.color || "black",
        }),
    };
    runInNewContext(compiled, sandbox);
    const target = new sandbox.View();
    const relation: ListMindmapRelation = {id: "r", from: "a", to: "b", label: "Keep"};
    if (arrowDirection !== undefined) {
        relation.arrowDirection = arrowDirection;
    }
    const element = () => ({hidden: false, offsetWidth: 0, offsetHeight: 0,
        style: {}, classList: {toggle: () => {}}});
    Object.assign(target, {
        scale: 1, offsetX: 0, offsetY: 0, world: {style: {}}, zoomLabel: {}, zoomSlider: {},
        syncSelectionInput: () => {},
        viewport: {clientWidth: 400, clientHeight: 200, getBoundingClientRect: () => ({left: 0, top: 0})},
        canvas: {getContext: () => context}, options: {host: {}}, colorProbe: {style: {}},
        inspector: {hidden: true},
        model: {root: {id: "a"}, metadata: {nodes: {}, relations: [relation]}}, edges: [],
        positions: new Map([["a", {id: "a", x: 100, y: 0, width: 20, height: 20}],
            ["b", {id: "b", x: -20, y: 0, width: 20, height: 20}]]),
        relationElements: new Map([["r", element()]]),
        relationRoutes: new Map([["r", [{x: 100, y: 10}, {x: 0, y: 10}]]]),
        routingObstacles: (): unknown[] => [], drawRelationPreview: () => {}, drawSummaries: () => {}, renderRouteControls: () => {},
    });
    return {target, context, polygons, strokes, strokeStyles, strokeAlphas, strokeWidths, element};
};

test("opening branches fade with their shared trunk while already visible siblings keep their trunk opaque", () => {
    for (const connectorStyle of ["spline", "bezier", "orthogonal", "rounded"]) {
        const {target, strokeAlphas} = setup();
        target.model.root.id = "root";
        Object.assign(target.model.metadata, {connectorStyle, relations: []});
        target.positions = new Map([
            ["root", {id: "root", x: 20, y: 100, width: 100, height: 40}],
            ["a", {id: "a", x: 160, y: 0, width: 100, height: 40}],
            ["b", {id: "b", x: 160, y: 200, width: 100, height: 40}],
        ]);
        target.edges = [{from: "root", to: "a"}, {from: "root", to: "b"}];
        target.foldOpacities = new Map([["a", .4], ["b", .4]]);
        target.draw();
        assert.ok(strokeAlphas.length >= 2 && strokeAlphas.every(alpha => alpha === .4),
            "the common trunk does not jump to full opacity before its branches appear");
        strokeAlphas.length = 0;
        target.foldOpacities.delete("b");
        target.draw();
        assert.deepEqual(strokeAlphas, ["orthogonal", "rounded"].includes(connectorStyle) ? [1, .4, 1] : [.4, 1]);
    }
});

test("shared orthogonal trunks keep the default color and stay outside branch selection in every renderer", () => {
    for (const connectorStyle of ["orthogonal", "rounded"]) {
        for (const printLayout of [false, true]) {
            const {target, strokes, strokeStyles} = setup();
            Object.assign(target.model.metadata, {connectorStyle, relations: [], nodes: {
                root: {lineColor: "#112233"}, a: {lineColor: "#ff0000"}, b: {lineColor: "#0000ff"},
            }});
            target.model.root.id = "root";
            target.readOnly = printLayout;
            target.options.printLayout = printLayout;
            target.positions = new Map([
                ["root", {id: "root", x: 20, y: 100, width: 100, height: 40}],
                ["a", {id: "a", x: 160, y: 0, width: 100, height: 40}],
                ["b", {id: "b", x: 160, y: 200, width: 100, height: 40}],
            ]);
            target.edges = [{from: "root", to: "a"}, {from: "root", to: "b"}];
            target.selectedEdge = "b";
            target.draw();
            assert.deepEqual(strokeStyles, ["#112233", "#ff0000", "#0000ff"]);
            assert.equal(target.linePaths.length, 2);
            assert.equal(target.linePaths.some((line: {path: TestPath}) => line.path === strokes[0]), false,
                "the shared trunk is drawn once without becoming a selectable child line");
        }
    }
});

test("palette colors reach hierarchy paths and parent trunks while manual line colors remain authoritative", () => {
    for (const connectorStyle of ["spline", "bezier", "orthogonal", "rounded"]) {
        for (const printLayout of [false, true]) {
            const {target, strokeStyles} = setup();
            target.model.root = {id: "root", children: [{id: "a", children: []},
                {id: "b", children: [{id: "c", children: []}]}]};
            Object.assign(target.model.metadata, {connectorStyle, relations: [], nodes: {a: {lineColor: "#abcdef"}},
                appearance: {version: 1, palette: ["#222222", "#333333"], rootColor: "#111111"}});
            target.themeColors = resolveListMindmapColors(target.model);
            target.options.printLayout = printLayout;
            target.readOnly = printLayout;
            target.positions = new Map([
                ["root", {id: "root", x: 20, y: 100, width: 100, height: 40}],
                ["a", {id: "a", x: 160, y: 0, width: 100, height: 40}],
                ["b", {id: "b", x: 160, y: 200, width: 100, height: 40}],
                ["c", {id: "c", x: 300, y: 200, width: 100, height: 40}],
            ]);
            target.edges = [{from: "root", to: "a"}, {from: "root", to: "b"}, {from: "b", to: "c"}];
            target.draw();
            const trunks = connectorStyle === "orthogonal" || connectorStyle === "rounded" ? ["#111111", "#333333"] : [];
            assert.deepEqual(strokeStyles, [...trunks, "#abcdef", "#333333", "#333333"]);
            assert.equal(target.linePaths.length, 3, "shared trunks never become selectable branch paths");
        }
    }
});

test("reference themes paint root overlaps with branch colors in display order at one width in editing and print", () => {
    for (const connectorStyle of ["orthogonal", "rounded"]) {
        for (const printLayout of [false, true]) {
            const {target, strokes, strokeStyles, strokeAlphas, strokeWidths} = setup();
            target.model.root = {id: "root", children: [{id: "a", children: []},
                {id: "b", children: [{id: "c", children: []}]}]};
            Object.assign(target.model.metadata, {connectorStyle, relations: [],
                nodes: {a: {branchColor: 0, lineColor: "#abcdef"}, b: {branchColor: 1}},
                appearance: {version: 1, palette: ["#ff0000", "#0000ff"], rootColor: "#111111", nodeStyle: "branch"}});
            target.themeColors = resolveListMindmapColors(target.model);
            target.options.printLayout = printLayout;
            target.readOnly = printLayout;
            target.positions = new Map([
                ["root", {id: "root", x: 20, y: 100, width: 100, height: 40}],
                ["a", {id: "a", x: 160, y: 0, width: 100, height: 40}],
                ["b", {id: "b", x: 160, y: 200, width: 100, height: 40}],
                ["c", {id: "c", x: 300, y: 200, width: 100, height: 40}],
            ]);
            target.edges = [{from: "root", to: "a"}, {from: "root", to: "b"}, {from: "b", to: "c"}];
            target.draw();
            assert.deepEqual(strokeStyles, ["#0000ff", "#abcdef", "#abcdef", "#0000ff", "#0000ff", "#0000ff"]);
            assert.ok(strokeWidths.every(width => width === 1.5));
            assert.equal(target.linePaths.length, 3);
            for (const index of [0, 1, 3]) {
                assert.ok(target.linePaths.every((line: {path: TestPath}) => line.path !== strokes[index]),
                    "colored common trunks remain outside selectable branch paths");
            }
            target.model.root.children.reverse();
            target.edges = [target.edges[1], target.edges[0], target.edges[2]];
            target.themeColors = resolveListMindmapColors(target.model);
            strokeStyles.length = 0;
            strokeWidths.length = 0;
            strokeAlphas.length = 0;
            target.foldOpacities = new Map([["a", .4]]);
            target.draw();
            assert.deepEqual(strokeStyles, ["#0000ff", "#0000ff", "#0000ff", "#abcdef", "#abcdef", "#0000ff"]);
            assert.deepEqual(strokeAlphas, [1, 1, 1, .4, .4, 1], "a branch and its root overlay fade together");
            assert.ok(strokeWidths.every(width => width === 1.5));
        }
    }
});

test("all arrow modes use endpoint identity rather than canonical path drawing order", () => {
    for (const mode of [undefined, "forward", "reverse", "both", "none"] as const) {
        for (const scale of [.5, 1, 2]) {
            const {target, polygons, strokes} = setup(mode);
            target.scale = scale;
            target.draw();
            const tips = mode === "none" ? [] : mode === "reverse" ? [100] : mode === "both" ? [0, 100] : [0];
            assert.equal(polygons.length, tips.length);
            assert.deepEqual(polygons.map(polygon => polygon[1].x), tips);
            assert.equal(strokes.length, 1);
            assert.equal(strokes[0].points[0].x, 0, "dash drawing order is independent of from/to");
            assert.deepEqual(Array.from(target.linePaths[0].arrows, (tip: Point) => tip.x), tips);
            polygons.forEach((polygon, index) => {
                assert.ok(tips[index] === 0 ? polygon[0].x > 0 : polygon[0].x < 100,
                    "arrowheads point outwards at each logical endpoint");
            });
        }
    }
});

test("hit testing follows only visible arrowheads and keeps no-arrow paths selectable", () => {
    for (const mode of ["forward", "reverse", "both", "none"] as const) {
        for (const scale of [.5, 1, 2]) {
            const {target, context} = setup(mode);
            target.scale = scale;
            target.draw();
            const find = (x: number) => target.findLine({clientX: x * scale, clientY: 10 * scale});
            assert.equal(find(0)?.id, mode === "forward" || mode === "both" ? "r" : undefined);
            assert.equal(find(100)?.id, mode === "reverse" || mode === "both" ? "r" : undefined);
            context.strokeHit = true;
            assert.equal(find(50)?.id, "r", "the line itself remains selectable in every mode");
        }
    }
});

test("overlapping opposite relations retain separate identity and selected-arrow priority", () => {
    const {target, element, context} = setup("both");
    target.model.metadata.relations.push({id: "other", from: "b", to: "a", label: "", arrowDirection: "both"});
    target.relationElements.set("other", element());
    target.relationRoutes.set("other", [{x: 0, y: 10}, {x: 100, y: 10}]);
    for (const selected of ["r", "other"]) {
        target.selectedRelation = selected;
        target.draw();
        for (const x of [0, 100]) {
            assert.equal(target.findLine({clientX: x, clientY: 10}).id, selected);
        }
        context.strokeHit = true;
        assert.equal(target.findLine({clientX: 50, clientY: 10}).id, selected);
        context.strokeHit = false;
    }
});

test("short bidirectional arrows stay separated and hierarchy lines have no arrows", () => {
    const {target, polygons, strokes} = setup("both");
    target.relationRoutes.set("r", [{x: 8, y: 10}, {x: 0, y: 10}]);
    target.edges = [{from: "a", to: "b"}];
    target.draw();
    assert.equal(polygons.length, 2);
    assert.equal(strokes.length, 2);
    assert.ok(Math.max(...polygons[0].map(point => point.x)) < Math.min(...polygons[1].map(point => point.x)));
    assert.equal(target.linePaths.find((line: {relation: boolean}) => !line.relation).arrows, undefined);
});

test("read-only and print rendering retain all saved arrow modes", () => {
    for (const mode of ["forward", "reverse", "both", "none"] as const) {
        const normal = setup(mode);
        normal.target.draw();
        for (const printLayout of [false, true]) {
            const {target, polygons} = setup(mode);
            target.readOnly = true;
            target.options.printLayout = printLayout;
            target.draw();
            assert.deepEqual(polygons, normal.polygons);
        }
    }
});

test("the shared direction selector preserves focus and only patches arrow direction", () => {
    const focusState: {activeElement?: Control} = {};
    class Control {
        public children: Control[] = [];
        public attributes = new Map<string, string>();
        public style = {setProperty: (name: string, value: string) => this.attributes.set(name, value)};
        public classList = {add: () => {}, toggle: () => {}};
        public events = new Map<string, () => void>();
        public hidden = false;
        public value = "";
        public textContent = "";
        constructor(public tag: string) {}
        append(...elements: Control[]) { this.children.push(...elements); }
        replaceChildren() { this.children = []; }
        // 色卡行会遍历带 --current 的子项补标记；本桩的 classList 不记录类名，因而确实没有命中项。
        querySelectorAll(): Control[] { return []; }
        querySelector(tag: string): Control | undefined {
            for (const child of this.children) {
                const result = child.tag === tag ? child : child.querySelector(tag);
                if (result) { return result; }
            }
        }
        setAttribute(name: string, value: string) { this.attributes.set(name, value); }
        addEventListener(name: string, callback: () => void) { this.events.set(name, callback); }
        focus() { focusState.activeElement = this; }
    }
    const changes: {id: string, patch: Partial<ListMindmapRelation>}[] = [];
    const sandbox: any = {
        document: {createElement: (tag: string) => new Control(tag), get activeElement() { return focusState.activeElement; }},
        createElement: (tag: string) => new Control(tag),
    };
    runInNewContext(compiled, sandbox);
    const target = new sandbox.View();
    const relation: ListMindmapRelation = {id: "r", from: "a", to: "b", label: "Keep"};
    Object.assign(target, {
        inspector: new Control("div"), selectedRelation: "r", model: {metadata: {relations: [relation]}},
        label: (key: string) => key,
        queueInspectorLayout: () => {},
        makeButton: () => {
            const button = new Control("button");
            button.append(new Control("svg"));
            return button;
        },
        options: {onRelationChange: (id: string, patch: Partial<ListMindmapRelation>) => changes.push({id, patch})},
    });
    target.renderInspector();
    let select: Control = target.inspector.querySelector("select");
    assert.equal(select.attributes.get("aria-label"), "listMindmapArrowDirection");
    assert.equal(select.value, "forward");
    assert.deepEqual(select.children.map(option => option.value), ["forward", "reverse", "both", "none"]);
    for (const arrowDirection of ["forward", "reverse", "both", "none"] as const) {
        select.focus();
        select.value = arrowDirection;
        select.events.get("change")();
        assert.deepEqual(JSON.parse(JSON.stringify(changes.pop())), {id: "r", patch: {arrowDirection}});
        relation.arrowDirection = arrowDirection;
        target.renderInspector();
        select = target.inspector.querySelector("select");
        assert.equal(focusState.activeElement, select);
        assert.equal(select.value, arrowDirection);
    }
    target.inspector.replaceChildren();
    target.readOnly = true;
    target.renderInspector();
    assert.equal(target.inspector.querySelector("select"), undefined, "read-only views expose no direction editor");
});
