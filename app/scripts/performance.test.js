const assert = require("node:assert/strict");
const {test} = require("node:test");
const {spawnSync} = require("node:child_process");
const {mkdtempSync, writeFileSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const path = require("node:path");

test("performance logs accept prefixed JSON and reject corrupted measurements", async () => {
    const {parsePerformanceLine} = await import("./performance.mjs");
    assert.equal(parsePerformanceLine("ordinary log"), undefined);
    assert.deepEqual(parsePerformanceLine('I 2026 kernel.go:10 siyuan-performance {"operation":"search","duration_us":1000}'),
        {operation: "search", duration_us: 1000});
    for (const record of ["{", '{"operation":"search","duration_us":-1}',
        '{"operation":"search","duration_us":1,"counts":{"rows":"many"}}']) {
        assert.throws(() => parsePerformanceLine("siyuan-performance " + record));
    }
});

test("performance summaries separate operations and only report adequately sampled percentiles", async () => {
    const {summarizePerformance} = await import("./performance.mjs");
    const records = Array.from({length: 100}, (_value, index) => ({operation: "search", duration_us: (index + 1) * 1000,
        stages_us: {query: (index + 1) * 500}, counts: {rows: 50}}));
    const summary = summarizePerformance([...records, {operation: "editor.content", duration_us: 2000}]);
    assert.deepEqual(summary.search.duration_ms, {samples: 100, median: 50.5, p95: 95, p99: 99, max: 100});
    assert.equal(summary.search.stages_ms.query.median, 25.25);
    assert.equal(summary.search.counts.rows.median, 50);
    assert.deepEqual(summary["editor.content"].duration_ms, {samples: 1, median: 2, max: 2});
    const small = summarizePerformance(records.slice(0, 20));
    assert.equal(small.search.duration_ms.p95, 19);
    assert.equal(small.search.duration_ms.p99, undefined);
});

test("performance CLI reads UTF-8 captures and reports empty or malformed input", () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-performance-test-"));
    const file = path.join(temporary, "测量.log");
    const run = () => spawnSync(process.execPath, [path.join(__dirname, "performance.mjs"), file],
        {encoding: "utf8", windowsHide: true});
    try {
        writeFileSync(file, 'ordinary log\r\nsiyuan-performance {"operation":"search","duration_us":1000}\r\n', "utf8");
        const result = run();
        assert.equal(result.status, 0, result.stderr);
        const summary = JSON.parse(result.stdout);
        assert.equal(summary.file, file);
        assert.equal(summary.operations.search.duration_ms.median, 1);
        writeFileSync(file, "ordinary log\nsiyuan-performance {\n", "utf8");
        const malformed = run();
        assert.equal(malformed.status, 1);
        assert.ok(malformed.stderr.includes(file + ":2:"));
        writeFileSync(file, "ordinary log\n", "utf8");
        const empty = run();
        assert.equal(empty.status, 1);
        assert.match(empty.stderr, /No performance records/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-performance-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
