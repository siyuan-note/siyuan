const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const webpack = require("webpack");
const {EsbuildPlugin} = require("esbuild-loader");
const ChunkScopePlugin = require("./chunk-scope");

const createFixture = t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-chunk-scope-"));
    t.after(() => fs.rmSync(directory, {recursive: true}));
    const write = (name, source) => {
        const absolute = path.join(directory, name);
        fs.mkdirSync(path.dirname(absolute), {recursive: true});
        fs.writeFileSync(absolute, source);
    };
    // 私有字段在 es2021 目标下由压缩器降级，正是产物顶层辅助函数的来源。
    write("src/shared.js", "export class Counter {\n    #value = 7;\n    get value() {\n        return this.#value;\n    }\n}\n");
    write("src/index.js", [
        "import {Counter} from \"./shared.js\";",
        "globalThis.__result = new Counter().value + 5;",
        "",
    ].join("\n"));
    return directory;
};

const build = (directory, {scope, minimize = true, devtool = false, filename = "[name].js"}) => new Promise((resolve, reject) => {
    webpack({
        mode: "production",
        context: directory,
        entry: {main: "./src/index.js"},
        target: "electron-renderer",
        devtool,
        output: {
            path: path.join(directory, "output"),
            filename,
            chunkFilename: "[name].js",
            globalObject: "globalThis",
            publicPath: "",
            clean: true,
        },
        optimization: {
            minimize,
            minimizer: minimize ? [new EsbuildPlugin({target: "es2021", sourcemap: Boolean(devtool)})] : [],
            runtimeChunk: "single",
            // 用 enforce 把共享模块强制拆成注册型分块，不依赖入口数量。
            splitChunks: {
                chunks: "all",
                minSize: 0,
                cacheGroups: {common: {name: "common", test: /shared\.js$/, enforce: true}},
            },
        },
        plugins: scope ? [new ChunkScopePlugin()] : [],
    }).run((error, stats) => {
        if (error) {
            reject(error);
            return;
        }
        if (stats.hasErrors()) {
            reject(new Error(stats.toString({all: false, errors: true})));
            return;
        }
        resolve(path.join(directory, "output"));
    });
});

// 按页面脚本顺序执行产物，返回共享的全局对象，用于观察顶层声明是否成为全局变量。
const runAssets = (output, names) => {
    const context = vm.createContext({});
    for (const name of names) {
        vm.runInContext(fs.readFileSync(path.join(output, name), "utf8"), context, {filename: name});
    }
    return context;
};

const PAGED = ["runtime.js", "common.js", "main.js"];

// 运行期自身会创建分块加载全局，比较时排除它，只观察多余的顶层声明。
const leakedGlobals = (context) => Object.keys(context)
    .filter(name => name !== "__result" && !name.startsWith("webpackChunk"));

test("compressed chunks leak top-level helper names without the scope plugin", async t => {
    const directory = createFixture(t);
    const output = await build(directory, {scope: false});
    const source = fs.readFileSync(path.join(output, "common.js"), "utf8");
    const head = source.slice(0, source.indexOf(".push([["));
    assert.match(head, /\bvar\s+[A-Za-z_$][\w$]*\s*=/, "压缩后的注册型分块应先有顶层声明");
    const context = runAssets(output, PAGED);
    assert.equal(context.__result, 12);
    // 顶层声明直接成为全局变量，其中与页面同名的名字会覆盖已有全局（Lute 依赖 fs 探测宿主）。
    assert.ok(leakedGlobals(context).length > 0, "未包裹的注册型分块应把顶层声明泄漏为全局");
});

test("the scope plugin keeps helper names out of the global scope", async t => {
    const directory = createFixture(t);
    const output = await build(directory, {scope: true});
    for (const name of ["common.js", "main.js"]) {
        const source = fs.readFileSync(path.join(output, name), "utf8");
        assert.ok(source.startsWith("(()=>{\n"), name + " 应由函数作用域包裹");
        assert.ok(source.trimEnd().endsWith("})();"), name + " 应在包裹后闭合");
    }
    // 带运行时的分块已由 webpack 包裹，不重复套壳。
    assert.ok(!fs.readFileSync(path.join(output, "runtime.js"), "utf8").startsWith("(()=>{\n"));
    const context = runAssets(output, PAGED);
    assert.equal(context.__result, 12);
    assert.deepEqual(leakedGlobals(context), [], "包裹后不应再有分块顶层声明成为全局");
});

test("the scope plugin leaves development builds and their readable output alone", async t => {
    const directory = createFixture(t);
    const output = await build(directory, {scope: true, minimize: false});
    assert.ok(!fs.readFileSync(path.join(output, "common.js"), "utf8").startsWith("(()=>{\n"));
    assert.equal(runAssets(output, PAGED).__result, 12);
});

test("wrapping a chunk changes its cache key", async t => {
    const directory = createFixture(t);
    const filename = "[name].[chunkhash].js";
    const commonName = output => {
        const name = fs.readdirSync(output).find(file => /^common\.[a-f0-9]+\.js$/.test(file));
        assert.ok(name);
        return name;
    };
    const original = commonName(await build(directory, {scope: false, filename}));
    const wrapped = commonName(await build(directory, {scope: true, filename}));
    assert.notEqual(wrapped, original);
});

for (const devtool of ["source-map", "inline-source-map"]) {
    test(`the scope plugin preserves ${devtool} after inserting the wrapper`, async t => {
        const directory = createFixture(t);
        const readMap = output => {
            if (devtool === "source-map") {
                return JSON.parse(fs.readFileSync(path.join(output, "common.js.map"), "utf8"));
            }
            const script = fs.readFileSync(path.join(output, "common.js"), "utf8");
            const [, encoded] = script.match(/sourceMappingURL=data:application\/json[^,]*,([\w+/=]+)/);
            return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        };
        const original = readMap(await build(directory, {scope: false, devtool}));
        const wrapped = readMap(await build(directory, {scope: true, devtool}));
        assert.deepEqual(wrapped, {...original, mappings: ";" + original.mappings});
    });
}
