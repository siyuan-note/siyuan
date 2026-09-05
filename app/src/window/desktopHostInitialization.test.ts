import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

describe("desktop host initialization", () => {
    it("registers main and detached windows before desktop event handling", () => {
        const mainSource = readFileSync(resolve(process.cwd(), "src/boot/onGetConfig.ts"), "utf8");
        const detachedSource = readFileSync(resolve(process.cwd(), "src/window/init.ts"), "utf8");

        assert.match(mainSource, /void initDesktopHost\(\);/);
        assert.match(detachedSource, /await initDesktopHost\(\);/);
        assert.ok(detachedSource.indexOf("await initDesktopHost();") < detachedSource.indexOf("initWindowEvent(app);"));
    });
});
