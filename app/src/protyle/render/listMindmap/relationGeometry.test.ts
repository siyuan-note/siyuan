import * as assert from "node:assert/strict";
import test from "node:test";
import {buildMindmapRelationPath, getMindmapRelationDash, getMindmapRelationPathStyle,
    getMindmapRelationStrokeStyle, routeFreeMindmapRelation, sampleMindmapRelation} from "./relationGeometry";
import {encodeMindmapRoute, moveMindmapRouteSegment, routeMindmapRelation} from "./routing";
import {getMindmapRelationMenuItems} from "./relationMenu";
import type {ListMindmapRelation} from "./model";

const buildGlobals = ["SIYUAN_VERSION", "NODE_ENV"].map(name => ({
    name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
}));
buildGlobals.forEach(({name}) => Object.defineProperty(globalThis, name, {configurable: true, value: "test"}));
const {parseListMindmapMetadata}: typeof import("./model") = require("./model");
buildGlobals.forEach(({name, descriptor}) => {
    if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
    } else {
        Reflect.deleteProperty(globalThis, name);
    }
});

const from = {x: 0, y: 0, width: 100, height: 40};
const to = {x: 400, y: 0, width: 100, height: 40};
const relation: ListMindmapRelation = {id: "r", from: "a", to: "b", label: "Keep", dash: false};

test("legacy relationships retain avoidance and solid or dashed appearance", () => {
    for (const dash of [undefined, false, true]) {
        const parsed = parseListMindmapMetadata(JSON.stringify({version: 1, nodes: {}, relations: [{...relation, dash}]}));
        assert.equal(getMindmapRelationPathStyle(parsed.relations[0]), "auto");
        assert.equal(getMindmapRelationStrokeStyle(parsed.relations[0]), dash === false ? "solid" : "dashed");
    }
});

test("free paths cross intermediate nodes while automatic paths detour", () => {
    const obstacle = {x: 180, y: -40, width: 100, height: 120};
    const automatic = routeMindmapRelation(from, to, [from, to, obstacle]);
    assert.ok(automatic.some(point => point.y < obstacle.y || point.y > obstacle.y + obstacle.height));
    for (const pathStyle of ["straight", "bezier", "rounded"] as const) {
        const points = routeFreeMindmapRelation(from, to, {...relation, pathStyle});
        assert.ok(points.every(point => point.y === 20));
        assert.deepEqual(points[0], {x: 103, y: 20});
        assert.deepEqual(points[points.length - 1], {x: 397, y: 20});
    }
});

test("curve offsets follow endpoint translation and fixed anchors follow node resizing", () => {
    const configured: ListMindmapRelation = {...relation, pathStyle: "bezier", fromAnchor: {side: "top", ratio: .25},
        toAnchor: {side: "bottom", ratio: .75}, curve: {version: 1, from: {x: 20, y: -80}, to: {x: -40, y: 90}}};
    const points = routeFreeMindmapRelation(from, to, configured);
    const moved = routeFreeMindmapRelation({...from, x: 30, y: 60}, {...to, x: 430, y: 60}, configured);
    assert.deepEqual(moved, points.map(point => ({x: point.x + 30, y: point.y + 60})));
    const resized = routeFreeMindmapRelation({...from, width: 200}, to, configured);
    assert.equal(resized[0].x, 50);
    assert.equal(resized[1].x - resized[0].x, 20);
    assert.equal(resized[1].y - resized[0].y, -80);
    const sampled = sampleMindmapRelation(points, "bezier");
    assert.deepEqual(sampled[0], points[0]);
    assert.deepEqual(sampled[32], points[3]);
    assert.ok(sampled.some(point => point.y < 0));
});

test("rounded paths remain orthogonal across all anchor sides and saved segment movement", () => {
    for (const a of ["left", "right", "top", "bottom"] as const) {
        for (const b of ["left", "right", "top", "bottom"] as const) {
            const configured: ListMindmapRelation = {...relation, pathStyle: "rounded",
                fromAnchor: {side: a, ratio: .3}, toAnchor: {side: b, ratio: .7}};
            const points = routeFreeMindmapRelation(from, {...to, y: 100}, configured);
            assert.ok(points.length >= 2);
            points.slice(1).forEach((point, i) => assert.ok(point.x === points[i].x || point.y === points[i].y));
            const candidate = moveMindmapRouteSegment(points, 0, -50);
            if (candidate.length < 3) {
                continue;
            }
            const freeRoute = encodeMindmapRoute(candidate, from, {...to, y: 100});
            const adjusted = routeFreeMindmapRelation(from, {...to, y: 100}, {...configured, freeRoute});
            assert.notDeepEqual(adjusted, points);
            adjusted.slice(1).forEach((point, i) => assert.ok(point.x === adjusted[i].x || point.y === adjusted[i].y));
        }
    }
});

test("path construction retains cubic geometry for drawing and hit testing", () => {
    const points = routeFreeMindmapRelation(from, {...to, y: 150}, {...relation, pathStyle: "bezier"});
    const commands: unknown[][] = [];
    const path = {moveTo: (...args: number[]) => commands.push(["move", ...args]),
        lineTo: (...args: number[]) => commands.push(["line", ...args]),
        bezierCurveTo: (...args: number[]) => commands.push(["cubic", ...args]),
        quadraticCurveTo: (...args: number[]) => commands.push(["quadratic", ...args])};
    buildMindmapRelationPath(points, "bezier", () => path);
    assert.deepEqual(commands.map(command => command[0]), ["move", "cubic"]);
    assert.deepEqual(commands[1].slice(1), points.slice(1).flatMap(point => [point.x, point.y]));
});

test("line patterns override legacy dash without changing its stored type", () => {
    assert.deepEqual(getMindmapRelationDash({...relation, strokeStyle: "solid"}, 2), []);
    assert.deepEqual(getMindmapRelationDash({...relation, strokeStyle: "dashed"}, 2), [5, 4]);
    assert.deepEqual(getMindmapRelationDash({...relation, strokeStyle: "long-dashed"}, 2), [12, 6]);
    assert.deepEqual(getMindmapRelationDash({...relation, strokeStyle: "dotted"}, 2), [0, 5]);
});

test("geometry metadata preserves independent configurations and rejects unsupported or corrupt shapes", () => {
    const data = {version: 2, nodes: {}, relations: [{...relation, pathStyle: "bezier", strokeStyle: "dotted",
        curve: {version: 1, from: {x: 30, y: -40}, to: {x: -20, y: 50}, extension: "keep"},
        route: {version: 1, points: [{x: 5, y: 10, t: .5}]},
        freeRoute: {version: 1, points: [{x: -5, y: -10, t: .5}]}}]};
    assert.deepEqual(parseListMindmapMetadata(JSON.stringify(data)), data);
    const invalid: Record<string, unknown>[] = [{pathStyle: "future"}, {strokeStyle: null}, {curve: null},
        {curve: {version: 2, from: {x: 0, y: 0}, to: {x: 0, y: 0}}},
        {curve: {version: 1, from: {x: 0, y: 0}, to: {x: 1e6 + 1, y: 0}}},
        {freeRoute: {version: 1, points: []}}, {freeRoute: {version: 2, points: [{x: 0, y: 0, t: .5}]}}];
    for (const patch of invalid) {
        assert.throws(() => parseListMindmapMetadata(JSON.stringify({...data, relations: [{...data.relations[0], ...patch}]})), /metadata/);
    }
});

test("relationship menus use checked submenus and change only the chosen property", () => {
    const changes: Partial<ListMindmapRelation>[] = [];
    const labels = new Proxy({}, {get: (_target, key) => String(key)});
    const items = getMindmapRelationMenuItems(relation, patch => changes.push(patch), labels);
    assert.deepEqual(items.map(item => item.id), ["relationPath", "relationStroke"]);
    assert.deepEqual(items.map(item => item.submenu.filter(child => child.checked).map(child => child.id)), [["auto"], ["solid"]]);
    items[0].submenu.find(item => item.id === "bezier").click(undefined, undefined);
    items[1].submenu.find(item => item.id === "dotted").click(undefined, undefined);
    assert.deepEqual(changes, [{pathStyle: "bezier"}, {strokeStyle: "dotted"}]);
});
