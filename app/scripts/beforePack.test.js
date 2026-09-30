const assert = require("node:assert/strict");
const test = require("node:test");
const {Arch} = require("electron-builder");
const {prepareArguments} = require("./beforePack");

test("OCR packaging selects each desktop runtime and the Linux headless worker", () => {
    for (const platform of ["win32", "darwin", "linux"]) {
        for (const arch of [Arch.x64, Arch.arm64]) {
            const args = prepareArguments({electronPlatformName: platform, arch});
            assert.equal(args[1], "--runtime");
            assert.equal(args[2], `${platform === "win32" ? "windows" : platform}-${arch === Arch.arm64 ? "arm64" : "amd64"}`);
            assert.equal(args.includes("--build-worker"), platform === "linux");
        }
    }
});

test("unsupported OCR packaging targets fail before resources are prepared", () => {
    assert.throws(() => prepareArguments({electronPlatformName: "win32", arch: Arch.ia32}), /Unsupported/);
    assert.throws(() => prepareArguments({electronPlatformName: "freebsd", arch: Arch.x64}), /Unsupported/);
});
