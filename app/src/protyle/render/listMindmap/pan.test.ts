import {test} from "node:test";
import * as assert from "node:assert/strict";
import {clampMindmapPanOffset} from "./pan";

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
