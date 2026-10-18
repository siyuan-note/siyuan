import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/config/tabs/menuMouseScroll.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (frontend = "desktop", mobileApp = false) => {
    const input = {checked: false};
    const storage: Record<string, unknown> = {};
    const siyuan = {storage, config: {readonly: false}, isPublish: false};
    const saved: unknown[][] = [];
    const requests: ((response: unknown) => void)[] = [];
    const exports = {} as typeof import("./menuMouseScroll");
    runInNewContext(compiled, {
        exports,
        window: {siyuan},
        document: {querySelectorAll: () => [input]},
        require: () => ({
            Constants: {LOCAL_MENU_MOUSE_SCROLL: "scroll"},
            getFrontend: () => frontend,
            isInMobileApp: () => mobileApp,
            setStorageVal: (...args: unknown[]) => saved.push(args),
            fetchSyncPost: () => new Promise(resolve => requests.push(resolve)),
        }),
    });
    return {api: exports, input, storage, siyuan, saved, requests};
};

test("existing workspaces keep mouse scrolling off and persist explicit choices through workspace storage", () => {
    const f = fixture();
    for (const value of [undefined, null, false, "true", 1]) {
        f.storage.scroll = value;
        assert.equal(f.api.isMenuMouseScrollEnabled(), false);
    }
    f.api.setMenuMouseScrollEnabled(true);
    assert.deepEqual(f.saved, [["scroll", true]]);
    assert.equal(f.input.checked, true);
    delete f.storage.scroll;
    f.api.onMenuMouseScrollStorageChanged("scroll");
    assert.equal(f.input.checked, false);
    f.api.setMenuMouseScrollEnabled(false);
    assert.equal(f.storage.scroll, false);
});

test("new workspace defaults supplied by storage enable scrolling and remain subject to the user's choice", async () => {
    const f = fixture();
    const refresh = f.api.refreshMenuMouseScroll();
    f.requests.shift()({code: 0, data: {scroll: true}});
    await refresh;
    assert.equal(f.api.isMenuMouseScrollEnabled(), true);
    assert.equal(f.input.checked, true);
    assert.equal(f.saved.length, 0);
    f.api.setMenuMouseScrollEnabled(false);
    assert.equal(f.api.isMenuMouseScrollEnabled(), false);
    assert.equal(f.input.checked, false);
    assert.deepEqual(f.saved, [["scroll", false]]);
});

test("menu mouse scrolling is available on desktop frontends and preserves mobile and readonly preferences", async () => {
    for (const frontend of ["desktop", "desktop-window", "browser-desktop"]) {
        assert.equal(fixture(frontend).api.isMenuMouseScrollAvailable(), true);
    }
    for (const [frontend, mobileApp] of [["mobile", false], ["browser-mobile", false], ["browser-desktop", true]] as const) {
        const f = fixture(frontend, mobileApp);
        f.storage.scroll = true;
        f.api.setMenuMouseScrollEnabled(false);
        await f.api.refreshMenuMouseScroll();
        assert.equal(f.api.isMenuMouseScrollEnabled(), false);
        assert.equal(f.storage.scroll, true);
        assert.equal(f.saved.length, 0);
        assert.equal(f.requests.length, 0);
    }
    for (const publish of [false, true]) {
        const f = fixture();
        f.siyuan.config.readonly = !publish;
        f.siyuan.isPublish = publish;
        f.api.setMenuMouseScrollEnabled(true);
        assert.equal(f.saved.length, 0);
        assert.equal(f.storage.scroll, undefined);
    }
});

test("reconnection restores the preference without overwriting newer pushes or closed settings windows", async () => {
    const f = fixture();
    const refresh = f.api.refreshMenuMouseScroll();
    f.requests.shift()({code: 0, data: {scroll: true}});
    await refresh;
    assert.equal(f.api.isMenuMouseScrollEnabled(), true);
    const stale = f.api.refreshMenuMouseScroll();
    f.api.setMenuMouseScrollEnabled(false);
    f.requests.shift()({code: 0, data: {scroll: true}});
    await stale;
    assert.equal(f.api.isMenuMouseScrollEnabled(), false);
    let active = true;
    const closed = f.api.refreshMenuMouseScroll(() => active);
    active = false;
    f.requests.shift()({code: 0, data: {scroll: true}});
    await closed;
    assert.equal(f.api.isMenuMouseScrollEnabled(), false);
});
