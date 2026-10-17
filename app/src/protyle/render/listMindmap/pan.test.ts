import {test} from "node:test";
import * as assert from "node:assert/strict";
import {clampMindmapPanOffset, clampMindmapPanPosition} from "./pan";

test("mind map pan keeps content visible at both boundaries", () => {
    assert.equal(clampMindmapPanOffset(-1000, 100, 500, 1, 300), -436);
    assert.equal(clampMindmapPanOffset(1000, 100, 500, 1, 300), 136);
    assert.equal(clampMindmapPanOffset(-150, 100, 500, 1, 300), -150);
});

test("small or scaled content remains reachable", () => {
    assert.equal(clampMindmapPanOffset(-1000, 10, 30, 1, 300), -10);
    assert.equal(clampMindmapPanOffset(1000, 10, 30, 1, 300), 270);
    assert.equal(clampMindmapPanOffset(-1000, 100, 500, .5, 300), -186);
});

test("unmeasured bounds do not move the view", () => {
    assert.equal(clampMindmapPanOffset(12, Infinity, -Infinity, 1, 300), 12);
});

test("sparse maps cannot be panned into empty corners of their overall bounding box", () => {
    const rectangles = [
        {x: 100, y: 100, width: 100, height: 100},
        {x: 800, y: 800, width: 100, height: 100},
    ];
    for (const scale of [.25, 1, 2.5]) {
        for (const x of [-5000, -500, 0, 200, 5000]) {
            for (const y of [-5000, -500, 0, 200, 5000]) {
                const next = clampMindmapPanPosition(x, y, rectangles, scale, 400, 300);
                assert.ok(rectangles.some(rectangle => rectangle.x * scale + next.x < 400 &&
                    (rectangle.x + rectangle.width) * scale + next.x > 0 &&
                    rectangle.y * scale + next.y < 300 && (rectangle.y + rectangle.height) * scale + next.y > 0),
                `at least one actual rectangle remains visible at scale ${scale}, offset ${x}, ${y}`);
            }
        }
    }
});

test("single-axis panning keeps the other axis and uses content visible on that axis", () => {
    const rectangles = [
        {x: 100, y: 100, width: 100, height: 100},
        {x: 800, y: 800, width: 100, height: 100},
    ];
    assert.deepEqual(clampMindmapPanPosition(0, -1000, rectangles, 1, 400, 300, "y"), {x: 0, y: -136});
    assert.deepEqual(clampMindmapPanPosition(-1000, 0, rectangles, 1, 400, 300, "x"), {x: -136, y: 0});
    assert.deepEqual(clampMindmapPanPosition(-499, -1000, rectangles, 1, 400, 300, "y"), {x: -499, y: -836},
        "even a narrow horizontal slice of content is retained without horizontal drift");
    assert.deepEqual(clampMindmapPanPosition(0, 0, rectangles, 1, 400, 300), {x: 0, y: 0});
});

test("tiny content, missing measurements and empty maps keep valid pan positions", () => {
    assert.deepEqual(clampMindmapPanPosition(-1000, -1000, [{x: 10, y: 20, width: 10, height: 10}],
        1, 400, 300), {x: -10, y: -20});
    assert.deepEqual(clampMindmapPanPosition(10, 20, [], 1, 400, 300), {x: 10, y: 20});
    assert.deepEqual(clampMindmapPanPosition(10, 20, [{x: 0, y: 0, width: Infinity, height: 10}],
        1, 400, 300), {x: 10, y: 20});
    assert.deepEqual(clampMindmapPanPosition(10, 20, [{x: 0, y: 0, width: 100, height: 100}],
        1, 0, 300), {x: 10, y: 20});
});
