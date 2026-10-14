import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import type {ListMindmapRelation} from "./model";

// 执行实际绘制和命中方法，画布替身仅记录路径与箭头，避免依赖图形显示环境。
const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const methods = view.members.filter(item => ["relationPath", "draw", "findLine", "renderInspector"].includes(item.name?.getText(source)));
assert.equal(methods.length, 4);
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
    const context = {
        strokeHit: false,
        setTransform: () => {}, clearRect: () => {}, translate: () => {}, scale: () => {},
        setLineDash: () => {}, closePath: () => {}, save: () => {}, restore: () => {}, resetTransform: () => {},
        beginPath: () => { polygon = []; },
        moveTo: (x: number, y: number) => polygon.push({x, y}),
        lineTo: (x: number, y: number) => polygon.push({x, y}),
        fill: () => polygons.push(polygon),
        stroke: (path: TestPath) => strokes.push(path),
        isPointInStroke: () => context.strokeHit,
    };
    const sandbox: any = {
        Path2D: TestPath, window: {devicePixelRatio: 1},
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
        viewport: {clientWidth: 400, clientHeight: 200, getBoundingClientRect: () => ({left: 0, top: 0})},
        canvas: {getContext: () => context}, options: {host: {}}, colorProbe: {style: {}},
        model: {root: {id: "a"}, metadata: {nodes: {}, relations: [relation]}}, edges: [],
        positions: new Map([["a", {id: "a", x: 100, y: 0, width: 20, height: 20}],
            ["b", {id: "b", x: -20, y: 0, width: 20, height: 20}]]),
        relationElements: new Map([["r", element()]]),
        relationRoutes: new Map([["r", [{x: 100, y: 10}, {x: 0, y: 10}]]]),
        routingObstacles: () => [], drawRelationPreview: () => {}, drawSummaries: () => {}, renderRouteControls: () => {},
    });
    return {target, context, polygons, strokes, element};
};

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
        public style: Record<string, string> = {};
        public classList = {add: () => {}, toggle: () => {}};
        public events = new Map<string, () => void>();
        public hidden = false;
        public value = "";
        public textContent = "";
        constructor(public tag: string) {}
        append(...elements: Control[]) { this.children.push(...elements); }
        replaceChildren() { this.children = []; }
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
