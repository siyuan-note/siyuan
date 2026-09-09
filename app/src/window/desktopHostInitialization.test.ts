import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

describe("desktop host initialization", () => {
    it("awaits host capabilities before loading extensions in both desktop windows", () => {
        for (const file of ["src/index.ts", "src/window/index.ts"]) {
            const source = readFileSync(resolve(process.cwd(), file), "utf8");
            const connectionIndex = source.indexOf("await loadDesktopHostConnection();");
            assert.ok(connectionIndex > source.indexOf("window.siyuan.config = response.data.conf;"));
            assert.ok(connectionIndex < source.indexOf("await loadPlugins(this);"));
        }
    });

    it("registers main and detached windows before desktop event handling", () => {
        const mainSource = readFileSync(resolve(process.cwd(), "src/boot/onGetConfig.ts"), "utf8");
        const detachedSource = readFileSync(resolve(process.cwd(), "src/window/init.ts"), "utf8");

        assert.match(mainSource, /void initDesktopHost\(\);/);
        assert.match(detachedSource, /await initDesktopHost\(\);/);
        assert.ok(detachedSource.indexOf("await initDesktopHost();") < detachedSource.indexOf("initWindowEvent(app);"));
    });
});
