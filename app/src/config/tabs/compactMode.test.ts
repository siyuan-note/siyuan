import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/config/tabs/compactMode.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (frontend = "desktop", mobileApp = false) => {
    const attributes = new Map<string, string>();
    const input = {checked: false};
    const storage: Record<string, unknown> = {};
    const config = {readonly: false};
    const saved: unknown[][] = [];
    const requests: ((response: unknown) => void)[] = [];
    const events: string[] = [];
    const siyuan = {storage, config, isPublish: false, isReady: true};
    const exports = {} as typeof import("./compactMode");
    runInNewContext(compiled, {
        exports, Event,
        window: {siyuan, dispatchEvent: (event: Event) => events.push(event.type)},
        document: {
            documentElement: {
                hasAttribute: (name: string) => attributes.has(name),
                setAttribute: (name: string, value: string) => attributes.set(name, value),
                removeAttribute: (name: string) => attributes.delete(name),
            },
            querySelectorAll: () => [input],
        },
        require: () => ({
            Constants: {LOCAL_COMPACT_MODE: "compact", CUSTOM_SY_UI_DENSITY: "density"},
            getFrontend: () => frontend,
            isInMobileApp: () => mobileApp,
            setStorageVal: (...args: unknown[]) => saved.push(args),
            fetchSyncPost: () => new Promise(resolve => requests.push(resolve)),
        }),
    });
    return {api: exports, attributes, input, storage, config, saved, requests, events, siyuan};
};

test("compact mode defaults to off and only accepts an explicit boolean preference", () => {
    const f = fixture();
    for (const value of [undefined, null, false, "true", 1]) {
        f.storage.compact = value;
        f.api.applyCompactMode();
        assert.equal(f.attributes.has("density"), false);
        assert.equal(f.input.checked, false);
    }
    assert.deepEqual(f.events, []);
});

test("compact mode persists through the workspace preference store and updates open controls", () => {
    const f = fixture();
    f.api.setCompactModeEnabled(true);
    assert.deepEqual(f.saved, [["compact", true]]);
    assert.equal(f.storage.compact, true);
    assert.equal(f.attributes.get("density"), "compact");
    assert.equal(f.input.checked, true);
    f.api.applyCompactMode();
    assert.deepEqual(f.events, ["resize"]);
    delete f.storage.compact;
    f.api.onCompactModeStorageChanged("compact");
    assert.equal(f.attributes.has("density"), false);
    assert.equal(f.input.checked, false);
    assert.deepEqual(f.events, ["resize", "resize"]);
    f.api.onCompactModeStorageChanged("unrelated");
    assert.equal(f.events.length, 2);
});

test("mobile frontends and mobile apps retain their density and do not persist desktop changes", async () => {
    for (const [frontend, mobileApp] of [["mobile", false], ["browser-mobile", false], ["browser-desktop", true]] as const) {
        const f = fixture(frontend, mobileApp);
        f.storage.compact = true;
        f.api.applyCompactMode();
        f.api.setCompactModeEnabled(false);
        await f.api.refreshCompactMode();
        assert.equal(f.attributes.has("density"), false);
        assert.equal(f.storage.compact, true);
        assert.equal(f.saved.length, 0);
        assert.equal(f.requests.length, 0);
    }
    for (const frontend of ["desktop", "desktop-window", "browser-desktop"]) {
        assert.equal(fixture(frontend).api.isCompactModeAvailable(), true);
    }
});

test("readonly and published sessions do not change the saved compact preference", () => {
    for (const publish of [false, true]) {
        const f = fixture();
        f.config.readonly = !publish;
        f.siyuan.isPublish = publish;
        f.api.setCompactModeEnabled(true);
        assert.equal(f.saved.length, 0);
        assert.equal(f.storage.compact, undefined);
    }
});

test("reconnection restores changes made while offline and removes a missing preference", async () => {
    const f = fixture();
    let refresh = f.api.refreshCompactMode();
    f.requests.shift()({code: 0, data: {compact: true}});
    await refresh;
    assert.equal(f.attributes.get("density"), "compact");
    refresh = f.api.refreshCompactMode();
    f.requests.shift()({code: 0, data: {}});
    await refresh;
    assert.equal(f.attributes.has("density"), false);
    assert.equal(f.saved.length, 0);
});

test("stale reconnection reads cannot overwrite a push, a newer read or a closed window", async () => {
    const f = fixture();
    const stale = f.api.refreshCompactMode();
    f.api.setCompactModeEnabled(true);
    f.requests.shift()({code: 0, data: {compact: false}});
    await stale;
    assert.equal(f.api.isCompactModeEnabled(), true);
    const first = f.api.refreshCompactMode();
    const second = f.api.refreshCompactMode();
    const completeFirst = f.requests.shift();
    f.requests.shift()({code: 0, data: {compact: false}});
    await second;
    completeFirst({code: 0, data: {compact: true}});
    await first;
    assert.equal(f.api.isCompactModeEnabled(), false);
    let active = true;
    const closed = f.api.refreshCompactMode(() => active);
    active = false;
    f.requests.shift()({code: 0, data: {compact: true}});
    await closed;
    assert.equal(f.api.isCompactModeEnabled(), false);
});
