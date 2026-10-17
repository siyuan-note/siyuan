import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("util.ts", readFileSync("src/layout/util.ts", "utf8"), ScriptTarget.Latest);
const selected = new Set(["layoutSavingSuspended", "saveRetryTimeout", "saveCount", "suspendLayoutSaving", "exportLayout"]);
const code = transpileModule(source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(declaration => selected.has(declaration.name.getText(source))))
    .map(statement => statement.getText(source)).join("\n"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (pending: Promise<void>[] = [], host?: {suspendLayoutSaving: () => Promise<() => void>}) => {
    const events: string[] = [];
    const api = {} as Pick<typeof import("./util"), "suspendLayoutSaving" | "exportLayout">;
    runInNewContext(code, {
        exports: api, layoutSaveRequests: new Set(pending),
        window: {clearTimeout, siyuan: {config: {readonly: false}, layout: {layout: {}, bottomDock: {}, leftDock: {}, rightDock: {}}}},
        document: {querySelector: () => ({getAttribute: () => "#iconDock"})},
        getSettingsWindowHost: () => host,
        getAllEditor: (): unknown[] => [],
        withFetchTimeout: (callback: () => Promise<void>) => callback(),
        isWindow: () => false,
        layoutToJSON: () => {}, dockToJSON: () => ({}),
        saveUILayout: async (_layout: unknown, _errorExit: boolean, callback: (response: {code: number}) => void) => {
            events.push("save old layout"); callback({code: 0});
        },
    });
    return {api, events};
};

test("import waits for existing layout writes and prevents shutdown from overwriting its layout", async () => {
    let finish: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const f = fixture([pending]);
    let ready = false;
    const suspending = f.api.suspendLayoutSaving().then(resume => { ready = true; return resume; });
    await Promise.resolve();
    assert.equal(ready, false);
    finish();
    const resume = await suspending;
    await f.api.exportLayout({errorExit: true, cb: () => f.events.push("exit")});
    assert.deepEqual(f.events, ["exit"]);
    resume();
    await f.api.exportLayout({errorExit: true, cb: () => f.events.push("exit")});
    assert.deepEqual(f.events, ["exit", "save old layout", "exit"]);
});

test("settings window suspension operates on the owner and resumes it after failure", async () => {
    const owner = fixture();
    const settings = fixture([], {suspendLayoutSaving: owner.api.suspendLayoutSaving});
    const resume = await settings.api.suspendLayoutSaving();
    await owner.api.exportLayout({errorExit: true, cb: () => owner.events.push("exit")});
    assert.deepEqual(owner.events, ["exit"]);
    resume();
    await owner.api.exportLayout({errorExit: true, cb: () => owner.events.push("exit")});
    assert.deepEqual(owner.events, ["exit", "save old layout", "exit"]);
    assert.deepEqual(settings.events, []);
});
