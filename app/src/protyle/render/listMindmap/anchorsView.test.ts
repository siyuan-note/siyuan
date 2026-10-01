import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import * as routing from "./routing";
import type {ListMindmapRelation} from "./model";

// 执行视图实际的拖动和回退方法，指针及元素替身只提供浏览器事件边界。
const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const declaration = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(declaration && isClassDeclaration(declaration));
const names = ["resolveRelationRoute", "calculateRelationRoute", "previewRouteDrag", "canReconnectRelation",
    "pointerMove", "pointerUp", "cancelPointer", "resetRelationAnchors", "resetRelationRoute", "renderRouteControls"];
const methods = declaration.members.filter(item => names.includes(item.name?.getText(source)));
assert.equal(methods.length, names.length);
const compiled = transpileModule(`class View { ${methods.map(item => item.getText(source)).join("\n")} }
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = (overrides: Partial<ListMindmapRelation> = {}) => {
    const relation: ListMindmapRelation = {id: "r", from: "a", to: "b", label: "Keep", arrowDirection: "reverse", ...overrides};
    const changes: {id: string, patch: Partial<ListMindmapRelation>, expected: string}[] = [];
    const sandbox: any = {...routing, cancelAnimationFrame: () => {}, requestAnimationFrame: () => 1};
    runInNewContext(compiled, sandbox);
    const view = new sandbox.View();
    const positions = new Map([
        ["a", {id: "a", x: 0, y: 0, width: 100, height: 40}],
        ["b", {id: "b", x: 300, y: 120, width: 100, height: 40}],
        ["c", {id: "c", x: 300, y: 240, width: 100, height: 40}],
    ]);
    const classList = () => ({toggle: () => {}, remove: () => {}});
    Object.assign(view, {
        model: {metadata: {relations: [relation]}, nodes: new Map([...positions.keys()].map(id => [id, {id}]))},
        positions, relationRoutes: new Map(), fallbackRoutes: new Set(), anchorFallbackRoutes: new Set(),
        nodeElements: new Map([...positions.keys()].map(id => [id, {classList: classList()}])),
        scale: 1, offsetX: 0, offsetY: 0, selectedRelation: "r", routeDragFrame: 0,
        viewport: {classList: classList(), getBoundingClientRect: () => ({left: 0, top: 0})},
        options: {onRelationChange: (id: string, patch: Partial<ListMindmapRelation>, expected: string) =>
            changes.push({id, patch, expected})},
        routingObstacles: () => [...positions.values()], draw: () => {}, refreshLayout: () => {},
        clearDrop: () => {}, setHoveredLine: () => {}, finishThen: (action: () => void) => action(),
        routeHandles: new Map(), routeStatus: {}, label: (key: string) => key,
        getRouteHandle: () => ({style: {}}),
    });
    view.relationRoutes.set("r", view.calculateRelationRoute(relation, positions.get("a"), positions.get("b")));
    const begin = (endpoint: "from" | "to" = "from") => {
        const points = view.relationRoutes.get("r");
        const handle = points[endpoint === "from" ? 0 : points.length - 1];
        view.pointer = {pointerId: 1, startX: handle.x * view.scale, startY: handle.y * view.scale, moved: false,
            relation: {id: "r", endpoint, segment: 0, original: JSON.stringify(relation), points,
                offset: 0, valid: true, targetId: relation[endpoint], handle}};
    };
    const event = (x: number, y: number, pointerType = "mouse") => ({pointerId: 1,
        clientX: x * view.scale, clientY: y * view.scale, pointerType, preventDefault: () => {}});
    return {view, relation, positions, changes, begin, event};
};

test("same-node endpoint drag pins a continuous position and preserves route and arrow identity", () => {
    for (const scale of [.5, 1, 2]) {
        const {view, relation, changes, begin, event} = setup();
        view.scale = scale;
        const original = JSON.stringify(relation);
        begin();
        view.pointerMove(event(27, -2));
        view.previewRouteDrag();
        assert.equal(view.pointer.relation.valid, true);
        assert.deepEqual(JSON.parse(JSON.stringify(view.pointer.relation.anchor)), {side: "top", ratio: .27});
        assert.equal(changes.length, 0);
        view.pointerUp(event(27, -2));
        assert.deepEqual(JSON.parse(JSON.stringify(changes)), [{id: "r", patch: {fromAnchor: {side: "top", ratio: .27}}, expected: original}]);
        assert.equal(JSON.stringify(relation), original, "preview never writes the model");
        assert.equal(view.pointer, undefined);
    }
});

test("reconnection clears only the moved anchor and route while retaining the other endpoint", () => {
    const {view, relation, changes, begin, event} = setup({
        fromAnchor: {side: "top", ratio: .25}, toAnchor: {side: "left", ratio: .3},
    });
    begin();
    view.pointerMove(event(340, 250));
    view.pointerUp(event(340, 250));
    assert.equal(changes.length, 1);
    assert.equal(changes[0].patch.from, "c");
    assert.ok("fromAnchor" in changes[0].patch);
    assert.equal(changes[0].patch.fromAnchor, undefined);
    assert.ok("route" in changes[0].patch);
    assert.ok(!("toAnchor" in changes[0].patch));
    assert.deepEqual(relation.toAnchor, {side: "left", ratio: .3});
});

test("moving an existing anchor preserves its unknown extension fields", () => {
    const {view, changes, begin, event} = setup({fromAnchor: Object.assign({side: "top" as const, ratio: .2},
        {extension: {keep: true}})});
    begin();
    view.pointerMove(event(37, -2));
    view.pointerUp(event(37, -2));
    assert.deepEqual(JSON.parse(JSON.stringify(changes[0].patch.fromAnchor)),
        {side: "top", ratio: .37, extension: {keep: true}});
});

test("dragging through blank space retains the opposite fixed connection in the preview", () => {
    const {view, changes, begin, event} = setup({toAnchor: {side: "top", ratio: .25}});
    begin();
    view.pointerMove(event(180, -100));
    view.previewRouteDrag();
    assert.equal(view.pointer.relation.valid, false);
    const points = view.relationRoutes.get("r");
    assert.deepEqual(points[points.length - 1], {x: 325, y: 117});
    view.pointerUp(event(180, -100));
    assert.equal(changes.length, 0);
});

test("blank drops, blocked new anchors, cancellation and a stale missing relation never save", () => {
    for (const action of ["blank", "blocked", "cancel", "deleted"]) {
        const {view, changes, begin, event} = setup();
        begin();
        // 右下角的折叠和添加按钮属于接入点的避让区域。
        const point = action === "blank" ? [180, 300] : action === "blocked" ? [100, 39] : [25, -2];
        view.pointerMove(event(point[0], point[1]));
        if (action === "cancel") {
            view.cancelPointer();
        } else if (action === "deleted") {
            view.model.metadata.relations = [];
        } else {
            view.previewRouteDrag();
            assert.equal(view.pointer.relation.valid, false);
        }
        view.pointerUp(event(point[0], point[1]));
        assert.equal(changes.length, 0, action);
    }
});

test("existing opposite anchor constraints are not silently discarded during a new drag", () => {
    const {view, changes, begin, event} = setup({toAnchor: {side: "right", ratio: .99}});
    assert.equal(view.anchorFallbackRoutes.has("r"), true);
    begin();
    view.pointerMove(event(25, -2));
    view.previewRouteDrag();
    assert.equal(view.pointer.relation.valid, false);
    view.renderRouteControls();
    assert.equal(view.routeStatus.textContent, "listMindmapAnchorInvalid");
    view.pointerUp(event(25, -2));
    assert.equal(changes.length, 0);
});

test("temporary anchor fallback is visible in readonly views and restores without rewriting metadata", () => {
    const {view, relation, positions} = setup({fromAnchor: {side: "top", ratio: .25}});
    const original = JSON.stringify(relation);
    const from = positions.get("a");
    const to = positions.get("b");
    const saved = view.calculateRelationRoute(relation, from, to);
    assert.equal(saved[0].x, 25);
    const blocker = {id: "blocker", x: 15, y: -30, width: 20, height: 25};
    positions.set("blocker", blocker);
    const fallback = view.calculateRelationRoute(relation, from, to);
    assert.ok(fallback.length >= 2);
    assert.equal(view.anchorFallbackRoutes.has("r"), true);
    view.readOnly = true;
    view.selectedRelation = undefined;
    view.renderRouteControls();
    assert.equal(view.routeStatus.hidden, false);
    assert.equal(view.routeStatus.textContent, "listMindmapAnchorFallback");
    view.options.printLayout = true;
    view.renderRouteControls();
    assert.equal(view.routeStatus.hidden, true);
    assert.deepEqual(view.calculateRelationRoute(relation, from, to), fallback, "printing changes only controls, not routing");
    positions.delete("blocker");
    assert.deepEqual(view.calculateRelationRoute(relation, from, to), saved);
    assert.equal(view.anchorFallbackRoutes.has("r"), false);
    assert.equal(JSON.stringify(relation), original);
});

test("manual-route fallback preserves viable anchor positions and reset actions remain separate", () => {
    const route = {version: 1 as const, points: [{x: 0, y: 0, t: 0}]};
    const {view, relation, positions, changes} = setup({route, fromAnchor: {side: "top", ratio: .25}});
    const result = view.calculateRelationRoute(relation, positions.get("a"), positions.get("b"));
    assert.equal(view.fallbackRoutes.has("r"), true, "a control inside the source cannot be routed");
    assert.equal(view.anchorFallbackRoutes.has("r"), false);
    assert.equal(result[0].x, 25);
    assert.equal(result[0].y, -3);
    view.resetRelationAnchors("r");
    assert.equal(changes.length, 1);
    assert.deepEqual(Object.keys(changes[0].patch), ["fromAnchor", "toAnchor"]);
    assert.equal(changes[0].expected, JSON.stringify(relation));
    view.resetRelationRoute("r");
    assert.deepEqual(Object.keys(changes[1].patch), ["route"]);
    view.readOnly = true;
    view.resetRelationAnchors("r");
    assert.equal(changes.length, 2);
});

test("touch edge tolerance uses screen pixels and actual neighbor hits win over source proximity", () => {
    const {view, positions, begin, event} = setup();
    view.scale = .5;
    positions.set("c", {id: "c", x: 110, y: -20, width: 100, height: 40});
    begin();
    view.pointerMove(event(115, 0, "touch"));
    assert.equal(view.pointer.relation.targetId, "c");
    assert.equal(view.pointer.relation.anchor, undefined);
    view.cancelPointer();
    begin();
    view.pointerMove(event(25, -25, "touch"));
    assert.equal(view.pointer.relation.targetId, "a");
    assert.equal(view.pointer.relation.anchor.side, "top");
    view.cancelPointer();
    begin();
    view.pointerMove(event(25, -25));
    assert.equal(view.pointer.relation.targetId, undefined, "mouse tolerance stays eight screen pixels");
});
