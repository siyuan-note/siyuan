import * as assert from "node:assert/strict";
import test from "node:test";
import {findMindmapDrop} from "./drop";

const positions = [
    {id: "d", parentId: "first", x: 600, y: 150, width: 128, height: 78},
    {id: "33", parentId: "root", x: 393, y: 400, width: 128, height: 78},
];

test("blank space to the right prefers the nearby lower sibling over a distant aligned child", () => {
    assert.deepEqual(findMindmapDrop(positions, 680, 455, () => true), {id: "33", placement: "after"});
});

test("sibling targets remain available above and below nodes and exclude invalid moves", () => {
    assert.deepEqual(findMindmapDrop(positions, 400, 350, () => true), {id: "33", placement: "before"});
    assert.deepEqual(findMindmapDrop(positions, 400, 600, () => true), {id: "33", placement: "after"});
    assert.equal(findMindmapDrop(positions, 680, 455, () => false), undefined);
});

test("blank space aligned with a node center chooses its child slot", () => {
    const nodes = [
        {id: "two", parentId: "root", x: 437, y: 276, width: 128, height: 78},
        {id: "33", parentId: "root", x: 437, y: 400, width: 128, height: 78},
        {id: "nested", parentId: "33", x: 645, y: 400, width: 175, height: 78},
    ];
    assert.deepEqual(findMindmapDrop(nodes, 740, 315, () => true), {id: "two", placement: "child"});
    assert.deepEqual(findMindmapDrop(nodes, 570, 378, () => true), {id: "33", placement: "before"});
    assert.notEqual(findMindmapDrop(nodes, 740, 315, id => id !== "two")?.id, "two");
});
