import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    centerGraphCamera,
    createInitialPositions,
    fitGraphCamera,
    getGraphArrowGeometry,
    getGraphArrowLength,
    getDraggedGraphPosition,
    getGraphEdgeOpacity,
    getGraphNodeSize,
    normalizeGraphData,
} from "./core";

const nodes = [
    {id: "a", box: "box", path: "/a.sy", type: "NodeDocument", size: 15, defs: 0},
    {id: "b", box: "box", path: "/b.sy", type: "NodeDocument", size: 15, defs: 4},
];

describe("graph data normalization", () => {
    it("keeps the first node and filters links with missing endpoints", () => {
        const data = normalizeGraphData([
            ...nodes,
            {...nodes[0], type: "NodeParagraph"},
        ], [
            {from: "a", to: "b", ref: true},
            {from: "a", to: "missing", ref: false},
        ], 10);

        assert.equal(data.nodes.length, 2);
        assert.equal(data.nodes[0].type, "NodeDocument");
        assert.equal(data.links.length, 1);
        assert.deepEqual(Array.from(data.sources), [0]);
        assert.deepEqual(Array.from(data.targets), [1]);
        assert.deepEqual(Array.from(data.degrees), [1, 1]);
        assert.deepEqual(data.components.map((component) => component.nodeIndices), [[0, 1]]);
        assert.equal(data.sizes[0], 10);
        assert.equal(data.sizes[1], 30);
    });

    it("creates stable positions and restores known nodes", () => {
        const data = normalizeGraphData(nodes, [], 15);
        const first = createInitialPositions(data, 400);
        const second = createInitialPositions(data, 400);
        assert.deepEqual(second, first);

        const restored = createInitialPositions(data, 400, new Map([["a", [12, 34]]]));
        assert.equal(restored[0], 12);
        assert.equal(restored[1], 34);
    });

    it("normalizes input order deterministically", () => {
        const first = normalizeGraphData(nodes, [{from: "a", to: "b", ref: true}], 15);
        const second = normalizeGraphData(nodes.slice().reverse(), [{from: "a", to: "b", ref: true}], 15);
        assert.deepEqual(second.nodes.map((node) => node.id), first.nodes.map((node) => node.id));
        assert.deepEqual(second.links, first.links);
        assert.deepEqual(createInitialPositions(second, 400), createInitialPositions(first, 400));
    });

    it("packs disconnected components without overlap", () => {
        const data = normalizeGraphData([
            ...nodes,
            {id: "c", box: "box", path: "/c.sy", type: "NodeDocument", size: 15, defs: 0},
            {id: "d", box: "box", path: "/d.sy", type: "NodeDocument", size: 15, defs: 0},
        ], [
            {from: "a", to: "b", ref: true},
            {from: "c", to: "d", ref: true},
        ], 15);
        const positions = createInitialPositions(data, 400);
        assert.equal(data.components.length, 2);
        const firstBounds = {
            minX: Math.min(positions[0], positions[2]) - 15,
            maxX: Math.max(positions[0], positions[2]) + 15,
            minY: Math.min(positions[1], positions[3]) - 15,
            maxY: Math.max(positions[1], positions[3]) + 15,
        };
        const secondBounds = {
            minX: Math.min(positions[4], positions[6]) - 15,
            maxX: Math.max(positions[4], positions[6]) + 15,
            minY: Math.min(positions[5], positions[7]) - 15,
            maxY: Math.max(positions[5], positions[7]) + 15,
        };
        assert.ok(firstBounds.maxX < secondBounds.minX || secondBounds.maxX < firstBounds.minX ||
            firstBounds.maxY < secondBounds.minY || secondBounds.maxY < firstBounds.minY);
    });

    it("scatters isolated nodes radially without forming rows", () => {
        const isolatedNodes = Array.from({length: 128}, (_item, index) => ({
            id: `isolated-${index.toString().padStart(3, "0")}`,
            box: "box",
            path: `/${index}.sy`,
            type: "NodeDocument",
            size: 15,
            defs: 0,
        }));
        const data = normalizeGraphData(isolatedNodes, [], 15);
        const positions = createInitialPositions(data, 100);
        const uniqueY = new Set<number>();
        for (let index = 0; index < isolatedNodes.length; index++) {
            uniqueY.add(positions[index * 2 + 1]);
        }
        assert.ok(uniqueY.size > isolatedNodes.length / 2);
    });

    it("fits positions into the available viewport", () => {
        const camera = fitGraphCamera(new Float32Array([-100, 0, 100, 0]), new Float32Array([10, 10]), 400, 200);
        assert.ok(camera.scale > 0);
        assert.equal(camera.x, 200);
        assert.equal(camera.y, 100);
    });

    it("centers positions after resizing without changing the scale", () => {
        const camera = centerGraphCamera(
            new Float32Array([0, 0, 200, 100]),
            new Float32Array([10, 20]),
            600,
            300,
            1.5,
        );
        assert.deepEqual(camera, {scale: 1.5, x: 142.5, y: 67.5});
    });

    it("keeps the pointer grab offset while dragging", () => {
        const position = getDraggedGraphPosition(80, 100, {scale: 2, x: 20, y: 40}, 5, -3);
        assert.deepEqual(position, {x: 35, y: 27});
    });

    it("emphasizes highlighted edges without exceeding valid opacity", () => {
        assert.equal(getGraphEdgeOpacity(0.36, false), 0.36);
        assert.ok(Math.abs(getGraphEdgeOpacity(0.36, true) - 0.9) < Number.EPSILON);
        assert.equal(getGraphEdgeOpacity(0.8, true), 1);
        assert.equal(getGraphEdgeOpacity(-0.5, false), 0);
    });

    it("places arrows against the target edge and ends lines at the arrow base", () => {
        const arrowLength = getGraphArrowLength(2, 1);
        const arrow = getGraphArrowGeometry(0, 0, 100, 0, 20, arrowLength, 4);
        assert.equal(arrowLength, 7);
        assert.deepEqual(arrow, {
            baseX: 73,
            baseY: 0,
            directionX: 1,
            directionY: 0,
            lineEndX: 71,
            lineEndY: 0,
            tipX: 80,
            tipY: 0,
        });
    });

    it("scales referenced nodes logarithmically", () => {
        assert.equal(getGraphNodeSize(15, 0), 15);
        assert.equal(getGraphNodeSize(15, 1), 15);
        assert.equal(getGraphNodeSize(15, 8), 60);
    });
});
