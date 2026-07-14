import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isValidBazaarPackageName} from "./bazaarPackage";

describe("isValidBazaarPackageName", () => {
    it("accepts valid package names", () => {
        assert.equal(isValidBazaarPackageName("plugin-sample"), true);
        assert.equal(isValidBazaarPackageName("plugin.sample_1"), true);
        assert.equal(isValidBazaarPackageName("a".repeat(100)), true);
    });

    it("rejects invalid package names", () => {
        assert.equal(isValidBazaarPackageName(""), false);
        assert.equal(isValidBazaarPackageName("a".repeat(101)), false);
        assert.equal(isValidBazaarPackageName("plugin/sample"), false);
        assert.equal(isValidBazaarPackageName("插件"), false);
    });

    it("rejects decoded HTML payloads", () => {
        const payload = decodeURIComponent("%3Cimg%20src%3Dx%20onerror%3D%22require(%27child_process%27)%22%3E");
        assert.equal(isValidBazaarPackageName(payload), false);
    });
});
