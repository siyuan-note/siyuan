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
    return {
        ...properties,
        style: {},
        classList: {add() {}},
        addEventListener: (type, listener) => listeners.set(type, listener),
        dispatch: type => listeners.get(type)(),
    };
};

// 以首次启动页的最小 DOM 执行连接入口脚本，记录挂载的元素与发送的 IPC 消息
const runEntry = (pageDir, lang) => {
    const appended = [];
    const sent = [];
    const button = createElement();
    const langSelect = createElement({value: lang});
    vm.runInNewContext(source, {
        __dirname: pageDir,
        URLSearchParams,
        location: {pathname: "/electron/init.html", search: "?lang=" + lang},
        require: name => ({
            electron: {ipcRenderer: {send: (...args) => sent.push(args)}},
            "node:fs": fs,
            "node:path": path,
        })[name],
        document: {
            createElement: () => button,
            querySelector: selector => selector === ".lang" ? langSelect : null,
            body: {append: element => appended.push(element)},
        },
    });
    return {appended, sent, button, langSelect};
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
