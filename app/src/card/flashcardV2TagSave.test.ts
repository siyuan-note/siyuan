import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {buildFlashcardV2TagAssignmentGroups} from "./flashcardV2State";

type Group = {targetIDs: string[], tagIDs: string[]};
type Operation = {operationID: string, changedAt: number};
const createSave = () => {
    let id = 0;
    const exports: {FlashcardV2TagSave?: new () => {
        close: () => void,
        run: (groups: Group[], save: (group: Group, operation: Operation) => Promise<boolean>) => Promise<boolean>,
    }} = {};
    runInNewContext(transpileModule(readFileSync("src/card/flashcardV2TagSave.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: () => ({genUUID: () => String(++id)})});
    return new exports.FlashcardV2TagSave();
};
const groups: Group[] = [{targetIDs: ["a"], tagIDs: ["first"]}, {targetIDs: ["b"], tagIDs: ["second"]}];

test("tag changes preserve assignments outside a 1000-item picker", () => {
    const original = Array.from({length: 1005}, (_, i) => `tag-${i}`);
    const planned = buildFlashcardV2TagAssignmentGroups(["a"], {a: original}, {"tag-0": false, added: true});
    assert.equal(planned[0].tagIDs.length, 1005);
    assert.ok(planned[0].tagIDs.includes("tag-1004"));
    assert.ok(planned[0].tagIDs.includes("added"));
    assert.ok(!planned[0].tagIDs.includes("tag-0"));
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const section = source.slice(source.indexOf("const openFlashcardV2Tags ="), source.indexOf("const openFlashcardV2FlagDefinitions ="));
    assert.doesNotMatch(section, /input:checked/);
    assert.match(section, /buildFlashcardV2TagAssignmentGroups\(targetIDs, assignments/);
});

test("partial tag saves resume at the failed group with the same operation identity", async () => {
    const save = createSave();
    const calls: Array<{target: string, operation: Operation}> = [];
    let fail = true;
    const request = async (group: Group, operation: Operation) => {
        calls.push({target: group.targetIDs[0], operation});
        return group.targetIDs[0] !== "b" || !fail;
    };
    assert.equal(await save.run(groups, request), false);
    fail = false;
    assert.equal(await save.run(groups, request), true);
    assert.deepEqual(calls.map(call => call.target), ["a", "b", "b"]);
    assert.strictEqual(calls[1].operation, calls[2].operation);
    const changed = [{targetIDs: ["a"], tagIDs: []}, groups[1]];
    assert.equal(await save.run(changed, request), true);
    assert.notEqual(calls[0].operation.operationID, calls[3].operation.operationID);
});

test("pending tag saves cannot run concurrently and closure prevents later groups", async () => {
    const save = createSave();
    let release: (value: boolean) => void;
    let calls = 0;
    const pending = save.run(groups, async () => {
        calls++;
        return new Promise<boolean>(resolve => { release = resolve; });
    });
    assert.equal(await save.run(groups, async () => { calls++; return true; }), false);
    save.close();
    release(true);
    assert.equal(await pending, false);
    assert.equal(calls, 1);
    assert.equal(await save.run(groups, async () => true), false);
});

test("timeout or rejection leaves the unconfirmed operation available for retry", async () => {
    const save = createSave();
    let operation: Operation;
    await assert.rejects(save.run(groups, async (_group, current) => {
        operation = current;
        throw new Error("timeout");
    }), /timeout/);
    assert.equal(await save.run(groups, async (group, current) => {
        if (group.targetIDs[0] === "a") {
            assert.strictEqual(current, operation);
        }
        return true;
    }), true);
});
