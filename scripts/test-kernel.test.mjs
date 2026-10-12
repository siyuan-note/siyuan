import {test} from "node:test";
import * as assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {listTests, planShards, prepareModelWorkspace, runJSONJob, runJobs} from "./test-kernel.mjs";

const durations = {prefixLength: 6, defaultSeconds: 0.2, buckets: {
    TestSl: {seconds: 40, tests: 2}, TestMe: {seconds: 20, tests: 2}, TestFa: {seconds: 10, tests: 2},
}};
const temporary = t => {
    const directory = mkdtempSync(join(tmpdir(), "siyuan-kernel-runner-test-"));
    t.after(() => {
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
        rmSync(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    });
    return directory;
};

test("test discovery includes examples and fuzz seeds without enabling benchmarks", () => {
    assert.deepEqual(listTests("TestOne\r\nExampleTwo\r\nFuzzThree\r\nBenchmarkFour\r\nPASS\r\n"),
        ["TestOne", "ExampleTwo", "FuzzThree"]);
});

test("duration balancing discovers new families and selects every current test exactly once", () => {
    const names = ["TestSlowOne", "TestSlowTwo", "TestMediumOne", "TestMediumTwo", "TestFastOne", "TestFastTwo",
        "TestNewOne", "TestNewTwo", "FuzzNew", "ExampleNew", "TestA", "TestAB", "TestABC", "TestAbcNew"];
    const shards = planShards(names, 4, durations);
    assert.equal(shards.length, 4);
    assert.deepEqual(shards.flatMap(shard => shard.names).sort(), [...names].sort());
    for (const name of names) {
        assert.equal(shards.filter(shard => new RegExp(shard.regex).test(name)).length, 1, name);
    }
    assert.equal(Math.max(...shards.map(shard => shard.seconds)), 40);
    assert.deepEqual(planShards([...names].reverse(), 4, durations).map(shard => shard.regex), shards.map(shard => shard.regex));
    const removed = names.filter(name => name !== "TestSlowTwo");
    assert.deepEqual(planShards(removed, 4, durations).flatMap(shard => shard.names).sort(), removed.sort());
});

test("invalid shard counts and duplicate names fail before running tests", () => {
    for (const count of [0, -1, 1.5, 17, NaN]) {
        assert.throws(() => planShards(["TestOne"], count, durations));
    }
    assert.throws(() => planShards(["TestOne", "TestOne"], 4, durations));
});

test("parallel jobs remain bounded and a failed job does not omit later shards", async () => {
    const jobs = [0, 1, 2, 3, 4];
    let active = 0;
    let peak = 0;
    const visited = [];
    const results = await runJobs(jobs, 2, async job => {
        active++;
        peak = Math.max(peak, active);
        visited.push(job);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return {code: job === 1 ? 1 : 0};
    });
    assert.equal(peak, 2);
    assert.deepEqual(visited.sort(), jobs);
    assert.deepEqual(results.map(result => result.code), [0, 1, 0, 0, 0]);
});

test("each model process has isolated relative writes while retaining repository fixtures", t => {
    const directory = temporary(t);
    const repository = join(directory, "repository");
    for (const relative of ["app/guide", "kernel/av/testdata", "kernel/model/testdata", "kernel/treenode/testdata"]) {
        mkdirSync(join(repository, relative), {recursive: true});
        writeFileSync(join(repository, relative, "fixture.txt"), relative);
    }
    const workspaces = [join(directory, "one"), join(directory, "two")];
    const [one, two] = workspaces.map(workspace => prepareModelWorkspace(repository, workspace));
    writeFileSync(join(one, "conf.json"), "one");
    writeFileSync(join(two, "conf.json"), "two");
    assert.equal(readFileSync(join(one, "conf.json"), "utf8"), "one");
    assert.equal(readFileSync(join(two, "conf.json"), "utf8"), "two");
    assert.equal(readFileSync(join(one, "../../app/guide/fixture.txt"), "utf8"), "app/guide");
    assert.equal(readFileSync(join(two, "../av/testdata/fixture.txt"), "utf8"), "kernel/av/testdata");
    assert.equal(readFileSync(join(one, "testdata/fixture.txt"), "utf8"), "kernel/model/testdata");
    assert.equal(dirname(resolve(workspaces[0])), resolve(directory));
    rmSync(workspaces[0], {recursive: true, force: true});
    assert.equal(readFileSync(join(repository, "app/guide/fixture.txt"), "utf8"), "app/guide");
    assert.equal(readFileSync(join(two, "../treenode/testdata/fixture.txt"), "utf8"), "kernel/treenode/testdata");
});

test("process failures, missing tests and truncated coverage cannot produce a passing shard", async t => {
    t.mock.method(console, "log", () => {});
    t.mock.method(console, "error", () => {});
    const output = temporary(t);
    const run = async (name, events, status, expectedTests) => {
        const source = `process.stdout.write(${JSON.stringify(events.map(event => JSON.stringify(event)).join("\n") + "\n")}); process.exitCode = ${status};`;
        return runJSONJob({name, args: ["-e", source], executable: process.execPath, cwd: output, expectedTests}, output);
    };
    assert.equal((await run("pass", [{Action: "pass", Test: "TestOne"}], 0, ["TestOne"])).code, 0);
    const missing = await run("missing", [{Action: "pass", Test: "TestOne"}], 0, ["TestOne", "TestTwo"]);
    assert.equal(missing.code, 1);
    assert.deepEqual(missing.missing, ["TestTwo"]);
    assert.equal((await run("unexpected", [{Action: "pass", Test: "TestOther"}], 0, ["TestOne"])).code, 1);
    assert.equal((await run("failure", [{Action: "fail", Test: "TestOne"}], 0, ["TestOne"])).code, 1);
    assert.equal((await run("crash", [], 2, ["TestOne"])).code, 1);
});
