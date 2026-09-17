import {test} from "node:test";
import * as assert from "node:assert/strict";
import {globalBacklinkPageOffset, globalBacklinkPageWindow, GLOBAL_BACKLINK_PAGE_WINDOW, GLOBAL_BACKLINK_PAGE_SIZE} from "./globalBacklinkPaging";

test("global backlink windows remain bounded at the beginning, middle, and end", () => {
    for (const total of [0, 1, 49, 50, 51, 249, 250, 251, 100000]) {
        for (const index of [0, Math.floor(total / 2), total - 1]) {
            const offset = globalBacklinkPageOffset(index);
            const range = globalBacklinkPageWindow(offset, total);
            assert.ok(range.start >= 0);
            assert.ok(range.end <= total);
            assert.ok(range.end - range.start <= GLOBAL_BACKLINK_PAGE_WINDOW * GLOBAL_BACKLINK_PAGE_SIZE);
            if (total > 0) { assert.ok(offset >= range.start && offset < range.end); }
        }
    }
});
