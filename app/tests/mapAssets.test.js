const assert = require("node:assert/strict");
const path = require("node:path");
const {test} = require("node:test");
const config = require("../webpack.map");

test("map asset plugin emits only fixed renderer resources and tracks their source dependencies", () => {
    const assets = new Map();
    const compilation = {
        fileDependencies: new Set(),
        emitAsset(name, source) { assets.set(name, source.source()); },
        hooks: {processAssets: {tap(_options, callback) { callback(); }}},
    };
    const compiler = {hooks: {thisCompilation: {tap(_name, callback) { callback(compilation); }}}};
    const options = config({}, {mode: "production"});
    options.plugins.forEach(plugin => plugin.apply(compiler));
    assert.deepEqual([...assets.keys()].sort(), ["maplibre-LICENSE.txt", "maplibre-gl-csp-worker.js", "maplibre-gl.css", "maplibre-gl.js"]);
    for (const name of ["maplibre-gl-csp.js", "maplibre-gl-csp-worker.js", "maplibre-gl.css", "LICENSE.txt"]) {
        assert.ok(compilation.fileDependencies.has(require.resolve("maplibre-gl/dist/" + name)));
    }
    assert.equal(options.target, "web");
    assert.equal(options.output.path, path.resolve(__dirname, "../stage/build/map"));
    assert.equal(options.output.clean, true);
});
