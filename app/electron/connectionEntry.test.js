const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "connectionEntry.js"), "utf8");

// 在临时目录中按给定布局写入语言文件，返回页面所在目录
const createLayout = (t, {pageDir, langsDir, labels}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-connection-entry-"));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.mkdirSync(path.join(root, pageDir), {recursive: true});
    fs.mkdirSync(path.join(root, langsDir), {recursive: true});
    for (const [lang, label] of Object.entries(labels)) {
        fs.writeFileSync(path.join(root, langsDir, lang + ".json"), JSON.stringify({connectRemoteKernel: label}));
    }
    return path.join(root, pageDir);
};

const createElement = (properties = {}) => {
    const listeners = new Map();
    const classes = new Set();
    return {
        ...properties,
        style: {},
        classList: {add: name => classes.add(name), contains: name => classes.has(name)},
        addEventListener: (type, listener) => listeners.set(type, listener),
        dispatch: type => listeners.get(type)(),
    };
};

// 按启动页面的控件与查询参数执行连接入口脚本，记录元素挂载位置和 IPC 消息
const runEntry = (pageDir, lang, {
    pathname = "/electron/init.html", search = "?lang=" + lang, hasLangSelect = true, hasCrashActions = false,
} = {}) => {
    const appended = [];
    const crashAppended = [];
    const created = [];
    const required = [];
    const sent = [];
    const button = createElement();
    const langSelect = hasLangSelect ? createElement({value: lang}) : null;
    const crashActions = hasCrashActions ? createElement({append: element => crashAppended.push(element)}) : null;
    vm.runInNewContext(source, {
        __dirname: pageDir,
        URLSearchParams,
        location: {pathname, search},
        require: name => {
            required.push(name);
            return {
                electron: {ipcRenderer: {send: (...args) => sent.push(args)}},
                "node:fs": fs,
                "node:path": path,
            }[name];
        },
        document: {
            createElement: () => {
                created.push(button);
                return button;
            },
            querySelector: selector => ({".lang": langSelect, ".crash-actions": crashActions})[selector] ?? null,
            body: {append: element => appended.push(element)},
        },
    });
    return {appended, crashAppended, created, required, sent, button, langSelect};
};

for (const [platform, resources] of [["Windows and Linux", "resources"], ["macOS", "SiYuan.app/Contents/Resources"]]) {
    test(`connection entry reads labels from the packaged resources directory on ${platform}`, (t) => {
        // 安装包中页面位于资源目录的 app/electron 下，语言文件位于资源目录的 appearance/langs 下
        const pageDir = createLayout(t, {
            pageDir: resources + "/app/electron",
            langsDir: resources + "/appearance/langs",
            labels: {"en": "Packaged en", "zh-CN": "Packaged zh-CN"},
        });
        const {appended, sent, button, langSelect} = runEntry(pageDir, "zh-CN");
        assert.deepEqual(appended, [button]);
        assert.equal(button.textContent, "Packaged zh-CN");
        langSelect.value = "en";
        langSelect.dispatch("change");
        assert.equal(button.textContent, "Packaged en");
        button.dispatch("click");
        assert.deepEqual(sent.map(([channel, data]) => [channel, data.lang]), [["siyuan-manage-connections", "en"]]);
    });
}

test("connection entry reads labels from the source tree during development", (t) => {
    const pageDir = createLayout(t, {pageDir: "app/electron", langsDir: "app/appearance/langs", labels: {en: "Source en"}});
    const {appended, button} = runEntry(pageDir, "en");
    assert.deepEqual(appended, [button]);
    assert.equal(button.textContent, "Source en");
});

test("connection entry falls back to English when the selected language file is missing", (t) => {
    const pageDir = createLayout(t, {
        pageDir: "resources/app/electron",
        langsDir: "resources/appearance/langs",
        labels: {en: "Packaged en"},
    });
    const {appended, button} = runEntry(pageDir, "fr");
    assert.deepEqual(appended, [button]);
    assert.equal(button.textContent, "Packaged en");
});

for (const [layout, pageDir, langsDir] of [
    ["Windows and Linux package", "resources/app/electron", "resources/appearance/langs"],
    ["macOS package", "SiYuan.app/Contents/Resources/app/electron", "SiYuan.app/Contents/Resources/appearance/langs"],
    ["source tree", "app/electron", "app/appearance/langs"],
]) {
    for (const [page, options, crash] of [
        ["missing workspace", {pathname: "/electron/workspace.html", search: "?lang=zh-CN&missing=workspace",
            hasCrashActions: true}, false],
        ["safe mode", {pathname: "/electron/workspace.html", search: "?lang=zh-CN&crash=1",
            hasCrashActions: true}, true],
        ["remote boot", {pathname: "/electron/boot.html", search: "?remote=https://example.com&lang=zh-CN",
            hasLangSelect: false}, false],
    ]) {
        test(`connection entry mounts and opens connections on the ${page} page in the ${layout}`, (t) => {
            const directory = createLayout(t, {pageDir, langsDir, labels: {en: "English", "zh-CN": "Chinese"}});
            const {appended, crashAppended, button, sent, langSelect} = runEntry(directory, "zh-CN", options);
            assert.deepEqual(appended, crash ? [] : [button]);
            assert.deepEqual(crashAppended, crash ? [button] : []);
            assert.equal(button.textContent, "Chinese");
            assert.equal(button.classList.contains("b3-button--outline"), crash);
            if (crash) {
                assert.equal(button.style.cssText, undefined);
            } else {
                assert.match(button.style.cssText, /position:fixed/);
            }
            if (langSelect) {
                langSelect.value = "en";
                langSelect.dispatch("change");
                assert.equal(button.textContent, "English");
            } else {
                assert.equal(langSelect, null);
            }
            button.dispatch("click");
            assert.deepEqual(sent.map(([channel, data]) => [channel, data.lang]),
                [["siyuan-manage-connections", langSelect ? "en" : "zh-CN"]]);
        });
    }

    test(`connection entry skips the local boot page in the ${layout}`, (t) => {
        const directory = createLayout(t, {pageDir, langsDir, labels: {en: "English"}});
        const {appended, crashAppended, created, required, sent} = runEntry(directory, "en", {
            pathname: "/electron/boot.html", search: "?lang=en", hasLangSelect: false,
        });
        assert.deepEqual(appended, []);
        assert.deepEqual(crashAppended, []);
        assert.deepEqual(created, []);
        assert.deepEqual(required, []);
        assert.deepEqual(sent, []);
    });
}
