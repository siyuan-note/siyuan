import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {createInitialPositions, normalizeGraphData} from "./core";
import {GraphForceLayout} from "./layoutCore";

const createLayout = () => new GraphForceLayout({
    degrees: new Uint32Array([1, 2, 2, 1]),
    layout: {
        centerStrength: 0.01,
        linkDistance: 100,
        repulsion: 600,
        springStrength: 0.08,
    },
    positions: new Float32Array([-150, 0, -50, 20, 50, -20, 150, 0]),
    sizes: new Float32Array([15, 15, 15, 15]),
    sources: new Uint32Array([0, 1, 2]),
    targets: new Uint32Array([1, 2, 3]),
});

describe("graph force layout", () => {
    it("produces deterministic finite positions", () => {
        const first = createLayout();
        const second = createLayout();
        first.step(80);
        second.step(80);
        assert.deepEqual(first.positions, second.positions);
        first.positions.forEach((value) => assert.ok(Number.isFinite(value)));
    });

    it("keeps pinned nodes fixed and resumes them after release", () => {
        const layout = createLayout();
        layout.pin(1, 25, 35);
        layout.step(20);
        assert.equal(layout.positions[2], 25);
        assert.equal(layout.positions[3], 35);
        layout.release(1);
        layout.step(20);
        assert.notDeepEqual(Array.from(layout.positions.subarray(2, 4)), [25, 35]);
    });

    it("restarts a settled layout while dragging a node", () => {
        const layout = createLayout();
        assert.equal(layout.step(400), true);
        const neighborBefore = Array.from(layout.positions.subarray(2, 4));
        layout.pin(0, -400, 100);
        assert.equal(layout.step(), false);
        layout.step(20);
        assert.deepEqual(Array.from(layout.positions.subarray(0, 2)), [-400, 100]);
        assert.notDeepEqual(Array.from(layout.positions.subarray(2, 4)), neighborBefore);
        layout.release(0);
        layout.step(20);
        assert.notDeepEqual(Array.from(layout.positions.subarray(0, 2)), [-400, 100]);
    });

    it("accepts updated physics options", () => {
        const layout = createLayout();
        layout.step(10);
        layout.setOptions({
            centerStrength: 0.02,
            linkDistance: 200,
            repulsion: 900,
            springStrength: 0.1,
        });
        layout.step(10);
        layout.positions.forEach((value) => assert.ok(Number.isFinite(value)));
    });

    it("applies ForceAtlas2 degree weighting to repulsion", () => {
        const layout = new GraphForceLayout({
            degrees: new Uint32Array([0, 8]),
            layout: {
                centerStrength: 0,
                linkDistance: 100,
                repulsion: 600,
                springStrength: 0,
            },
            positions: new Float32Array([-100, 0, 100, 0]),
            sizes: new Float32Array([15, 15]),
            sources: new Uint32Array(),
            targets: new Uint32Array(),
        });
        layout.step();
        const lowDegreeDisplacement = -100 - layout.positions[0];
        const highDegreeDisplacement = layout.positions[2] - 100;
        assert.ok(Math.abs(highDegreeDisplacement - lowDegreeDisplacement * 9) < 0.0001);
    });

    it("pulls high-degree nodes toward the graph center more strongly", () => {
        const layout = new GraphForceLayout({
            degrees: new Uint32Array([0, 8]),
            layout: {
                centerStrength: 0.01,
                linkDistance: 100,
                repulsion: 0,
                springStrength: 0,
            },
            positions: new Float32Array([100, 0, -100, 0]),
            sizes: new Float32Array([15, 15]),
            sources: new Uint32Array(),
            targets: new Uint32Array(),
        });
        layout.step();
        const isolatedDisplacement = 100 - layout.positions[0];
        const connectedDisplacement = layout.positions[2] + 100;
        assert.ok(Math.abs(connectedDisplacement - isolatedDisplacement * 9) < 0.0001);
    });

    it("uses the legacy straight-edge spring distance", () => {
        const layout = new GraphForceLayout({
            degrees: new Uint32Array([1, 1]),
            layout: {
                centerStrength: 0,
                linkDistance: 100,
                repulsion: 0,
                springStrength: 0.08,
            },
            positions: new Float32Array([-75, 0, 75, 0]),
            sizes: new Float32Array([15, 15]),
            sources: new Uint32Array([0]),
            targets: new Uint32Array([1]),
        });
        layout.step();
        assert.deepEqual(Array.from(layout.positions), [-75, 0, 75, 0]);
    });

    it("keeps disconnected subgraphs in separate regions after settling", () => {
        const nodes = Array.from({length: 12}, (_item, index) => ({
            id: `node-${index.toString().padStart(2, "0")}`,
            box: "box",
            path: `/${index}.sy`,
            type: "NodeDocument",
            size: 15,
            defs: 0,
        }));
        const links = [1, 2, 3, 4, 5].flatMap((target) => [
            {from: nodes[0].id, to: nodes[target].id, ref: true},
            {from: nodes[6].id, to: nodes[target + 6].id, ref: true},
        ]);
        const data = normalizeGraphData(nodes, links, 15);
        const positions = createInitialPositions(data, 100);
        const layout = new GraphForceLayout({
            degrees: data.degrees,
            layout: {
                centerStrength: 0.01,
                linkDistance: 100,
                repulsion: 600,
                springStrength: 0.08,
            },
            positions,
            sizes: data.sizes,
            sources: data.sources,
            targets: data.targets,
        });
        layout.step(320);
        const bounds = data.components.map((component) => {
            const xs = component.nodeIndices.map((index) => layout.positions[index * 2]);
            const ys = component.nodeIndices.map((index) => layout.positions[index * 2 + 1]);
            return {
                minX: Math.min(...xs) - 15,
                maxX: Math.max(...xs) + 15,
                minY: Math.min(...ys) - 15,
                maxY: Math.max(...ys) + 15,
            };
        });
        assert.ok(bounds[0].maxX < bounds[1].minX || bounds[1].maxX < bounds[0].minX ||
            bounds[0].maxY < bounds[1].minY || bounds[1].maxY < bounds[0].minY);
    });

    it("keeps isolated nodes around connected clusters", () => {
        const connectedCount = 20;
        const nodes = Array.from({length: 100}, (_item, index) => ({
            id: `node-${index.toString().padStart(3, "0")}`,
            box: "box",
            path: `/${index}.sy`,
            type: "NodeDocument",
            size: 15,
            defs: 0,
        }));
        const links = Array.from({length: connectedCount - 1}, (_item, index) => ({
            from: nodes[0].id,
            to: nodes[index + 1].id,
            ref: true,
        }));
        const data = normalizeGraphData(nodes, links, 15);
        const layout = new GraphForceLayout({
            degrees: data.degrees,
            layout: {
                centerStrength: 0.01,
                linkDistance: 100,
                repulsion: 600,
                springStrength: 0.08,
            },
            positions: createInitialPositions(data, 100),
            sizes: data.sizes,
            sources: data.sources,
            targets: data.targets,
        });
        layout.step(320);
        const averageRadius = (start: number, end: number) => {
            let radius = 0;
            for (let index = start; index < end; index++) {
                radius += Math.hypot(layout.positions[index * 2], layout.positions[index * 2 + 1]);
            }
            return radius / (end - start);
        };
        const connectedRadius = averageRadius(0, connectedCount);
        const isolatedRadius = averageRadius(connectedCount, nodes.length);
        assert.ok(isolatedRadius > connectedRadius * 1.5, JSON.stringify({connectedRadius, isolatedRadius}));
    });

    it("separates dense communities connected by a single edge", () => {
        const nodes = Array.from({length: 10}, (_item, index) => ({
            id: `community-${index.toString().padStart(2, "0")}`,
            box: "box",
            path: `/${index}.sy`,
            type: "NodeDocument",
            size: 15,
            defs: 0,
        }));
        const links: {from: string, to: string, ref: boolean}[] = [];
        for (const start of [0, 5]) {
            for (let source = start; source < start + 5; source++) {
                for (let target = source + 1; target < start + 5; target++) {
                    links.push({from: nodes[source].id, to: nodes[target].id, ref: true});
                }
            }
        }
        links.push({from: nodes[0].id, to: nodes[5].id, ref: true});
        const data = normalizeGraphData(nodes, links, 15);
        const positions = createInitialPositions(data, 100);
        const layout = new GraphForceLayout({
            degrees: data.degrees,
            layout: {
                centerStrength: 0.01,
                linkDistance: 100,
                repulsion: 600,
                springStrength: 0.08,
            },
            positions,
            sizes: data.sizes,
            sources: data.sources,
            targets: data.targets,
        });
        layout.step(320);
        const getCommunity = (start: number) => {
            let centerX = 0;
            let centerY = 0;
            for (let index = start; index < start + 5; index++) {
                centerX += layout.positions[index * 2];
                centerY += layout.positions[index * 2 + 1];
            }
            centerX /= 5;
            centerY /= 5;
            let radius = 0;
            for (let index = start; index < start + 5; index++) {
                radius = Math.max(radius, Math.hypot(
                    layout.positions[index * 2] - centerX,
                    layout.positions[index * 2 + 1] - centerY,
                ));
            }
            return {centerX, centerY, radius};
        };
        const first = getCommunity(0);
        const second = getCommunity(5);
        const centerDistance = Math.hypot(first.centerX - second.centerX, first.centerY - second.centerY);
        assert.ok(centerDistance > first.radius + second.radius, JSON.stringify({centerDistance, first, second}));
    });
});
