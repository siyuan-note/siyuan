import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const fixture = (frontend = "desktop", nativeBridge = {}) => {
    const appearance = {compactMode: false};
    const siyuan = {config: {appearance, readonly: false}, isPublish: false, isReady: true};
    const attributes = new Map<string, string>();
    const input = {checked: false};
    const saved: unknown[][] = [];
    const events: string[] = [];
    const exports = {} as typeof import("./compactMode");
    runInNewContext(transpileModule(readFileSync("src/config/tabs/compactMode.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports, Event,
        window: {...nativeBridge, siyuan, dispatchEvent: (event: Event) => events.push(event.type)},
        document: {querySelectorAll: () => [input], documentElement: {
            hasAttribute: (key: string) => attributes.has(key),
            setAttribute: (key: string, value: string) => attributes.set(key, value),
            removeAttribute: (key: string) => attributes.delete(key),
        }},
        require: () => ({getFrontend: () => frontend,
            Constants: {ATTRIBUTE_UI_DENSITY: "data-ui-density"},
            appearanceConfigApi: {patch: async (path: string, value: boolean) => {saved.push([path, value]);}},
        }),
    });
    return {api: exports, appearance, siyuan, saved, events, input, attributes,
        setFrontend: (value: string) => {frontend = value;}};
};

test("compactMode reflects confirmed configuration updates in its control", () => {
    const f = fixture();
    f.api.applyCompactMode();
    assert.equal(f.input.checked, false);
    f.appearance.compactMode = true;
    f.api.applyCompactMode();
    assert.equal(f.input.checked, true);
    f.appearance.compactMode = false;
    f.api.applyCompactMode();
    assert.equal(f.input.checked, false);
});

test("compactMode saves through the appearance namespace without optimistic config mutation", async () => {
    const f = fixture();
    await f.api.setCompactModeEnabled(true);
    assert.deepEqual(f.saved, [["compactMode", true]]);
    assert.equal(f.appearance.compactMode, false);
});

test("compactMode rejects readonly, published and mobile writes", async () => {
    for (const kind of ["readonly", "publish", "mobile", "browser-mobile"]) {
        const f = fixture(kind.includes("mobile") ? kind : "desktop");
        f.siyuan.config.readonly = kind === "readonly";
        f.siyuan.isPublish = kind === "publish";
        await f.api.setCompactModeEnabled(true);
        assert.deepEqual(f.saved, [], kind);
    }
});

test("compactMode supports desktop forms in browsers and native tablet apps", async () => {
    for (const frontend of ["desktop", "desktop-window", "browser-desktop"]) {
        for (const nativeBridge of [{}, {JSAndroid: {}}, {webkit: {messageHandlers: {}}}, {JSHarmony: {}}]) {
            const f = fixture(frontend, nativeBridge);
            assert.equal(f.api.isCompactModeAvailable(), true);
            await f.api.setCompactModeEnabled(true);
            assert.deepEqual(f.saved, [["compactMode", true]]);
            f.appearance.compactMode = true;
            f.api.applyCompactMode();
            assert.equal(f.input.checked, true);
            assert.equal(f.attributes.get("data-ui-density"), "compact");
            assert.deepEqual(f.events, ["resize"]);
            f.api.applyCompactMode();
            assert.deepEqual(f.events, ["resize"], "unchanged density does not resize again");
        }
    }
});

test("compactMode preserves the preference across desktop and mobile interface changes", () => {
    for (const frontend of ["mobile", "browser-mobile"]) {
        const f = fixture();
        f.appearance.compactMode = true;
        f.api.applyCompactMode();
        f.setFrontend(frontend);
        assert.equal(f.api.isCompactModeAvailable(), false);
        f.api.applyCompactMode();
        assert.equal(f.input.checked, false);
        assert.equal(f.attributes.has("data-ui-density"), false);
        assert.equal(f.appearance.compactMode, true);
        f.setFrontend("desktop");
        f.api.applyCompactMode();
        assert.equal(f.input.checked, true);
        assert.equal(f.attributes.get("data-ui-density"), "compact");
        assert.deepEqual(f.events, ["resize", "resize", "resize"]);
    }
});
