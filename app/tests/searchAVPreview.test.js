const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    return Object.fromEntries(["search/util", "search/avPreview", "protyle/util/onGet", "protyle/render/searchMarkRender"]
        .map(name => [name, ts.transpileModule(readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
        }).outputText]));
};

const runCases = async modules => {
    const assert = require("node:assert/strict");
    const tick = () => new Promise(resolve => setTimeout(resolve, 20));
    const noop = () => {};
    const constants = new Proxy({}, {get: (_target, key) => key.startsWith("TIMEOUT") ? 0 : key});
    window.siyuan = {config: {editor: {dynamicLoadBlocks: 64}}, languages: {}};
    const initialRenders = [];
    const targetRenders = [];
    const targets = [];
    const requests = new WeakMap();
    let scrollAnchor;
    let keyword = "needle";
    let shape = "av__row";
    let status = "visible";
    let absentField = false;
    const stubs = {
        constants: {Constants: constants},
        "util/fetch": {
            fetchPost(url, data, cb) {
                if (url === "/api/block/getDocInfo") {
                    cb({code: 0, data: {ial: {}}});
                } else if (url === "/api/filetree/getDoc") {
                    cb({code: 0, data: {id: "database", mode: 3, rootID: "document", keywords: [keyword],
                        content: '<div class="av" data-type="NodeAttributeView" data-node-id="database"><div></div></div>'}});
                } else {
                    assert.fail(`Unexpected request: ${url}`);
                }
            },
            async fetchSyncPost(url) {
                assert.equal(url, "/api/av/getAttributeViewSearchTarget");
                targets.push(keyword);
                return {code: 0, data: {itemID: "last-page-row", matchedKeyID: "notes", viewID: "other-view"}};
            },
        },
        "util/pathName": {isEncryptedBox: () => false},
        "util/noRelyPCFunction": {checkFold: (_id, cb) => cb(false)},
        "util/highlightById": {highlightById: () => assert.fail("A visible matched item must not highlight the database block"),
            scrollCenter: (_protyle, element) => { scrollAnchor = element; }},
        "protyle/util/hasClosest": {hasClosestByClassName: (node, name) =>
            (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest("." + name), hasClosestByTag: () => null,
            hasClosestByAttribute: () => null, isInEmbedBlock: () => false},
        "protyle/render/listMindmap/render": {resolveVisibleListMindmapBlock: () => undefined},
        "protyle/render/av/locate": {setAVLocateRequest: (block, request) => requests.set(block, request)},
        "protyle/render/av/render": {
            avRender(element, protyle, cb) {
                const block = element.matches(".av") ? element : element.querySelector(".av");
                if (!cb) {
                    return new Promise(resolve => initialRenders.push(resolve));
                }
                const request = requests.get(block);
                assert.equal(request.itemID, "last-page-row");
                assert.equal(request.keyID, "notes");
                assert.equal(request.select, false);
                assert.equal(request.persistView, false);
                assert.equal(request.viewID, undefined);
                return new Promise(resolve => targetRenders.push(() => {
                    block.innerHTML = '<div class="av__views"><div data-type="av-search">needle toolbar</div></div>' +
                        (status === "visible" ? `<div class="${shape}" data-id="last-page-row">
                            <div data-dtype="block">Row title</div>
                            <div data-col-id="${absentField ? "hidden-other" : "notes"}" data-field-id="${absentField ? "hidden-other" : "notes"}">${absentField ? "no match" : keyword}</div></div>` : "");
                    cb({target: {status}});
                    resolve();
                }));
            },
        },
    };
    const cache = {};
    const load = name => {
        if (stubs[name]) {
            return stubs[name];
        }
        if (!modules[name]) {
            return new Proxy({}, {get: () => noop});
        }
        if (!cache[name]) {
            cache[name] = {};
            new Function("require", "exports", modules[name] + (name === "search/util" ? "\nexports.renderNextSearchMark = renderNextSearchMark;" : ""))(
                dependency => load(require("node:path").posix.normalize(require("node:path").posix.dirname(name) + "/" + dependency)),
                cache[name]);
        }
        return cache[name];
    };
    const {getArticle, renderNextSearchMark} = load("search/util");
    const highlighter = load("protyle/render/searchMarkRender");
    const host = document.createElement("div");
    host.style.cssText = "height:200px;overflow:auto";
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    host.appendChild(editor);
    document.body.appendChild(host);
    const protyle = {element: host, contentElement: host, disabled: false, block: {},
        options: {render: {}}, scroll: {invalidateDynamicLoad: noop},
        wysiwyg: {element: editor, prepareBlockVirtualization: noop},
        highlight: {mark: new Highlight(), markHL: new Highlight(), ranges: [],
            styleElement: Object.assign(document.createElement("style"), {textContent: ""})}};
    protyle.highlight.styleElement.dataset.uuid = "test-search-preview";
    const search = () => getArticle({id: "database", edit: {protyle}, config: {method: 0}, value: keyword});
    for (shape of ["av__row", "av__gallery-item", "av__calendar-item"]) {
        search();
        assert.equal(initialRenders.length, 1);
        const before = targets.length;
        await tick();
        assert.equal(targets.length, before, "target lookup waits for initial database rendering");
        initialRenders.shift()();
        await tick();
        assert.equal(targetRenders.length, 1);
        assert.equal(protyle.highlight.markHL.size, shape === "av__row" ? 0 : 1);
        targetRenders.shift()();
        await tick();
        assert.equal(protyle.highlight.markHL.size, 1);
        const range = [...protyle.highlight.markHL][0];
        assert.equal(range.toString(), "needle");
        assert.ok(range.startContainer.parentElement.closest('[data-id="last-page-row"]'));
        assert.equal(protyle.highlight.ranges.length, 1, "toolbar text does not become a keyword match");
    }
    for (status of ["filtered", "groupHidden"]) {
        search();
        initialRenders.shift()();
        await tick();
        targetRenders.shift()();
        await tick();
        assert.equal(protyle.highlight.markHL.size, 0);
        assert.equal(protyle.highlight.ranges.length, 0);
    }
    status = "visible";
    absentField = true;
    search();
    initialRenders.shift()();
    await tick();
    targetRenders.shift()();
    await tick();
    assert.equal(protyle.highlight.markHL.size, 1);
    assert.equal([...protyle.highlight.markHL][0].startContainer, editor.querySelector('[data-id="last-page-row"]'),
        "hidden fields retain the row as the scroll anchor without exposing their values");
    assert.equal(scrollAnchor, editor.querySelector('[data-id="last-page-row"]'));
    scrollAnchor = undefined;
    renderNextSearchMark({id: "database", edit: {protyle}});
    assert.equal(scrollAnchor, editor.querySelector('[data-id="last-page-row"]'),
        "cycling a match in a hidden field keeps the row as the scroll anchor");

    const before = targets.length;
    search();
    const oldRender = initialRenders.shift();
    search();
    oldRender();
    await tick();
    assert.equal(targets.length, before, "an old render of the same database cannot start a new lookup");
    initialRenders.shift()();
    await tick();
    targetRenders.shift()();
    await tick();

    let valid = true;
    let completed = false;
    highlighter.searchMarkRender(protyle, ["no match"], "database", () => { completed = true; }, {isValid: () => valid});
    valid = false;
    await tick();
    assert.equal(completed, false, "a queued keyword scan cannot overwrite a newer preview");
    host.remove();
    return "Database search preview cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
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
    test("database search preview waits for rendering, locates fields and rejects stale searches", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-search-av-preview-"));
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 40000,
            });
            assert.match(stdout, /Database search preview cases passed/);
        } finally {
            assert.equal(path.dirname(profile), os.tmpdir());
            assert.ok(path.basename(profile).startsWith("siyuan-search-av-preview-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
