const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const webpack = require("webpack");
const PreserveWatchAssetsPlugin = require("./preserve-watch-assets");

const run = compiler => new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
        if (error) reject(error);
        else if (stats.hasErrors()) reject(new Error(stats.toString()));
        else resolve(stats.toJson({all: false, assets: true}).assets.map(asset => asset.name));
    });
});
const close = compiler => new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));

for (const target of ["config", "desktop", "mobile", "export"]) {
    for (const mode of ["development", "production"]) {
        test(`${target} ${mode} cleans on startup and ${mode === "development" ? "retains" : "removes"} previous outputs`, async t => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-webpack-clean-"));
            t.after(() => {
                assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
                fs.rmSync(root, {recursive: true, force: true});
            });
            const configuration = require(`../webpack.${target}`)({}, {mode});
            const output = path.join(root, "output");
            const entry = path.join(root, "entry.js");
            fs.mkdirSync(output);
            fs.writeFileSync(path.join(output, "stale.js"), "old session");
            fs.writeFileSync(entry, "console.log(1);");
            const options = {
                mode, entry, devtool: false,
                optimization: {minimize: false},
                output: {path: output, filename: "[contenthash].js", clean: configuration.output.clean},
                plugins: configuration.plugins.filter(plugin => plugin instanceof PreserveWatchAssetsPlugin),
            };
            const compiler = webpack(options);
            let first;
            try {
                [first] = await run(compiler);
                assert.equal(fs.existsSync(path.join(output, "stale.js")), false);
                assert.equal(fs.existsSync(path.join(output, first)), true);
                fs.writeFileSync(entry, "console.log(2);");
                await run(compiler);
                assert.equal(fs.existsSync(path.join(output, first)), mode === "development");
            } finally {
                await close(compiler);
            }
            // A fresh compiler represents restarting pnpm dev, including reused plugin instances.
            const restarted = webpack(options);
            try {
                await run(restarted);
                assert.equal(fs.existsSync(path.join(output, first)), false);
            } finally {
                await close(restarted);
            }
        });
    }
}
