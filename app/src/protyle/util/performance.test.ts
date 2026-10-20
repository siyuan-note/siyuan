import * as assert from "node:assert/strict";
import {test} from "node:test";
import {beginPerformance} from "./performance";

test("performance sampling is opt-in and does not retain individual browser measures", () => {
    performance.clearMarks("siyuan-performance");
    assert.equal(beginPerformance("editor.render"), undefined);
    performance.mark("siyuan-performance");
    const records: string[] = [];
    const original = console.info;
    console.info = (message: string) => records.push(message);
    try {
        const record = beginPerformance("editor.render");
        record.stage("content");
        record.count("roots", 3);
        record.finish();
        record.count("roots", 99);
        record.finish();
        assert.equal(records.length, 1);
        const data = JSON.parse(records[0].slice("siyuan-performance ".length));
        assert.equal(data.operation, "editor.render");
        assert.equal(data.counts.roots, 3);
        assert.ok(data.duration_us >= 0);
        assert.deepEqual(Object.keys(data.stages_us).sort(), ["content", "prepare"]);
        assert.equal(performance.getEntriesByName("editor.render").length, 0);
    } finally {
        performance.clearMarks("siyuan-performance");
        console.info = original;
    }
});
