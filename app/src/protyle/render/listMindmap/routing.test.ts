import * as assert from "node:assert/strict";
import test from "node:test";
import {routeMindmapRelation, MindmapRouteBox, MindmapRoutePoint} from "./routing";

const validate = (route: MindmapRoutePoint[], nodes: MindmapRouteBox[]) => {
    assert.ok(route.length >= 2, "a route must exist");
    for (let i = 1; i < route.length; i++) {
        const a = route[i - 1];
        const b = route[i];
        assert.ok(a.x === b.x || a.y === b.y, "segments are orthogonal");
        for (const node of nodes) {
            for (const box of [node, {x: node.x + node.width - 11, y: (node.controlY ?? node.y + node.height) - 11, width: 49, height: 22}]) {
                const intersects = a.x === b.x ? a.x > box.x && a.x < box.x + box.width &&
                    Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height :
                    a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width;
                assert.equal(intersects, false, "route avoids nodes and their controls");
            }
        }
    }
};

test("relations route around intervening nodes in both directions", () => {
    const nodes = [
        {x: 300, y: 100, width: 165, height: 76},
        {x: 300, y: 250, width: 220, height: 48},
        {x: 300, y: 380, width: 180, height: 60},
    ];
    validate(routeMindmapRelation(nodes[2], nodes[0], nodes), nodes);
    validate(routeMindmapRelation(nodes[0], nodes[2], nodes), nodes);
});

test("right-side endpoints remain close to node text while avoiding bottom controls", () => {
    const from = {x: 0, y: 0, width: 120, height: 40};
    const to = {x: 240, y: 0, width: 120, height: 40};
    const route = routeMindmapRelation(from, to, [from, to]);
    validate(route, [from, to]);
    assert.equal(route[0].x - from.x - from.width, 12);
});

test("relations find side ports when vertical gaps are too narrow", () => {
    const nodes = Array.from({length: 8}, (_, i) => ({x: 200, y: i * 60, width: 120 + i * 8, height: 40}));
    validate(routeMindmapRelation(nodes[1], nodes[6], nodes), nodes);
});

test("cross-column routes remain deterministic with mixed node sizes", () => {
    const nodes = [
        {x: 0, y: 140, width: 100, height: 50},
        {x: 180, y: 0, width: 160, height: 60},
        {x: 180, y: 120, width: 180, height: 180},
        {x: 430, y: 50, width: 160, height: 100},
        {x: 430, y: 240, width: 160, height: 60},
    ];
    const route = routeMindmapRelation(nodes[0], nodes[4], nodes);
    validate(route, nodes);
    assert.deepEqual(routeMindmapRelation(nodes[0], nodes[4], nodes), route);
});
