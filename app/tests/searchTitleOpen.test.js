const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    return Object.fromEntries(["search/util", "boot/globalEvent/searchKeydown",
        "protyle/util/onGet", "protyle/util/selection", "protyle/util/focusRestore", "protyle/util/hasClosest", "protyle/util/selectionOffsets", "protyle/wysiwyg/getBlock", "protyle/render/searchMarkRender"]
        .map(name => {
            let source = readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8");
            if (name === "search/util") {
                const ast = ts.createSourceFile(name + ".ts", source, ts.ScriptTarget.Latest, true);
                let clickHandler;
                const visit = node => {
                    if (ts.isCallExpression(node) && node.expression.getText(ast) === "element.addEventListener" &&
                        node.arguments[0]?.getText(ast) === '"click"') clickHandler = node.getText(ast);
                    ts.forEachChild(node, visit);
                };
                visit(ast);
                assert.ok(clickHandler);
                source += `
export const bindSearchClick = (element, edit, config, closeCB) => {
                    let clickTimeout;
                    const unRefPanelElement = element.querySelector("#searchUnRefPanel");
                    ${clickHandler};
                };`;
            }
            return [name, ts.transpileModule(source, {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
            }).outputText];
        }));
};

const runCases = async modules => {
    const assert = require("node:assert/strict");
    const noop = () => {};
    const constants = new Proxy({}, {get: (_target, key) => key.startsWith("TIMEOUT") ? 0 : key});
    let encrypted = false;
    let folded = false;
    let phablet = false;
    const opened = [];
    const checked = [];
    const stubs = {
        constants: {Constants: constants},
        "util/pathName": {isEncryptedBox: () => encrypted},
        "protyle/util/compatibility": {isPhablet: () => phablet, isNotCtrl: () => true, isIPad: () => false},
        "protyle/util/hotKey": {matchHotKey: (key, event) => key === "right" && event.key === "Right"},
        "search/menu": {getKeysByLiElement: () => ["UG"]},
        "util/noRelyPCFunction": {checkFold: (id, cb) => { checked.push(id); cb(folded); }},
        "editor/util": {openFileById: options => opened.push(options)},
    };
    const cache = {};
    const load = name => {
        if (stubs[name]) return stubs[name];
        if (!modules[name]) return new Proxy({}, {get: () => noop});
        if (!cache[name]) {
            cache[name] = {};
            new Function("require", "exports", modules[name] + (name === "search/util" ?
                "\nexports.renderNextSearchMark = renderNextSearchMark;" : name === "protyle/util/onGet" ? "\nexports.focusElementById = focusElementById;" : ""))(
                dependency => load(require("node:path").posix.normalize(require("node:path").posix.dirname(name) + "/" + dependency)), cache[name]);
        }
        return cache[name];
    };
    const {openSearchEditor, renderNextSearchMark, bindSearchClick} = load("search/util");
    const {searchMarkRender} = load("protyle/render/searchMarkRender");
    const {searchKeydown} = load("boot/globalEvent/searchKeydown");
    const host = document.createElement("div");
    host.innerHTML = '<div class="protyle-title"></div><div class="protyle-wysiwyg">' +
        '<div data-node-id="body" data-type="NodeParagraph"><div contenteditable="true">body UG</div></div></div>';
    document.body.append(host);
    const title = host.firstElementChild;
    const protyle = {app: {}, notebookId: "notebook", contentElement: host, element: host,
        block: {rootID: "document", id: "document", showAll: false},
        title: {element: title}, wysiwyg: {element: host.lastElementChild}, observer: {observe: noop, unobserve: noop},
        highlight: {mark: new Highlight(), markHL: new Highlight(), ranges: [],
            styleElement: Object.assign(document.createElement("style"), {textContent: ""})}};
    protyle.highlight.styleElement.dataset.uuid = "search-title-test";
    const panel = document.createElement("div");
    panel.innerHTML = '<div class="b3-dialog__body"><span id="anchor">Search</span><input id="searchInput">' +
        '<div id="searchAssets" class="fn__none"></div><div id="searchUnRefPanel" class="fn__none"></div>' +
        '<div id="searchList"><div class="b3-list-item b3-list-item--focus" data-type="search-item" data-root-id="document" data-node-id="document"></div></div></div>';
    document.body.append(panel);
    let closed = 0;
    window.siyuan = {storage: {LOCAL_FILEPOSITION: {}},
        config: {keymap: {general: {}, editor: {general: {insertRight: "right"}}}},
        menus: {menu: {remove: noop, element: panel.querySelector(".fn__none")}},
        dialogs: [{element: panel, data: {method: 0}, editors: {edit: {protyle}}, destroy: () => closed++}]};
    const selection = document.createRange();
    selection.selectNodeContents(panel.querySelector("#anchor"));
    getSelection().removeAllRanges();
    getSelection().addRange(selection);
    bindSearchClick(panel.querySelector(".b3-dialog__body"), {protyle}, {method: 0}, () => closed++);
    const open = () => openSearchEditor({protyle, rootId: "document", id: "document", cb: () => closed++});
    const assertOpened = (id, search = true) => {
        assert.equal(checked.at(-1), id);
        assert.equal(opened.at(-1).id, id);
        assert.equal(opened.at(-1).action.includes(constants.CB_GET_SEARCH), search);
        assert.ok(!JSON.stringify(window.siyuan.storage).includes("temporary-title"));
    };
    for (const markup of [
        '<div class="protyle-title__input" contenteditable="true">prefix UG</div>',
        '<div data-node-id="temporary-title" data-type="NodeParagraph"><div class="protyle-title__input" contenteditable="true">prefix UG</div></div>',
        '<div data-node-id="temporary-title" data-type="NodeParagraph"><div class="protyle-title__input" contenteditable="true"><span>prefix </span><strong>U</strong><em>G</em></div></div>',
    ]) {
        title.innerHTML = markup;
        protyle.title.editElement = title.querySelector(".protyle-title__input");
        await new Promise(resolve => searchMarkRender(protyle, ["UG"], "document", resolve));
        assert.equal(protyle.highlight.ranges[protyle.highlight.rangeIndex].toString(), "UG");
        for (const key of ["Enter", "Right"]) {
            const before = closed;
            assert.equal(searchKeydown({}, {key, target: panel.querySelector("#searchInput")}), true);
            assertOpened("document");
            assert.equal(closed, before + 1);
            assert.equal(opened.at(-1).position, key === "Right" ? "right" : undefined);
            const saved = window.siyuan.storage.LOCAL_FILEPOSITION.document;
            assert.equal(saved.focusId, "document");
            assert.equal(saved.focusStart, 7);
            assert.equal(saved.focusEnd, 9);
        }
        const beforeDoubleClick = closed;
        panel.querySelector(".b3-list-item").dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 2}));
        assert.equal(closed, beforeDoubleClick + 1);
        assertOpened("document");
        const saved = window.siyuan.storage.LOCAL_FILEPOSITION.document;
        title.innerHTML = markup.replace("temporary-title", "replacement-title");
        protyle.title.editElement = title.querySelector(".protyle-title__input");
        load("protyle/util/onGet").focusElementById(protyle, opened.at(-1).action, saved);
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(getSelection().toString(), "UG");
        assert.ok(protyle.title.editElement.contains(getSelection().anchorNode));
        protyle.observerLoad?.disconnect();
        getSelection().removeAllRanges();
        getSelection().addRange(selection);
        await new Promise(resolve => searchMarkRender(protyle, ["UG"], "document", resolve));
        renderNextSearchMark({id: "document", edit: {protyle}, target: panel.querySelector(".b3-list-item")});
        folded = true;
        await open();
        assertOpened("body");
        assert.equal(opened.at(-1).zoomIn, true);
        assert.equal(window.siyuan.storage.LOCAL_FILEPOSITION.document.focusStart, 5);
        renderNextSearchMark({id: "document", edit: {protyle}, target: panel.querySelector(".b3-list-item")});
        folded = false;
        await open();
        assertOpened("document");
        encrypted = true;
        window.siyuan.storage.LOCAL_FILEPOSITION = {};
        await open();
        assertOpened("document");
        assert.deepEqual(window.siyuan.storage.LOCAL_FILEPOSITION, {});
        encrypted = false;
        phablet = true;
        await open();
        assertOpened("document", false);
        phablet = false;
        protyle.block.scroll = true;
        await open();
        assertOpened("document", false);
        protyle.block.scroll = false;
    }
    host.remove(); panel.remove();
    return "Search title opening cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
            backgroundThrottling: false}});
        try {
            await win.loadURL("about:blank");
            console.log(await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources())})`));
            win.destroy();
            app.exit(0);
        } catch (error) {
            console.error(error);
            win.destroy();
            app.exit(1);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("search opening keeps title identities and selections separate from body blocks", {
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-search-title-"));
        try {
            const args = [__filename, profile];
            if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) args.push("--ozone-platform=headless");
            if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
            const {stdout} = await promisify(execFile)(require("electron"), args, {
                env, windowsHide: true, timeout: 40000,
            });
            assert.match(stdout, /Search title opening cases passed/);
        } finally {
            assert.equal(path.dirname(profile), os.tmpdir());
            assert.ok(path.basename(profile).startsWith("siyuan-search-title-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
