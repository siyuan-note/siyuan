import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {getTaskListMarker} from "./taskListMarker";

describe("getTaskListMarker", () => {
    it("recognizes full-width task list shortcuts when enabled", () => {
        assert.deepEqual(getTaskListMarker("【】待办", true), {
            contentStartIndex: 2,
            marker: " ",
        });
        assert.deepEqual(getTaskListMarker("【X】完成", true), {
            contentStartIndex: 3,
            marker: "X",
        });
    });

    it("keeps full-width task list shortcuts as text when disabled", () => {
        assert.equal(getTaskListMarker("【】待办", false), undefined);
        assert.equal(getTaskListMarker("【X】完成", false), undefined);
    });

    it("always recognizes half-width task list shortcuts", () => {
        assert.deepEqual(getTaskListMarker("[]todo", false), {
            contentStartIndex: 2,
            marker: " ",
        });
        assert.deepEqual(getTaskListMarker("[x]done", false), {
            contentStartIndex: 3,
            marker: "x",
        });
    });
});
