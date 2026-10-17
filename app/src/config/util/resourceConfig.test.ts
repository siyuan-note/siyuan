import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {ContractFormData} from "../../util/contractFormData";

const source = readFileSync("src/config/util/resourceConfig.ts", "utf8");
const fixture = (mobile = false, code = 0) => {
    const requests: Array<{url: string; body: any}> = [];
    const events: unknown[] = [];
    const api = {} as typeof import("./resourceConfig");
    const selected = source.replace(/\/\/\/ #if !MOBILE\s+([\s\S]*?)\/\/\/ #endif/g,
        (_match, desktopCode: string) => mobile ? "" : desktopCode);
    runInNewContext(transpileModule(selected, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText, {
        exports: api, window: {siyuan: {languages: {imported: "Imported"}}}, require: (module: string) => {
            switch (module) {
                case "../../util/fetch": return {
                    fetchPost: async (url: string, body: any, callback?: (response: any) => void) => {
                        requests.push({url, body});
                        if (code === -2) throw new Error("Network failed");
                        if (code >= 0) callback?.({code, msg: "Failed"});
                    },
                    fetchSyncPost: async (url: string, body: any) => { requests.push({url, body}); return {code}; },
                };
                case "../../util/contractFormData": return {ContractFormData};
                case "../../dialog/processSystem": return {exitSiYuan: (save?: boolean) => events.push(["exit", save])};
                case "../../dialog/message": return {showMessage: (text: string) => events.push(text)};
                case "../setting/maintenance": return {runSettingsMaintenance: async (action: () => Promise<void>) => {
                    events.push("prepare"); await action(); events.push("finish");
                }};
                case "../../layout/util": return {suspendLayoutSaving: async () => {
                    events.push("suspend"); return () => events.push("resume");
                }};
                default: throw new Error(module);
            }
        },
    });
    return {api, requests, events};
};

test("resource writes preserve desktop and mobile payloads and both failure protocols", async () => {
    const f = fixture();
    await f.api.switchWorkspace("workspace");
    await f.api.switchWorkspace("other", () => f.events.push("open other"));
    await f.api.saveUILayout({tabs: []}, true);
    await f.api.resetUILayout();
    await f.api.saveNotebookConf("notebook", {sortMode: 2});
    assert.equal((await f.api.saveNotebookConfSync("notebook", {sortMode: 3})).code, 0);
    await f.api.removeSearchCriterion("Saved search");
    await f.api.saveOutlineState("document", ["heading"]);
    assert.deepEqual(JSON.parse(JSON.stringify(f.requests)), [
        {url: "/api/system/setWorkspaceDir", body: {path: "workspace"}},
        {url: "/api/system/setWorkspaceDir", body: {path: "other"}},
        {url: "/api/system/setUILayout", body: {layout: {tabs: []}, errorExit: true}},
        {url: "/api/system/setUILayout", body: {layout: {}}},
        {url: "/api/notebook/setNotebookConf", body: {notebook: "notebook", conf: {sortMode: 2}}},
        {url: "/api/notebook/setNotebookConf", body: {notebook: "notebook", conf: {sortMode: 3}}},
        {url: "/api/storage/removeCriterion", body: {name: "Saved search"}},
        {url: "/api/storage/setOutlineStorage", body: {docID: "document", val: {expandIds: ["heading"]}}},
    ]);
    assert.deepEqual(f.events, [["exit", false], "open other"]);
    const failed = fixture(false, -1);
    await failed.api.switchWorkspace("workspace");
    assert.deepEqual(failed.events, []);
    assert.equal((await failed.api.resetUILayout()).code, -1);
    assert.equal((await failed.api.saveNotebookConfSync("notebook", {})).code, -1);
});

for (const mobile of [false, true]) {
    test(`${mobile ? "mobile" : "desktop"} configuration import prepares optionally and restarts only after success`, async () => {
        const file = new File(["{}"], "conf.json", {type: "application/json"});
        for (const prepared of [false, true]) {
            const f = fixture(mobile);
            await f.api.importConfiguration(file, prepared);
            assert.equal(f.requests[0].url, "/api/system/importConf");
            assert.equal(f.requests[0].body.getAll("file").length, 1);
            assert.equal(f.requests[0].body.get("file"), file);
            assert.deepEqual(f.events, [...(prepared ? ["prepare"] : []), ...(mobile ? [] : ["suspend"]),
                "Imported", ["exit", undefined], ...(prepared ? ["finish"] : [])]);
        }
        for (const code of [-1, 1]) {
            const f = fixture(mobile, code);
            await f.api.importConfiguration(file);
            assert.deepEqual(f.events, [...(mobile ? [] : ["suspend"]), ...(code > 0 ? ["Failed"] : []),
                ...(mobile ? [] : ["resume"])]);
        }
        const failed = fixture(mobile, -2);
        await assert.rejects(failed.api.importConfiguration(file), /Network failed/);
        assert.deepEqual(failed.events, mobile ? [] : ["suspend", "resume"]);
    });
}
