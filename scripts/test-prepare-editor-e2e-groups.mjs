import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {createConfig, partitionFiles, readListing, validateGroups} from "./prepare-editor-e2e-groups.mjs";

const editorTest = (file, id = file) => ({file, id, project: "editor"});
const dependencies = [
    {file: "global.setup.ts", id: "setup", project: "setup"},
    {file: "global.teardown.ts", id: "cleanup", project: "cleanup"},
];
const original = [
    ...dependencies,
    editorTest("editor-a.spec.ts", "a1"),
    editorTest("editor-a.spec.ts", "a2"),
    editorTest("editor-b.spec.ts", "b1"),
    editorTest("editor-c.spec.ts", "c1"),
];
const select = (tests, groups) => groups.map(group => {
    const files = new Set(group.files.map(entry => entry.file));
    return tests.filter(entry => entry.project !== "editor" || files.has(entry.file));
});
const spec = (file, id, project = "editor") => ({
    id, file, tests: [{projectName: project}],
});

test("reads nested Playwright suites and preserves dependency projects", () => {
    const report = {errors: [], suites: [
        {specs: [spec("global.setup.ts", "setup", "setup")]},
        {suites: [{specs: [spec("editor-a.spec.ts", "a1"), spec("editor-a.spec.ts", "a2")]}]},
        {specs: [spec("global.teardown.ts", "cleanup", "cleanup")]},
    ]};
    const listing = readListing(report);
    assert.equal(listing.length, 4);
    assert.deepEqual(listing.map(entry => entry.project), ["setup", "editor", "editor", "cleanup"]);
});

test("rejects empty, errored, malformed and duplicate listings", () => {
    assert.throws(() => readListing({suites: []}), /No editor tests/);
    assert.throws(() => readListing({suites: [], errors: [{message: "broken import"}]}), /contains errors/);
    assert.throws(() => readListing({}), /Missing Playwright suites/);
    assert.throws(() => readListing({suites: [{specs: [{tests: [{}]}]}]}), /Invalid Playwright/);
    assert.throws(() => readListing({suites: [{specs: [
        spec("editor-a.spec.ts", "a1"), spec("editor-a.spec.ts", "a1"),
    ]}]}), /Duplicate test identities/);
});

test("balances historical durations without splitting files", () => {
    const groups = partitionFiles(original, {
        "editor-a.spec.ts": 100,
        "editor-b.spec.ts": 60,
        "editor-c.spec.ts": 40,
    });
    assert.deepEqual(groups.map(group => group.weight), [100, 100]);
    assert.deepEqual(groups.map(group => group.files.map(entry => entry.file)), [
        ["editor-a.spec.ts"], ["editor-b.spec.ts", "editor-c.spec.ts"],
    ]);
    validateGroups(original, select(original, groups), groups);
});

test("includes new specs automatically and ignores deleted historical specs", () => {
    const tests = [...original, editorTest("editor-new.spec.ts", "new1"), editorTest("editor-new.spec.ts", "new2")];
    const groups = partitionFiles(tests, {"editor-a.spec.ts": 100, "editor-deleted.spec.ts": 500});
    const added = groups.flatMap(group => group.files).find(entry => entry.file === "editor-new.spec.ts");
    assert.deepEqual(added, {file: "editor-new.spec.ts", testCount: 2, weight: 100, estimated: true});
    assert.ok(!groups.flatMap(group => group.files).some(entry => entry.file === "editor-deleted.spec.ts"));
    validateGroups(tests, select(tests, groups), groups);
});

test("falls back to test counts and stays deterministic across discovery order", () => {
    const first = partitionFiles(original);
    const second = partitionFiles([...original].reverse());
    assert.deepEqual(first, second);
    assert.deepEqual(first.map(group => group.weight), [2, 2]);
    validateGroups(original, select(original, first), first);
});

test("rejects insufficient files, duplicate identities and invalid weights", () => {
    assert.throws(() => partitionFiles([]), /at least two/);
    assert.throws(() => partitionFiles([editorTest("editor-a.spec.ts")]), /at least two/);
    assert.throws(() => partitionFiles([...original, original[2]]), /Duplicate test identities/);
    for (const weight of [0, -1, NaN, Infinity, "100"]) {
        assert.throws(() => partitionFiles(original, {"editor-a.spec.ts": weight}), /Invalid duration/);
    }
});

test("rejects empty groups, missing or unexpected tests and missing dependencies", () => {
    const groups = partitionFiles(original);
    const listings = select(original, groups);
    assert.throws(() => validateGroups(original, [[], listings[1]], groups), /is empty/);
    assert.throws(() => validateGroups(original, [listings[0].filter(entry => entry.id !== "a1"), listings[1]], groups),
        /Incomplete spec file/);
    assert.throws(() => validateGroups(original, [[...listings[0], editorTest("editor-a.spec.ts", "extra")], listings[1]], groups),
        /Incomplete spec file/);
    assert.throws(() => validateGroups(original, [listings[0].filter(entry => entry.project !== "setup"), listings[1]], groups),
        /Setup\/cleanup coverage changed/);
    assert.throws(() => validateGroups(original, [[...listings[0], listings[0][0]], listings[1]], groups),
        /Duplicate group 1 test identities/);
});

test("rejects files duplicated between groups even when whole file listings match", () => {
    const groups = partitionFiles(original);
    groups[1].files.push(groups[0].files[0]);
    assert.throws(() => validateGroups(original, select(original, groups), groups), /Spec file appears in both groups/);
});

test("rejects a missing whole spec file", () => {
    const groups = partitionFiles(original);
    groups[1].files.pop();
    assert.throws(() => validateGroups(original, select(original, groups), groups), /coverage has missing/);
});

test("creates exact full-path matches and preserves focused configuration", () => {
    const root = path.resolve("test-root [special]");
    const file = "nested/editor-a+[1].spec.ts";
    const config = createConfig([file], root);
    const serializedPattern = config.match(/new RegExp\((.+)\)/)[1];
    const pattern = new RegExp(JSON.parse(serializedPattern));
    assert.ok(pattern.test(path.resolve(root, file)));
    assert.ok(!pattern.test(path.resolve(root, "nested/editor-aa1.spec.ts")));
    assert.ok(!pattern.test(path.resolve(root, `${file}.backup`)));
    assert.match(config, /import focused from "\.\/playwright.focused.config"/);
    assert.match(config, /\.\.\.focused/);
    assert.match(config, /\.\.\.project/);
    assert.match(config, /\} : project/);
    assert.ok(!config.includes("workers:"));
    assert.throws(() => createConfig([], root), /empty editor group/);
    assert.throws(() => createConfig([file, file], root), /Duplicate config files/);
    assert.throws(() => createConfig(["../outside.spec.ts"], root), /outside test root/);
});
