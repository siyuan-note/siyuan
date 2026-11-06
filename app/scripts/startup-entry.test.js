const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");

for (const filename of ["../webpack.config.js", "../webpack.desktop.js"]) {
    test(`${filename} installs diagnostics before business chunks and shares startup state with main`, async () => {
        const config = require(filename)({}, {mode: "production"});
        assert.equal(config.entry.startup.import, "./src/boot/startup.ts");
        assert.equal(config.entry.main.import, "./src/index.ts");
        const html = config.plugins.find(plugin => plugin.constructor.name === "HtmlWebpackPlugin");
        assert.deepEqual(html.userOptions.chunks, ["startup", "main"]);
        assert.equal(html.userOptions.chunksSortMode, "manual");
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-startup-entry-"));
        const write = (file, source) => {
            const absolute = path.join(directory, file);
            fs.mkdirSync(path.dirname(absolute), {recursive: true});
            fs.writeFileSync(absolute, source);
            return absolute;
        };
        write("shared.js", `export const instance = ++globalThis.instances; export const text = ${JSON.stringify("startup".repeat(4000))};`);
        write("business.js", `export const content = ${JSON.stringify("business".repeat(4000))};`);
        write("node_modules/vendor/index.js", `module.exports = ${JSON.stringify("vendor".repeat(4000))};`);
        const startup = write("startup.js", "import {instance, text} from './shared'; globalThis.trace.push(['startup', instance]); globalThis.startupText = text;");
        const main = write("main.js", "import {instance, text} from './shared'; import {content} from './business'; import vendor from 'vendor'; globalThis.trace.push(['main', instance, content.length, vendor.length]); globalThis.mainText = text;");
        const entry = {
            startup: {...config.entry.startup, import: startup},
            main: {...config.entry.main, import: main},
        };
        for (const name of ["window", "settings"]) {
            if (config.entry[name]) entry[name] = main;
        }
        // 只打包隔离的微型依赖图，不读取或替换产品输出。
        const compiler = webpack({
            mode: "production", context: directory, target: "web", entry,
            output: {path: path.join(directory, "output"), filename: "[name].js", publicPath: ""},
            optimization: {...config.optimization, minimize: false, minimizer: []},
            plugins: config.plugins.filter(plugin => plugin instanceof HtmlWebpackPlugin).map(plugin =>
                new HtmlWebpackPlugin({...plugin.userOptions, template: "auto",
                    templateContent: "<html><head></head><body></body></html>"})),
        });
        try {
            const stats = await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : resolve(stats)));
            assert.equal(stats.hasErrors(), false, stats.toString({all: false, errors: true}));
            const entries = stats.toJson({all: false, entrypoints: true}).entrypoints;
            assert.deepEqual(entries.startup.assets.map(asset => asset.name), ["startup.js"]);
            const html = fs.readFileSync(path.join(directory, "output", "index.html"), "utf8");
            const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
            assert.equal(scripts[0], "startup.js");
            const context = vm.createContext({instances: 0, trace: []});
            context.self = context;
            const run = file => vm.runInContext(fs.readFileSync(path.join(directory, "output", file), "utf8"), context);
            run("startup.js");
            assert.deepEqual(JSON.parse(JSON.stringify(context.trace)), [["startup", 1]]);
            for (const file of scripts.slice(1)) {
                run(file);
            }
            assert.deepEqual(JSON.parse(JSON.stringify(context.trace)), [["startup", 1], ["main", 1, 32000, 24000]]);
            assert.equal(context.startupText, context.mainText);
            for (const name of ["window", "settings"]) {
                if (!entry[name]) continue;
                const html = fs.readFileSync(path.join(directory, "output", `${name}.html`), "utf8");
                assert.ok(!html.includes('src="startup.js"'));
            }
        } finally {
            await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
            fs.rmSync(directory, {recursive: true, force: true});
        }
    });
}
