const assert = require("node:assert/strict");
const {existsSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const sass = require("sass");

test("task icon URLs resolve from every stylesheet entry", () => {
    for (const name of ["base", "mobile", "export"]) {
        const entry = path.join(__dirname, `../src/assets/scss/${name}.scss`);
        const css = sass.compile(entry, {logger: sass.Logger.silent}).css;
        const icons = new Set();
        for (const match of css.matchAll(/url\(["']?([^\s"')]*task-(?:unchecked|in-progress|canceled)\.svg)["']?\)/g)) {
            const asset = path.resolve(path.dirname(entry), match[1]);
            assert.ok(existsSync(asset), `${name}: ${asset}`);
            icons.add(path.basename(asset));
        }
        assert.deepEqual([...icons].sort(), ["task-canceled.svg", "task-in-progress.svg", "task-unchecked.svg"]);
    }
});
