import * as assert from "node:assert/strict";
import test from "node:test";
import {encodeMindmapRoute, getMindmapRelationAnchorPoint, MindmapRelationAnchor, MindmapRouteBox, MindmapRoutePoint,
    projectMindmapRelationAnchor, routeManualMindmapRelation, routeMindmapRelation} from "./routing";

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

const sides: MindmapRelationAnchor["side"][] = ["left", "right", "top", "bottom"];
const validate = (route: MindmapRoutePoint[], nodes: MindmapRouteBox[]) => {
    assert.ok(route.length >= 2, "a route must exist");
    for (let i = 1; i < route.length; i++) {
        const a = route[i - 1];
        const b = route[i];
        assert.ok(a.x === b.x || a.y === b.y, "segments are orthogonal");
        for (const node of nodes) {
            for (const box of [node, {x: node.x + node.width - 19,
                y: (node.controlY ?? node.y + node.height) - 15, width: 80, height: 30}]) {
                const intersects = a.x === b.x ? a.x > box.x && a.x < box.x + box.width &&
                    Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height :
                    a.y > box.y && a.y < box.y + box.height &&
                    Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width;
                assert.equal(intersects, false, "route avoids nodes and their controls");
            }
        }
    }
};

const validateAnchor = (route: MindmapRoutePoint[], node: MindmapRouteBox, anchor: MindmapRelationAnchor) => {
    assert.deepEqual(route[0], getMindmapRelationAnchorPoint(node, anchor, 3));
    const [point, next] = route;
    assert.ok(anchor.side === "left" ? next.x < point.x && next.y === point.y :
        anchor.side === "right" ? next.x > point.x && next.y === point.y :
            anchor.side === "top" ? next.y < point.y && next.x === point.x :
                next.y > point.y && next.x === point.x, "anchor retains its outward normal");
};

test("anchor projection is continuous along four edges and clamps beyond corners", () => {
    const node = {x: 20, y: 40, width: 160, height: 80};
    for (const side of sides) {
        for (const ratio of [0, .137, .5, .923, 1]) {
            const anchor = {side, ratio};
            const point = getMindmapRelationAnchorPoint(node, anchor, 17);
            assert.deepEqual(projectMindmapRelationAnchor(node, point, anchor), anchor);
            assert.deepEqual(projectMindmapRelationAnchor(node, getMindmapRelationAnchorPoint(node, anchor), anchor), anchor);
        }
    }
    assert.deepEqual(projectMindmapRelationAnchor(node, {x: -100, y: -100}, {side: "top", ratio: .5}),
        {side: "top", ratio: 0});
    assert.deepEqual(projectMindmapRelationAnchor(node, {x: -100, y: -100}, {side: "left", ratio: .5}),
        {side: "left", ratio: 0});
    assert.deepEqual(projectMindmapRelationAnchor(node, {x: 200, y: 150}, {side: "bottom", ratio: .5}),
        {side: "bottom", ratio: 1});
    assert.deepEqual(projectMindmapRelationAnchor(node, {x: 60, y: 80}, {side: "left", ratio: .5}),
        {side: "left", ratio: .5}, "interior ties retain the previous side");
});

test("fixed anchors cover every edge, including corners, and reverse with their endpoint boxes", () => {
    const nodes = [{x: 0, y: 0, width: 100, height: 80, controlY: -1000},
        {x: 320, y: 220, width: 120, height: 60, controlY: -1000}];
    for (const fromSide of sides) {
        for (const toSide of sides) {
            for (const ratio of [0, .137, .5, .923, 1]) {
                const fromAnchor = {side: fromSide, ratio};
                const toAnchor = {side: toSide, ratio: 1 - ratio};
                const anchors = {fromAnchor, toAnchor};
                const route = routeMindmapRelation(nodes[0], nodes[1], nodes, 12, anchors);
                validate(route, nodes);
                validateAnchor(route, nodes[0], fromAnchor);
                validateAnchor([...route].reverse(), nodes[1], toAnchor);
                assert.deepEqual(routeMindmapRelation(nodes[1], nodes[0], nodes, 12,
                    {fromAnchor: toAnchor, toAnchor: fromAnchor}), [...route].reverse());
            }
        }
    }
});

test("one fixed endpoint preserves automatic choice at the other and exact pointer previews", () => {
    const nodes = [{x: 0, y: 0, width: 100, height: 80}, {x: 320, y: 220, width: 120, height: 60}];
    const fromAnchor: MindmapRelationAnchor = {side: "left", ratio: .73};
    const route = routeMindmapRelation(nodes[0], nodes[1], nodes, 12, {fromAnchor});
    validate(route, nodes);
    validateAnchor(route, nodes[0], fromAnchor);
    const toAnchor: MindmapRelationAnchor = {side: "top", ratio: .27};
    const endOnly = routeMindmapRelation(nodes[0], nodes[1], nodes, 12, {toAnchor});
    validate(endOnly, nodes);
    validateAnchor([...endOnly].reverse(), nodes[1], toAnchor);
    const pointer = {x: 280, y: -120, width: 0, height: 0};
    const preview = routeMindmapRelation(nodes[0], pointer, nodes, 12, {fromAnchor});
    validate(preview, nodes);
    validateAnchor(preview, nodes[0], fromAnchor);
    assert.deepEqual(preview[preview.length - 1], {x: pointer.x, y: pointer.y});
});

test("anchors translate and resize proportionally without changing their stored ratios", () => {
    const nodes = [{x: 0, y: 0, width: 100, height: 80}, {x: 320, y: 220, width: 120, height: 60}];
    const anchors = {fromAnchor: {side: "left", ratio: .37}, toAnchor: {side: "top", ratio: .63}} as const;
    const snapshot = JSON.stringify(anchors);
    const route = routeMindmapRelation(nodes[0], nodes[1], nodes, 12, anchors);
    const translated = nodes.map(node => ({...node, x: node.x + 157, y: node.y - 83}));
    const moved = routeMindmapRelation(translated[0], translated[1], translated, 12, anchors);
    assert.equal(moved.length, route.length);
    moved.forEach((point, index) => {
        assert.ok(Math.abs(point.x - route[index].x - 157) < 1e-6);
        assert.ok(Math.abs(point.y - route[index].y + 83) < 1e-6);
    });
    const resized = [{...nodes[0], width: 210, height: 160}, {...nodes[1], width: 240, height: 120}];
    const next = routeMindmapRelation(resized[0], resized[1], resized, 12, anchors);
    validate(next, resized);
    validateAnchor(next, resized[0], anchors.fromAnchor);
    validateAnchor([...next].reverse(), resized[1], anchors.toAnchor);
    assert.equal(JSON.stringify(anchors), snapshot);
});

test("strict anchors reject control and node collisions including the attachment escape gap", () => {
    const from = {x: 0, y: 0, width: 100, height: 80, controlY: 11};
    const to = {x: 320, y: -180, width: 100, height: 80};
    const fromAnchor: MindmapRelationAnchor = {side: "top", ratio: .9};
    const nodes = [from, to];
    assert.ok(routeMindmapRelation(from, to, nodes).length, "automatic ports can avoid the blocked attachment");
    assert.deepEqual(routeMindmapRelation(from, to, nodes, 12, {fromAnchor}), [],
        "the search port is outside controls but the final 3px attachment is inside");
    assert.deepEqual(routeMindmapRelation(to, from, nodes, 12, {toAnchor: fromAnchor}), []);
    const borderBlocked = {...from, controlY: 14};
    assert.deepEqual(routeMindmapRelation(borderBlocked, to, [borderBlocked, to], 12, {fromAnchor}), [],
        "the node-border-to-attachment gap also must be clear");
    const clear = {...from, controlY: 80};
    const blocker = {x: 89, y: -2, width: 2, height: 1, controlY: -1000};
    assert.deepEqual(routeMindmapRelation(clear, to, [clear, to, blocker], 12, {fromAnchor}), []);
    assert.deepEqual(routeMindmapRelation(clear, to, [clear, to], 12,
        {fromAnchor: {side: "bottom", ratio: 1}}), [], "bottom-right corner intersects the node controls");
    const restored = routeMindmapRelation(clear, to, [clear, to], 12, {fromAnchor});
    validate(restored, [clear, to]);
    validateAnchor(restored, clear, fromAnchor);
});

test("manual routing constrains only the endpoints and retains their outward normals", () => {
    const nodes = [{x: 0, y: 0, width: 100, height: 80}, {x: 320, y: 220, width: 120, height: 60}];
    const anchors = {fromAnchor: {side: "left", ratio: .3}, toAnchor: {side: "top", ratio: .4}} as const;
    const points = [getMindmapRelationAnchorPoint(nodes[0], anchors.fromAnchor, 3),
        {x: -60, y: 24}, {x: -60, y: -90}, {x: 368, y: -90},
        getMindmapRelationAnchorPoint(nodes[1], anchors.toAnchor, 3)];
    const saved = encodeMindmapRoute(points, nodes[0], nodes[1]);
    const snapshot = JSON.stringify(saved);
    const route = routeManualMindmapRelation(nodes[0], nodes[1], nodes, saved, anchors);
    validate(route, nodes);
    validateAnchor(route, nodes[0], anchors.fromAnchor);
    validateAnchor([...route].reverse(), nodes[1], anchors.toAnchor);
    assert.ok(route.some(point => point.y === -90));
    const translated = nodes.map(node => ({...node, x: node.x + 50, y: node.y + 90}));
    const moved = routeManualMindmapRelation(translated[0], translated[1], translated, saved, anchors);
    validate(moved, translated);
    validateAnchor(moved, translated[0], anchors.fromAnchor);
    validateAnchor([...moved].reverse(), translated[1], anchors.toAnchor);
    const resized = [{...nodes[0], height: 120}, {...nodes[1], width: 200}];
    const next = routeManualMindmapRelation(resized[0], resized[1], resized, saved, anchors);
    validate(next, resized);
    validateAnchor(next, resized[0], anchors.fromAnchor);
    validateAnchor([...next].reverse(), resized[1], anchors.toAnchor);
    const blocker = {x: -65, y: -95, width: 10, height: 10};
    assert.deepEqual(routeManualMindmapRelation(nodes[0], nodes[1], [...nodes, blocker], saved, anchors), []);
    assert.equal(JSON.stringify(saved), snapshot, "failed routing does not modify saved constraints");
});

test("optional relation anchors preserve extension fields and reject malformed metadata", () => {
    const base = {version: 1, nodes: {}, relations: [{id: "r", from: "a", to: "b", label: ""}]};
    const original = JSON.stringify(base);
    assert.equal(JSON.stringify(parseListMindmapMetadata(original)), original);
    for (const key of ["fromAnchor", "toAnchor"]) {
        for (const side of sides) {
            for (const ratio of [0, .317, 1]) {
                const value = JSON.stringify({...base, relations: [{...base.relations[0],
                    [key]: {side, ratio, extension: {keep: true}}}]});
                assert.equal(JSON.stringify(parseListMindmapMetadata(value)), value);
            }
        }
        for (const anchor of [null, [], {}, "left", {side: "center", ratio: .5}, {side: ["left"], ratio: .5},
            {side: "left"}, {ratio: .5}, {side: "left", ratio: null}, {side: "left", ratio: "0.5"},
            {side: "left", ratio: -.001}, {side: "left", ratio: 1.001}]) {
            const value = JSON.stringify({...base, relations: [{...base.relations[0], [key]: anchor}]});
            assert.throws(() => parseListMindmapMetadata(value), /Invalid list mindmap metadata/);
        }
        const infinite = '{"version":1,"nodes":{},"relations":[{"id":"r","from":"a","to":"b","label":"",' +
            '"' + key + '":{"side":"left","ratio":1e999}}]}';
        assert.throws(() => parseListMindmapMetadata(infinite), /Invalid list mindmap metadata/);
    }
});
