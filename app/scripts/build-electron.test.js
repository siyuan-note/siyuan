const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn} = require("node:child_process");
const {setTimeout: delay} = require("node:timers/promises");
const {test} = require("node:test");
const {rendererScripts, staticAssets, markdownRuntimeAssets, bundledEntries} = require("./electronPackageContent");

test("watch copies every runtime asset without a main-process edit", {timeout: 60000}, async t => {
    const appRoot = path.join(__dirname, "..");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-electron-watch-"));
    const modules = path.join(root, "node_modules");
    let child;
    let closed;
    let exited = false;
    let failure;
    let output = "";
    t.after(async () => {
        if (child && !exited) {
            child.kill();
            await closed;
        }
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        if (fs.existsSync(modules)) {
            if (process.platform === "win32") fs.rmdirSync(modules);
            else fs.unlinkSync(modules);
        }
        fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    });

    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, "electron", "static"), {recursive: true});
    fs.mkdirSync(path.join(root, "electron", "markdown"));
    fs.symlinkSync(path.join(appRoot, "node_modules"), modules, process.platform === "win32" ? "junction" : "dir");
    for (const name of ["build-electron.mjs", "electronPackageContent.js"]) {
        fs.copyFileSync(path.join(__dirname, name), path.join(root, "scripts", name));
    }
    fs.copyFileSync(path.join(appRoot, "webpack.electron.js"), path.join(root, "webpack.electron.js"));
    const assets = [
        ...[...rendererScripts, ...staticAssets].map(name => ({
            source: path.join("electron", "static", name), target: path.join("electron-dist", "static", name),
        })),
        ...markdownRuntimeAssets.map(name => ({
            source: path.join("electron", "markdown", name), target: path.join("electron-dist", name),
        })),
    ];
    for (const asset of assets) {
        fs.writeFileSync(path.join(root, asset.source), "initial " + asset.source);
    }
    const entry = path.join(root, "electron", "main.ts");
    for (const source of Object.values(bundledEntries)) {
        fs.writeFileSync(path.join(root, source), "const value: number = 1;\nconsole.log(value);\n");
    }
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    child = spawn(process.execPath, ["scripts/build-electron.mjs", "--watch"], {
        cwd: root, env, windowsHide: true,
    });
    closed = new Promise(resolve => child.once("close", () => { exited = true; resolve(); }));
    child.once("error", error => { failure = error; });
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    const waitFor = async (predicate, description, retryCodes = ["ENOENT", "EBUSY", "EPERM"]) => {
        const deadline = Date.now() + 15000;
        while (true) {
            try {
                if (predicate()) return;
            } catch (error) {
                if (!retryCodes.includes(error.code)) throw error;
            }
            if (failure) throw failure;
            assert.equal(exited, false, output);
            assert.equal(t.signal.aborted, false, "watch test canceled");
            assert.ok(Date.now() < deadline, description + "\n" + output);
            await delay(25);
        }
    };
    // Windows 复制源文件时可能短暂持有句柄，写入也需等待该句柄释放。
    const writeSource = (file, contents) => waitFor(() => {
        fs.writeFileSync(file, contents);
        return true;
    }, "source file remained locked: " + file, ["EBUSY", "EPERM"]);
    await waitFor(() => /webpack compiled in/.test(output), "initial watch compilation");
    const main = path.join(root, "electron-dist", "main.js");
    const initialBundle = fs.readFileSync(main, "utf8");
    await writeSource(entry, "const value: number = 2;\nconsole.log(value);\n");
    await waitFor(() => {
        const content = fs.readFileSync(main, "utf8");
        return content.length > 0 && content !== initialBundle;
    }, "main-process watch compilation");
    const bundle = fs.readFileSync(main, "utf8");
    const preload = path.join(root, "electron-dist", "preload.js");
    const initialPreload = fs.readFileSync(preload, "utf8");
    await writeSource(path.join(root, bundledEntries.preload), "const value: number = 3;\nconsole.log(value);\n");
    await waitFor(() => {
        const content = fs.readFileSync(preload, "utf8");
        return content.length > 0 && content !== initialPreload;
    }, "sandbox preload watch compilation");
    const preloadBundle = fs.readFileSync(preload, "utf8");

    // 所有资源均单独修改，避免其他主进程改动触发重建而掩盖监听缺项。
    for (const asset of assets) {
        const contents = "updated " + asset.source;
        await writeSource(path.join(root, asset.source), contents);
        await waitFor(() => fs.readFileSync(path.join(root, asset.target), "utf8") === contents,
            "runtime asset was not copied: " + asset.source);
    }
    assert.equal(fs.readFileSync(main, "utf8"), bundle);
    assert.equal(fs.readFileSync(preload, "utf8"), preloadBundle);
});
