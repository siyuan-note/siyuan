const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const app = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(app, name), "utf8");

test("frontend scripts and dependencies no longer build or include the map SDK", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.devDependencies["maplibre-gl"], undefined);
    assert.equal(pkg.dependencies["maplibre-gl"], undefined);
    Object.values(pkg.scripts).forEach(script => assert.doesNotMatch(script, /webpack\.map/));
    assert.doesNotMatch(read("pnpm-lock.yaml"), /maplibre/);
    for (const removed of ["webpack.map.js", "stage/map/index.html", "stage/map/wrapper.html",
        "electron/mapHostManager.js", "electron/mapWebviewHost.js"]) {
        assert.equal(fs.existsSync(path.join(app, removed)), false, removed);
    }
});

test("all desktop packages exclude stale map sources and generated output", () => {
    const configs = fs.readdirSync(app).filter(name => /^electron-builder(?:-[\w-]+)?\.yml$/.test(name));
    assert.equal(configs.length, 6);
    for (const name of configs) {
        const stage = read(name).match(/from: "stage"\s+to: "stage"\s+filter: (\[[^\n]+\])/);
        assert.ok(stage, name);
        const filters = JSON.parse(stage[1]);
        assert.ok(filters.includes("**/*"), name);
        for (const excluded of ["!map/**/*", "!build/map/**/*", "!ocr/runtime/**/*"]) {
            assert.ok(filters.includes(excluded), name + ": " + excluded);
        }
    }
});

test("Docker and mobile packaging exclude stale map resources", () => {
    const docker = read("../.dockerignore").trim().split(/\r?\n/);
    assert.ok(docker.includes("app/stage/map"));
    assert.ok(docker.includes("app/stage/build/map"));
    const android = read("../scripts/android-dev-run.mjs");
    const ci = read("../.github/workflows/cd.yml");
    for (const root of ["stage/map", "stage/build/map"]) {
        assert.ok(android.includes('"--exclude=' + root + '"'));
        assert.ok(ci.includes("'" + root + "/*'"));
    }
});
