import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {canPurgeRepo} from "./repoPurge";

describe("canPurgeRepo", () => {
    it("keeps local repository cleanup available for every provider", () => {
        for (const provider of [0, 1, 2, 3, 4, 99]) {
            assert.equal(canPurgeRepo("local", provider), true);
        }
    });

    it("excludes official, obsolete, and unknown providers from cloud cleanup", () => {
        for (const provider of [0, 1, -1, 99]) {
            assert.equal(canPurgeRepo("cloud", provider), false);
        }
    });

    it("allows S3, WebDAV, and local filesystem sync storage cleanup", () => {
        for (const provider of [2, 3, 4]) {
            assert.equal(canPurgeRepo("cloud", provider), true);
        }
    });
});
