import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const fixture = (frontend = "desktop", mobileApp = false) => {
    const appearance = {compactMode: false};
    const siyuan = {config: {appearance, readonly: false}, isPublish: false, isReady: true,
        storage: {"local-compact-mode": true, "local-menu-mouse-scroll": true}};
    const attributes = new Map<string, string>();
    const input = {checked: false};
    const saved: unknown[][] = [];
    const events: string[] = [];
    const exports = {} as typeof import("./compactMode");
    runInNewContext(transpileModule(readFileSync("src/config/tabs/compactMode.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports, Event,
        window: {siyuan, dispatchEvent: (event: Event) => events.push(event.type)},
        document: {querySelectorAll: () => [input], documentElement: {
            hasAttribute: (key: string) => attributes.has(key),
            setAttribute: (key: string, value: string) => attributes.set(key, value),
            removeAttribute: (key: string) => attributes.delete(key),
        }},
        require: () => ({getFrontend: () => frontend, isInMobileApp: () => mobileApp,
            Constants: {ATTRIBUTE_UI_DENSITY: "data-ui-density"},
            appearanceConfigApi: {patch: async (path: string, value: boolean) => {saved.push([path, value]);}},
        }),
    });
    return {api: exports, appearance, siyuan, saved, events, input, attributes};
};

test("compactMode ignores retired KV values and reads confirmed configuration updates", () => {
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
    for (const kind of ["readonly", "publish", "mobile", "browser-mobile", "mobile-app"]) {
        const f = fixture(kind.includes("mobile") && kind !== "mobile-app" ? kind : "desktop", kind === "mobile-app");
        f.siyuan.config.readonly = kind === "readonly";
        f.siyuan.isPublish = kind === "publish";
        await f.api.setCompactModeEnabled(true);
        assert.deepEqual(f.saved, [], kind);
    }
});
