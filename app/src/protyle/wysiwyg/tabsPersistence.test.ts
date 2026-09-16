import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isPropertyAssignment, Node, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("tabs.ts", readFileSync("src/protyle/wysiwyg/tabs.ts", "utf8"), ScriptTarget.ES2021, true);
let select: string;
const visit = (node: Node) => {
    if (isPropertyAssignment(node) && node.name.getText(source) === "select") {
        select = node.initializer.getText(source);
    }
    node.forEachChild(visit);
};
visit(source);
assert.ok(select);
const compiled = transpileModule(`(${select})(tabs, id);`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const fixture = () => {
    let active = "original";
    let ids = ["original", "placeholder"];
    const requests: unknown[] = [];
    const tasks: (() => Promise<void>)[] = [];
    const tabs = {
        isConnected: true,
        dataset: {nodeId: "tabs"},
        getAttribute: () => active,
        setAttribute: (_name: string, value: string) => { active = value; },
    };
    const selectTab = (id: string) => runInNewContext(compiled, {
        tabs, id, protyle: {}, canEdit: () => true,
        getTabItems: () => ids.map(nodeId => ({dataset: {nodeId}})),
        queueTransaction: (_protyle: unknown, task: () => Promise<void>) => tasks.push(task),
        fetchPost: async (_url: string, request: unknown) => { requests.push(request); },
    });
    return {tabs, requests, selectTab,
        removePlaceholder: () => { ids = ["original"]; },
        flush: async () => { for (const task of tasks) { await task(); } },
    };
};

test("tab persistence ignores a placeholder removed during undo", async () => {
    const f = fixture();
    f.selectTab("placeholder");
    f.removePlaceholder();
    await f.flush();
    assert.equal(f.requests.length, 0);
});

test("tab persistence ignores a replaced container", async () => {
    const f = fixture();
    f.selectTab("placeholder");
    f.tabs.isConnected = false;
    await f.flush();
    assert.equal(f.requests.length, 0);
});

test("tab persistence only saves the latest selection", async () => {
    const f = fixture();
    f.selectTab("placeholder");
    f.selectTab("original");
    await f.flush();
    assert.equal(f.requests.length, 1);
    assert.equal(JSON.stringify(f.requests[0]), JSON.stringify({id: "tabs", attrs: {"tabs-active-id": "original"}}));
});

test("tab persistence saves a selection that remains valid", async () => {
    const f = fixture();
    f.selectTab("placeholder");
    await f.flush();
    assert.equal(f.requests.length, 1);
});
