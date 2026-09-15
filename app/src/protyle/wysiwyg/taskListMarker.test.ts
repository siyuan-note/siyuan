import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {getTaskListMarker, isTaskListMarker, nextTaskListMarker, nextTaskListStatus} from "./taskListMarker";

describe("getTaskListMarker", () => {
    it("cycles built-in statuses and returns custom statuses to todo", () => {
        let marker = " ";
        for (const expected of ["/", "X", "-", " ", "/"]) {
            marker = nextTaskListStatus(marker);
            assert.equal(marker, expected);
        }
        assert.equal(nextTaskListStatus("x"), "-");
        for (const custom of ["?", "f", "s", "", null]) {
            assert.equal(nextTaskListStatus(custom), " ");
        }
    });
    it("completes todo and in-progress tasks and resets other states on click", () => {
        assert.equal(nextTaskListMarker(" "), "X");
        assert.equal(nextTaskListMarker("/"), "X");
        assert.equal(nextTaskListMarker(null), "X");
        for (const marker of ["X", "x", "-", "?"]) {
            assert.equal(nextTaskListMarker(marker), " ");
        }
    });
    it("validates a complete custom status instead of an empty shortcut prefix", () => {
        for (const marker of [" ", "X", "x", "/", "-", "?", "\"", "&", "<"]) {
            assert.equal(isTaskListMarker(marker), true, marker);
        }
        for (const marker of ["", "ab", "[", "]", "【", "】", "中"]) {
            assert.equal(isTaskListMarker(marker), false, marker);
        }
    });
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
