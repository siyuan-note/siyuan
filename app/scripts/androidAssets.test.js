const {test} = require("node:test");
const assert = require("node:assert/strict");
const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function fixture(t) {
    const root = mkdtempSync(path.join(os.tmpdir(), "siyuan-android-assets-test-"));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        rmSync(root, {recursive: true, force: true});
    });
    const write = (name, content = "") => {
        const file = path.join(root, name);
        mkdirSync(path.dirname(file), {recursive: true});
        writeFileSync(file, content);
    };
    write("build/mobile/index.html", '<script src="startup.12345678.js"></script><script src="main.12345678.js"></script><link href="base.12345678.css">');
    write("build/mobile/startup.12345678.js");
    write("build/mobile/main.12345678.js", '"chunk.12345678.js"');
    write("build/mobile/chunk.12345678.js");
    write("build/mobile/base.12345678.css");
    write("build/desktop/index.html", '<script src="main.abcdef12.js"></script>');
    write("build/desktop/main.abcdef12.js");
    write("build/export/protyle-method.js");
    write("build/export/base.css");
    return {root, write};
}

test("Android assets retain serving, export and shared resources without historical or Electron bundles", async t => {
    const {androidStageFiles} = await import("../../scripts/android-assets.mjs");
    const {root, write} = fixture(t);
    write("build/app/main.12345678.js");
    write("build/desktop/main.87654321.js");
    write("build/mobile/startup.87654321.js");
    write("build/mobile/main.12345678.js.map");
    write("protyle/js/editor.js");
    write("icon.png");
    assert.deepEqual(androidStageFiles(root), [
        "stage/build/desktop/index.html",
        "stage/build/desktop/main.abcdef12.js",
        "stage/build/export/base.css",
        "stage/build/export/protyle-method.js",
        "stage/build/mobile/base.12345678.css",
        "stage/build/mobile/chunk.12345678.js",
        "stage/build/mobile/index.html",
        "stage/build/mobile/main.12345678.js",
        "stage/build/mobile/startup.12345678.js",
        "stage/icon.png",
        "stage/protyle/js/editor.js",
    ]);
});

test("Android packaging rejects missing current bundles and serving/export entry points", async t => {
    const {androidStageFiles} = await import("../../scripts/android-assets.mjs");
    const {root} = fixture(t);
    for (const name of ["build/mobile/main.12345678.js", "build/desktop/index.html", "build/export/base.css"]) {
        const file = path.join(root, name);
        const content = require("node:fs").readFileSync(file);
        rmSync(file);
        assert.throws(() => androidStageFiles(root), /Missing Android resource/);
        writeFileSync(file, content);
    }
});
