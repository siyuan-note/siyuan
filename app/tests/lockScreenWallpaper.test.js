const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");

for (const file of ["stage/auth.html", "electron/remote-auth.html"]) {
    test(`${file} loads the public wallpaper and restores the original background on failure`, () => {
        const source = readFileSync(file, "utf8");
        const loader = /const loadLockScreenWallpaper = \(\) => \{[\s\S]*?\n {4}\};/.exec(source);
        assert.ok(loader);
        assert.ok(source.includes('<img id="lockScreenWallpaper" alt="" hidden>'));
        const classes = new Set();
        const wallpaper = {hidden: true, src: "", onload: null, onerror: null};
        const background = file.startsWith("stage") ? {hidden: false} : null;
        runInNewContext(loader[0] + "\nloadLockScreenWallpaper();", {
            document: {
                body: {classList: {add: value => classes.add(value), remove: value => classes.delete(value)}},
                getElementById: id => id === "lockScreenWallpaper" ? wallpaper : background,
            },
        });
        assert.equal(wallpaper.src, "/api/system/getLockScreenWallpaper");
        assert.equal(wallpaper.hidden, true);
        wallpaper.onload();
        assert.equal(wallpaper.hidden, false);
        assert.ok(classes.has("has-wallpaper"));
        if (background) assert.equal(background.hidden, true);
        wallpaper.onerror();
        assert.equal(wallpaper.hidden, true);
        assert.equal(classes.has("has-wallpaper"), false);
        if (background) assert.equal(background.hidden, false);
    });
}
