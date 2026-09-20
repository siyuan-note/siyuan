import * as assert from "node:assert/strict";
import test from "node:test";
import {routeMindmapRelation, routeManualMindmapRelation, encodeMindmapRoute, moveMindmapRouteSegment, adjustMindmapRoute,
    MindmapRouteBox, MindmapRoutePoint} from "./routing";

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

const validateDirection = (route: MindmapRoutePoint[], from: MindmapRouteBox, to: MindmapRouteBox) => {
    const outward = (port: MindmapRoutePoint, next: MindmapRoutePoint, node: MindmapRouteBox) => {
        if (port.x < node.x) {
            assert.ok(next.x < port.x && next.y === port.y);
        } else if (port.x > node.x + node.width) {
            assert.ok(next.x > port.x && next.y === port.y);
        } else if (port.y < node.y) {
            assert.ok(next.y < port.y && next.x === port.x);
        } else {
            assert.ok(next.y > port.y && next.x === port.x);
        }
    };
    outward(route[0], route[1], from);
    outward(route[route.length - 1], route[route.length - 2], to);
};

test("dragging a straight relation preserves arrow direction and follows endpoint translation", () => {
    for (const vertical of [false, true]) {
        const nodes = [{x: 0, y: 0, width: 100, height: 40},
            {x: vertical ? 0 : 300, y: vertical ? 200 : 0, width: 100, height: 40}];
        const automatic = routeMindmapRelation(nodes[0], nodes[1], nodes);
        assert.equal(automatic.length, 2);
        const moved = moveMindmapRouteSegment(automatic, 0, -60);
        const saved = encodeMindmapRoute(moved, nodes[0], nodes[1]);
        const routed = routeManualMindmapRelation(nodes[0], nodes[1], nodes, saved);
        validate(routed, nodes);
        validateDirection(routed, nodes[0], nodes[1]);
        assert.notDeepEqual(routed, automatic);
        assert.ok(routed.some(point => vertical ? point.x === automatic[0].x - 60 : point.y === automatic[0].y - 60));
        const axis = vertical ? "x" : "y";
        const segment = routed.findIndex((point, index) => point[axis] === automatic[0][axis] - 60 &&
            routed[index + 1]?.[axis] === point[axis]);
        const returned = adjustMindmapRoute(routed, segment, 60, nodes[0], nodes[1], saved);
        assert.deepEqual(routeManualMindmapRelation(nodes[0], nodes[1], nodes, returned), automatic,
            "dragging either orientation back restores the straight path");
        const translated = nodes.map(node => ({...node, x: node.x + 57, y: node.y + 83}));
        const next = routeManualMindmapRelation(translated[0], translated[1], translated, saved);
        validate(next, translated);
        assert.equal(next.length, routed.length);
        next.forEach((point, index) => {
            assert.ok(Math.abs(point.x - routed[index].x - 57) < .001);
            assert.ok(Math.abs(point.y - routed[index].y - 83) < .001);
        });
        const resized = [nodes[0], {...nodes[1], x: nodes[1].x + 150, y: nodes[1].y + 120, width: 160}];
        const afterResize = routeManualMindmapRelation(resized[0], resized[1], resized, saved);
        validate(afterResize, resized);
        validateDirection(afterResize, resized[0], resized[1]);
        assert.deepEqual(routeMindmapRelation(nodes[0], nodes[1], nodes), automatic,
            "removing the manual route restores the automatic route");
    }
});

test("manual paths avoid obstacles and retain their configuration when a control is blocked", () => {
    const nodes = [{x: 0, y: 0, width: 100, height: 40}, {x: 600, y: 0, width: 100, height: 40}];
    const automatic = routeMindmapRelation(nodes[0], nodes[1], nodes);
    const moved = moveMindmapRouteSegment(automatic, 0, -80);
    const saved = encodeMindmapRoute(moved, nodes[0], nodes[1]);
    const snapshot = JSON.stringify(saved);
    const obstacle = {x: 335, y: -100, width: 30, height: 40};
    validate(routeManualMindmapRelation(nodes[0], nodes[1], [...nodes, obstacle], saved), [...nodes, obstacle]);
    const blocked = {...obstacle, x: moved[1].x - 10, y: moved[1].y - 10};
    assert.deepEqual(routeManualMindmapRelation(nodes[0], nodes[1], [...nodes, blocked], saved), []);
    assert.equal(JSON.stringify(saved), snapshot, "fallback does not delete manual configuration");
    validate(routeManualMindmapRelation(nodes[0], nodes[1], nodes, saved), nodes);
});

test("an outward drag can return through the generated endpoint bends", () => {
    const nodes = [
        {x: 300, y: 40, width: 110, height: 40},
        {x: 300, y: 220, width: 110, height: 40},
        {x: 470, y: 0, width: 120, height: 40},
        {x: 470, y: 100, width: 220, height: 40},
    ];
    const automatic = routeMindmapRelation(nodes[0], nodes[1], nodes);
    assert.equal(automatic.length, 2);
    for (const savedBends of [false, true]) {
        let route = encodeMindmapRoute(moveMindmapRouteSegment(automatic, 0, 500), nodes[0], nodes[1]);
        let points = routeManualMindmapRelation(nodes[0], nodes[1], nodes, route);
        validate(points, nodes);
        if (savedBends) {
            route = encodeMindmapRoute(points, nodes[0], nodes[1]);
        }
        let column = automatic[0].x + 500;
        for (const x of [800, 440, 400, automatic[0].x]) {
            const segment = points.slice(1).map((point, index) => ({point, index, previous: points[index]}))
                .find(item => item.point.x === column && item.previous.x === column);
            assert.ok(segment);
            route = adjustMindmapRoute(points, segment.index, x - segment.point.x, nodes[0], nodes[1], route);
            points = routeManualMindmapRelation(nodes[0], nodes[1], nodes, route);
            column = x;
            assert.ok(points.length, JSON.stringify({savedBends, x, route}));
            validate(points, nodes);
            validateDirection(points, nodes[0], nodes[1]);
        }
        assert.deepEqual(points, automatic);
    }
});

test("mixed widths keep arrows facing nodes", () => {
    for (const width of [64, 130, 260]) {
        const nodes = [
            {x: 0, y: 56, width: 88, height: 32, controlY: 72},
            {x: 128, y: 0, width: 64, height: 32},
            {x: 128, y: 56, width, height: 32},
            {x: 128, y: 112, width: 64, height: 32},
            {x: 168 + width, y: 56, width: 64, height: 32},
        ];
        for (const [from, to] of [[1, 2], [1, 4], [2, 4], [2, 3]]) {
            const route = routeMindmapRelation(nodes[from], nodes[to], nodes);
            validate(route, nodes);
            validateDirection(route, nodes[from], nodes[to]);
            if (to === 3) {
                assert.equal(route.length, 2, "wide sibling connects vertically to the narrower sibling");
            }
        }
        for (const from of nodes) {
            for (const to of nodes) {
                if (from !== to) {
                    const route = routeMindmapRelation(from, to, nodes);
                    validate(route, nodes);
                    validateDirection(route, from, to);
                    assert.deepEqual(routeMindmapRelation(to, from, nodes), [...route].reverse(),
                        "opposite connections share the same geometry");
                }
            }
        }
    }
});

test("routing is independent of other connections and reverse arrows retain their approach direction", () => {
    const nodes = [
        {x: 0, y: 0, width: 100, height: 40},
        {x: 260, y: 0, width: 100, height: 40},
        {x: 260, y: 100, width: 100, height: 40},
    ];
    const first = routeMindmapRelation(nodes[0], nodes[1], nodes);
    const second = routeMindmapRelation(nodes[0], nodes[2], nodes);
    const reverse = routeMindmapRelation(nodes[1], nodes[0], nodes);
    validate(second, nodes);
    validate(reverse, nodes);
    validateDirection(second, nodes[0], nodes[2]);
    validateDirection(reverse, nodes[1], nodes[0]);
    assert.deepEqual(routeMindmapRelation(nodes[0], nodes[1], nodes), first,
        "computing other connections does not change the existing route");
    assert.deepEqual(routeMindmapRelation(nodes[0], nodes[2], nodes), second,
        "routing remains independent of previously computed connections");
});

test("multiline parents connect directly to short children without tiny doglegs", () => {
    for (const height of [80, 128, 200]) {
        const nodes = [
            {x: 128, y: 0, width: 64, height: 32},
            {x: 128, y: 56, width: 160, height},
            {x: 328, y: 56 + (height - 32) / 2, width: 64, height: 32},
            {x: 128, y: 80 + height, width: 64, height: 32},
        ];
        for (const [from, to] of [[1, 2], [2, 1]]) {
            const route = routeMindmapRelation(nodes[from], nodes[to], nodes);
            validate(route, nodes);
            validateDirection(route, nodes[from], nodes[to]);
            assert.equal(route.length, 2, "different node heights share a horizontal port level");
            assert.equal(route[0].y, route[1].y);
            assert.equal(route[0].y, nodes[2].y + nodes[2].height / 2,
                "horizontal connections meet the short node at its vertical center");
        }
    }
});

test("vertically adjacent nodes connect when their clearance ports coincide", () => {
    const nodes = [
        {x: 200, y: 0, width: 64, height: 38},
        {x: 200, y: 62, width: 64, height: 38},
    ];
    validate(routeMindmapRelation(nodes[0], nodes[1], nodes), nodes);
    validate(routeMindmapRelation(nodes[1], nodes[0], nodes), nodes);
});

test("adjacent siblings remain connectable between a parent and a child column", () => {
    const nodes = [
        {x: 0, y: 62, width: 88, height: 38, controlY: 81},
        {x: 128, y: 0, width: 64, height: 38},
        {x: 128, y: 62, width: 64, height: 38},
        {x: 128, y: 124, width: 64, height: 38},
        {x: 232, y: 62, width: 64, height: 38},
    ];
    for (const from of nodes) {
        for (const to of nodes) {
            if (from !== to) {
                validate(routeMindmapRelation(from, to, nodes), nodes);
            }
        }
    }
});

test("connection preview routes to the exact pointer position around obstacles", () => {
    const from = {x: 0, y: 0, width: 100, height: 40};
    const obstacle = {x: 160, y: 0, width: 100, height: 80};
    const pointer = {x: 340, y: 30, width: 0, height: 0};
    const route = routeMindmapRelation(from, pointer, [from, obstacle]);
    validate(route, [from, obstacle]);
    assert.deepEqual(route[route.length - 1], {x: pointer.x, y: pointer.y});
});

test("compact sibling connections prefer the gap instead of an outer detour", () => {
    for (const height of [32, 38, 46]) {
        const nodes = [
            {x: 0, y: height + 24, width: 88, height, controlY: height * 1.5 + 24},
            {x: 128, y: 0, width: 64, height},
            {x: 128, y: height + 24, width: 64, height},
            {x: 128, y: 2 * (height + 24), width: 64, height},
            {x: 232, y: height + 24, width: 64, height},
        ];
        for (const [from, to] of [[1, 2], [2, 1], [2, 3], [3, 2]]) {
            const route = routeMindmapRelation(nodes[from], nodes[to], nodes);
            validate(route, nodes);
            assert.equal(route.length, 2, "siblings use the direct vertical gap");
            assert.equal(route[0].x, nodes[from].x + nodes[from].width / 2);
            assert.equal(Math.abs(route[1].y - route[0].y), 18,
                "short connections leave enough space for two readable arrows and a gap");
            assert.deepEqual(routeMindmapRelation(nodes[from], nodes[to], nodes), route);
        }
        for (const [from, to] of [[2, 4], [4, 2]]) {
            const route = routeMindmapRelation(nodes[from], nodes[to], nodes);
            validate(route, nodes);
            assert.equal(route.length, 2, "aligned parent and child use the direct horizontal gap");
            assert.equal(route[0].y, route[1].y);
        }
        const diagonal = routeMindmapRelation(nodes[1], nodes[4], nodes);
        validate(diagonal, nodes);
        assert.equal(diagonal.length, 3, "cross-column connection only needs one bend");
        assert.equal(diagonal[0].y, nodes[1].y + nodes[1].height / 2,
            "side endpoints are vertically centered");
        assert.equal(diagonal[diagonal.length - 1].x, nodes[4].x + nodes[4].width / 2,
            "top endpoints are horizontally centered");
    }
});

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
    assert.equal(route[0].x - from.x - from.width, 3);
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
