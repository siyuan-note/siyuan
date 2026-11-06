import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const code = transpileModule(readFileSync("src/mobile/util/reloadUI.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const setup = (save: () => Promise<boolean>, reset = async () => true) => {
    const events: string[] = [];
    const api = {} as typeof import("./reloadUI");
    runInNewContext(code, {
        exports: api,
        require: (name: string) => name === "./saveLayout" ? {
            saveMobileLayout: save,
            resumeMobileScrollSaving: () => {},
            resetMobileLayoutScroll: async () => { events.push("reset"); return reset(); },
        } : {showMessage: () => events.push("error")},
        window: {location: {reload: () => events.push("reload")}, siyuan: {languages: {mobileLayoutSaveError: "error"}}},
        console: {warn: () => {}},
    });
    return {api, events};
};

test("mobile reload waits for saving and ignores duplicate requests", async () => {
    let resolve: (value: boolean) => void;
    let saves = 0;
    const f = setup(() => { saves++; return new Promise(done => { resolve = done; }); });
    const loading = f.api.reloadMobileUI();
    await f.api.reloadMobileUI();
    assert.equal(saves, 1);
    assert.deepEqual(f.events, []);
    resolve(true);
    await loading;
    assert.deepEqual(f.events, ["reload"]);
});

test("mobile reload preserves the page after failed or thrown saves and allows retry", async () => {
    for (const throws of [false, true]) {
        let succeeds = false;
        const f = setup(async () => {
            if (throws && !succeeds) throw new Error("offline");
            return succeeds;
        });
        await f.api.reloadMobileUI(true);
        assert.deepEqual(f.events, ["error"]);
        succeeds = true;
        await f.api.reloadMobileUI();
        assert.deepEqual(f.events, ["error", "reload"]);
    }
});

test("mobile reset waits for both saves and only reloads after successful cleanup", async () => {
    for (const succeeds of [true, false]) {
        let resolve: (value: boolean) => void;
        const f = setup(async () => true, () => new Promise(done => { resolve = done; }));
        const loading = f.api.reloadMobileUI(true);
        for (let i = 0; i < 5; i++) await Promise.resolve();
        assert.deepEqual(f.events, ["reset"]);
        resolve(succeeds);
        await loading;
        assert.deepEqual(f.events, succeeds ? ["reset", "reload"] : ["reset", "error"]);
    }
});
