import assert from "node:assert/strict";
import test from "node:test";
import {goCacheKey} from "./go-cache.mjs";

test("Go cache sharing depends on host, toolchain and dependencies rather than the build target", () => {
    const inputs = {os: "Linux", arch: "X64", image: "ubuntu24", version: "go1.26.5", sum: "dependencies"};
    const key = goCacheKey(inputs);
    assert.match(key, /^siyuan-go-v1-Linux-X64-ubuntu24-go1\.26\.5-[0-9a-f]{64}$/);
    assert.equal(goCacheKey({...inputs, sum: Buffer.from(inputs.sum)}), key);
    for (const changes of [{os: "Windows"}, {arch: "ARM64"}, {image: "ubuntu26"},
        {version: "go1.27.2"}, {sum: "new dependencies"}]) {
        assert.notEqual(goCacheKey({...inputs, ...changes}), key);
    }
    assert.equal(goCacheKey({...inputs, os: "macOS", image: "unused"}),
        goCacheKey({...inputs, os: "macOS", image: "different"}));
    assert.throws(() => goCacheKey({...inputs, version: ""}), /Invalid Go cache metadata/);
    assert.throws(() => goCacheKey({...inputs, image: "ubuntu24\ninjected=value"}), /Invalid Go cache metadata/);
});
