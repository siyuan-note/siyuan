import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
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

    it("balances repulsion across different node masses", () => {
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
        const lightDisplacement = -100 - layout.positions[0];
        const heavyDisplacement = layout.positions[2] - 100;
        assert.ok(Math.abs(lightDisplacement - heavyDisplacement * (1 + Math.sqrt(8))) < 0.0001);
    });

    it("pulls isolated nodes inward more strongly", () => {
        const layout = new GraphForceLayout({
            degrees: new Uint32Array([0, 1]),
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
        assert.ok(isolatedDisplacement > connectedDisplacement * 4);
    });
});
