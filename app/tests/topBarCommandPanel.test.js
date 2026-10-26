const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");

const transpile = file => ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;

const topBarSource = transpile("layout/topBar.ts");
const menuToggleSource = transpile("menus/menuToggle.ts");

const fixture = () => {
    let menuVisible = false;
    let dialogOpen = false;
    const opened = [];
    const menu = {
        data: undefined,
        element: {classList: {contains: name => name === "fn__none" ? !menuVisible : false}},
        remove() {
            menuVisible = false;
            menu.data = undefined;
        },
        popup() {
            menuVisible = true;
        },
        closeSheet() {
        },
    };
    // 桌面端命令面板是独立对话框：已打开时销毁，未打开时先清理共享菜单再创建。
    const commandPanel = () => {
        if (dialogOpen) {
            dialogOpen = false;
            return;
        }
        menu.remove();
        dialogOpen = true;
        opened.push(menu.data);
    };
    const listeners = {};
    const barSync = {addEventListener() {}, setAttribute() {}};
    const toolbar = {
        set innerHTML(value) {
            this.html = value;
        },
        get innerHTML() {
            return this.html || "";
        },
        addEventListener(type, handler) {
            listeners[type] = handler;
        },
        querySelector: selector => selector === "#barSync" ? barSync : null,
        classList: {contains: () => true},
    };
    const entries = new Map();
    const entry = id => {
        // 真实界面上同一个按钮在多次点击间是同一个元素，开关状态依赖这一身份。
        if (!entries.has(id)) {
            entries.set(id, {
                id,
                closest: () => null,
                setAttribute() {},
                classList: {contains: () => false},
                parentElement: toolbar,
            });
        }
        return entries.get(id);
    };
    const document = {
        getElementById: id => id === "toolbar" ? toolbar : null,
        body: {classList: {add() {}, remove() {}, toggle() {}}},
        querySelector: () => null,
        addEventListener() {},
    };
    const window = {
        siyuan: {
            config: {
                readonly: false,
                sync: {stat: ""},
                appearance: {mode: 0, modeOS: 0, hideToolbar: false},
                keymap: {general: new Proxy({}, {get: () => ({custom: ""})})},
            },
            languages: new Proxy({}, {get: () => ""}),
            storage: {},
            menus: {menu},
        },
        addEventListener() {},
        setTimeout: () => 0,
        clearTimeout() {},
    };
    const toggleExports = {};
    runInNewContext(menuToggleSource, {exports: toggleExports, window});
    const base = {
        ...toggleExports,
        commandPanel,
        Constants: {LOCAL_ZOOM: "local-zoom", SIZE_ZOOM: [], SIYUAN_TOPBAR_CONTEXT_MENU: "topbar"},
        isInMobileApp: () => false,
        isBrowser: () => false,
        isWindow: () => false,
        updateHotkeyTip: value => value,
        getWorkspaceName: () => "SiYuan",
        ipcRenderer: {on() {}, send() {}},
        webFrame: {},
        MenuItem: class {
            constructor(options) {
                this.element = options;
            }
        },
    };
    // 顶栏还依赖大量与本用例无关的模块，未列出的导入统一降级为空实现。
    const dependency = () => new Proxy(base, {
        get: (target, key) => key in target ? target[key] : () => {},
    });
    const exports = {};
    runInNewContext(topBarSource, {
        exports,
        require: dependency,
        window,
        document,
        HTMLElement: Object,
        setTimeout: () => 0,
        clearTimeout() {},
        console,
    });
    exports.initBar({});
    return {
        menu,
        opened,
        click: id => listeners.click({target: entry(id), detail: 1, stopPropagation() {}}),
        closePanel: () => {
            dialogOpen = false;
        },
        isPanelOpen: () => dialogOpen,
    };
};

test("the command panel button reopens after the panel is closed elsewhere", () => {
    const f = fixture();
    f.click("barCommand");
    assert.equal(f.opened.length, 1);
    assert.equal(f.isPanelOpen(), true);
    f.closePanel();
    f.click("barCommand");
    assert.equal(f.opened.length, 2);
    assert.equal(f.isPanelOpen(), true);
});

test("the command panel button closes the open panel without rebuilding it", () => {
    const f = fixture();
    f.click("barCommand");
    f.click("barCommand");
    assert.equal(f.opened.length, 1);
    assert.equal(f.isPanelOpen(), false);
    f.click("barCommand");
    assert.equal(f.opened.length, 2);
});
