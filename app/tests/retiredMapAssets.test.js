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

test("desktop packages filter the OCR runtime out of the shipped stage folder", () => {
    const configs = fs.readdirSync(app).filter(name => /^electron-builder(?:-[\w-]+)?\.yml$/.test(name));
    assert.equal(configs.length, 6);
    for (const name of configs) {
        const stage = read(name).match(/from: "stage"\s+to: "stage"\s+filter: (\[[^\n]+\])/);
        assert.ok(stage, name);
        // 精确匹配：已撤回的地图产物不应再出现在打包过滤项里
        assert.deepEqual(JSON.parse(stage[1]), ["**/*", "!ocr/runtime/**/*"], name);
    }
});

test("no packaging path special-cases the withdrawn map output", () => {
    // 已撤回产物由内核启动清理负责；打包路径不应再枚举它们。
    assert.doesNotMatch(read("../scripts/android-dev-run.mjs"), /stage\/build\/map/);
    assert.doesNotMatch(read("../scripts/build-release.py"), /"build", "map"/);
});

test("the release pipeline rebuilds generated bundles instead of enumerating stale map output", () => {
    const ci = read("../.github/workflows/cd.yml");
    // 移动端 app.zip 前的聚合构建会先清理 stage/build，因此无需再逐个排除已撤回的地图产物。
    assert.match(ci, /run: pnpm run build\s*\n/);
    assert.doesNotMatch(ci, /stage\/build\/map/);
});
