import * as assert from "node:assert/strict";
import {test} from "node:test";
import {flushSettingSaves, settingSaveFailures, trackSettingRequest, trackSettingSave} from "./pending";
import {createNamespacePatchQueue} from "../util/namespacePatchQueue";

test("reset waits for queued settings that have not started their requests", async () => {
    const saved: string[] = [];
    let release: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const patch = createNamespacePatchQueue({
        namespace: "editor", getConfig: () => ({}), submit: async () => ({}),
        submitPatch: async (path) => {
            await gate;
            saved.push(path);
            return {};
        },
    });
    void patch("fontSize", 18);
    void patch("fullWidth", true);
    let flushed = false;
    const flush = flushSettingSaves().then(() => { flushed = true; });
    await Promise.resolve();
    assert.equal(flushed, false);
    release();
    await flush;
    assert.deepEqual(saved, ["fontSize", "fullWidth"]);
});

test("reset detects API failures even when normal settings UI consumes the error", async () => {
    for (const result of [Promise.resolve({code: -1}), Promise.reject(new Error("offline"))]) {
        const before = settingSaveFailures();
        await trackSettingRequest("/api/setting/patch", result).catch(() => {});
        await assert.rejects(flushSettingSaves(before));
    }
    await trackSettingSave(Promise.resolve());
    await flushSettingSaves();
});

test("reset does not wait for its own acknowledgement or unrelated fetches", async () => {
    for (const path of ["/api/setting/confirmSettingsReset", "/api/setting/resetSettings", "/api/search/fullTextSearchBlock"]) {
        trackSettingRequest(path, new Promise(() => {}));
    }
    await flushSettingSaves();
});
