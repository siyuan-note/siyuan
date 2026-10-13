import {test} from "node:test";
import * as assert from "node:assert/strict";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {listTests, orderJobs, planShards, preparePackageWorkspace, runJSONJob, runJobs, testPackageConfigurations} from "./test-kernel.mjs";

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

test("package sharding respects low-core and model-only execution without duplicating packages", () => {
    assert.deepEqual(testPackageConfigurations(4, false, 2).map(item => item.name), ["model"]);
    assert.deepEqual(testPackageConfigurations(4, true, 16).map(item => item.name), ["model"]);
    assert.deepEqual(testPackageConfigurations(4, false, 3).map(item => item.name), ["model"]);
    const configurations = testPackageConfigurations(4, false, 16);
    assert.deepEqual(configurations.map(item => [item.name, item.count]), [["model", 4], ["api", 2], ["mcp/tools", 2], ["util", 2]]);
    assert.equal(new Set(configurations.map(item => item.package)).size, configurations.length);
    assert.deepEqual(testPackageConfigurations(1, false, 4).map(item => item.count), [1, 1, 1, 1]);
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

test("unsharded compilation starts before measured shards and ties remain deterministic", () => {
    const jobs = [{name: "util-2", seconds: 20}, {name: "mcp-tools-1", seconds: 60},
        {name: "other-packages", seconds: 0}, {name: "util-1", seconds: 20}];
    assert.deepEqual(orderJobs(jobs).map(job => job.name), ["other-packages", "mcp-tools-1", "util-1", "util-2"]);
    assert.deepEqual(orderJobs([...jobs].reverse()).map(job => job.name), jobs.map(job => job.name));
    assert.deepEqual(orderJobs(jobs.filter(job => job.name !== "other-packages")).map(job => job.name),
        ["mcp-tools-1", "util-1", "util-2"]);
});

test("each model process has isolated relative writes while retaining repository fixtures", t => {
    const directory = temporary(t);
    const repository = join(directory, "repository");
    for (const relative of ["app/guide", "kernel/av/testdata", "kernel/model/testdata", "kernel/treenode/testdata"]) {
        mkdirSync(join(repository, relative), {recursive: true});
        writeFileSync(join(repository, relative, "fixture.txt"), relative);
    }
    const workspaces = [join(directory, "one"), join(directory, "two")];
    const [one, two] = workspaces.map(workspace => preparePackageWorkspace(repository, workspace, "model"));
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

test("API processes retain source checks and isolate configuration from the repository and other shards", t => {
    const directory = temporary(t);
    const repository = join(directory, "repository");
    for (const relative of ["app/guide", "docs", "kernel/api/testdata", "kernel/model/testdata"]) {
        mkdirSync(join(repository, relative), {recursive: true});
        writeFileSync(join(repository, relative, "fixture.txt"), relative);
    }
    const api = join(repository, "kernel/api");
    writeFileSync(join(api, "handler.go"), "package api\n");
    writeFileSync(join(api, "conf.json"), "old configuration");
    writeFileSync(join(api, "index.queue"), "old queue");
    const one = preparePackageWorkspace(repository, join(directory, "one"), "api");
    const two = preparePackageWorkspace(repository, join(directory, "two"), "api");
    assert.equal(readFileSync(join(one, "handler.go"), "utf8"), "package api\n");
    assert.equal(existsSync(join(one, "conf.json")), false);
    assert.equal(existsSync(join(one, "index.queue")), false);
    writeFileSync(join(one, "handler.go"), "package copied\n");
    writeFileSync(join(one, "conf.json"), "one");
    writeFileSync(join(two, "conf.json"), "two");
    assert.equal(readFileSync(join(api, "handler.go"), "utf8"), "package api\n");
    assert.equal(readFileSync(join(api, "conf.json"), "utf8"), "old configuration");
    assert.equal(readFileSync(join(two, "conf.json"), "utf8"), "two");
    assert.equal(readFileSync(join(one, "../../docs/fixture.txt"), "utf8"), "docs");
    assert.equal(readFileSync(join(one, "../model/testdata/fixture.txt"), "utf8"), "kernel/model/testdata");
    assert.throws(() => preparePackageWorkspace(repository, join(directory, "invalid"), "../api"));
});

test("nested MCP and util workspaces isolate ancestor writes and preserve sibling resources", t => {
    const directory = temporary(t);
    const repository = join(directory, "repository");
    for (const relative of ["docs", "kernel/util/testdata", "kernel/mcp/tools/testdata", "kernel/mcp/auth/testdata"]) {
        mkdirSync(join(repository, relative), {recursive: true});
        writeFileSync(join(repository, relative, "fixture.txt"), relative);
    }
    const tools = join(repository, "kernel/mcp/tools");
    writeFileSync(join(tools, "file.go"), "package tools\n");
    const one = preparePackageWorkspace(repository, join(directory, "one"), "mcp/tools");
    const two = preparePackageWorkspace(repository, join(directory, "two"), "mcp/tools");
    const util = preparePackageWorkspace(repository, join(directory, "util"), "util");
    writeFileSync(join(one, "index.queue"), "one");
    writeFileSync(join(one, "../conf.json"), "parent");
    writeFileSync(join(one, "file.go"), "package copy\n");
    writeFileSync(join(util, "conf.json"), "util");
    assert.equal(existsSync(join(tools, "index.queue")), false);
    assert.equal(existsSync(join(tools, "../conf.json")), false);
    assert.equal(existsSync(join(two, "index.queue")), false);
    assert.equal(existsSync(join(two, "../conf.json")), false);
    assert.equal(existsSync(join(repository, "kernel/util/conf.json")), false);
    assert.equal(readFileSync(join(tools, "file.go"), "utf8"), "package tools\n");
    assert.equal(readFileSync(join(one, "../auth/testdata/fixture.txt"), "utf8"), "kernel/mcp/auth/testdata");
    assert.equal(readFileSync(join(one, "../../util/testdata/fixture.txt"), "utf8"), "kernel/util/testdata");
    assert.equal(readFileSync(join(one, "../../../docs/fixture.txt"), "utf8"), "docs");
    assert.equal(readFileSync(join(util, "testdata/fixture.txt"), "utf8"), "kernel/util/testdata");
    assert.equal(readFileSync(join(util, "../mcp/tools/testdata/fixture.txt"), "utf8"), "kernel/mcp/tools/testdata");
    assert.throws(() => preparePackageWorkspace(repository, join(directory, "invalid"), "mcp/../util"));
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
