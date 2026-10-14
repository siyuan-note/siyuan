import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as binding from "./binding";

const createHarness = (icon = "1f600", code = 0, invalidateDuringSave = false) => {
    const api = {} as typeof import("./bindCreatedDocument");
    const events: Array<{path: string, data: unknown}> = [];
    let valid = true;
    const siyuan = {config: {readonly: false}, isPublish: false};
    runInNewContext(transpileModule(readFileSync(join(__dirname, "bindCreatedDocument.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: api, window: {siyuan},
        require: (name: string) => ({
            "./binding": binding,
            "../../../util/fetch": {fetchSyncPost: async (path: string, data: unknown) => {
                events.push({path, data});
                valid = !invalidateDuringSave;
                return {code};
            }},
            "../../wysiwyg/transaction": {transaction: (_protyle: unknown, data: unknown) => {
                events.push({path: "transaction", data});
            }},
        })[name] || {},
    });
    const protyle = {id: "editor", options: {}} as IProtyle;
    return {events, siyuan, bind: () => api.bindCreatedAVDocument(protyle, {
        avID: "database", itemID: "entry", documentID: "new-document", blockID: "carrier",
        previousValue: {type: "block", isDetached: true, block: {content: "Title", icon}},
        isValid: () => valid,
    })};
};

test("a newly created binding document receives the entry icon before binding", async () => {
    const h = createHarness();
    assert.equal(await h.bind(), true);
    assert.equal(h.events[0].path, "/api/attr/setBlockAttrs");
    assert.equal(JSON.stringify(h.events[0].data), JSON.stringify({id: "new-document", attrs: {icon: "1f600"}}));
    const op = (h.events[1].data as IOperation[])[0];
    assert.equal(op.action, "replaceAttrViewBlock");
    assert.equal(op.previousID, "entry");
    assert.equal(op.nextID, "new-document");
});

test("an entry without a custom icon preserves the created document's default icon", async () => {
    const h = createHarness("");
    assert.equal(await h.bind(), true);
    assert.deepEqual(h.events.map(item => item.path), ["transaction"]);
});

test("binding stops if assigning the icon fails or the original entry becomes unavailable", async () => {
    for (const h of [createHarness("1f600", -1), createHarness("1f600", 0, true)]) {
        assert.equal(await h.bind(), false);
        assert.deepEqual(h.events.map(item => item.path), ["/api/attr/setBlockAttrs"]);
    }
    const h = createHarness();
    h.siyuan.config.readonly = true;
    assert.equal(await h.bind(), false);
    assert.equal(h.events.length, 0);
});
