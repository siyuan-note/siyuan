const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");

const compile = file => ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;

const cases = async () => {
    const assert = require("node:assert/strict");
    const fold = window.fold;
    const element = document.createElement("div");
    document.body.append(element);
    const listHTML = '<div data-node-id="list" data-type="NodeListItem" fold="1"><div></div><div></div><div></div><div></div></div>';
    const headingHTML = '<div data-node-id="heading" data-type="NodeHeading" data-subtype="h1" fold="1"></div>';
    const protyle = {id: "editor", block: {rootID: "doc"}, wysiwyg: {element}, disabled: true};
    element.innerHTML = listHTML + headingHTML;
    await fold.applyPublishFoldStates(protyle);
    assert.equal(fold.hasViewFoldContext(protyle), true);
    window.blockFold.setFold(protyle, element.firstElementChild);
    assert.equal(element.firstElementChild.hasAttribute("fold"), false);
    await fold.setViewFoldTransient(protyle, element.lastElementChild, false);
    assert.equal(element.lastElementChild.textContent, "child");
    assert.deepEqual(window.requests, ["/api/block/getHeadingChildrenDOM"]);
    const heading = element.querySelector('[data-node-id="heading"]');
    fold.setViewFold(protyle, heading, true);
    assert.equal(element.lastElementChild.classList.contains("fn__none"), true);
    fold.setViewFold(protyle, heading, false);
    assert.equal(element.lastElementChild.classList.contains("fn__none"), false);
    element.innerHTML = listHTML + headingHTML;
    await fold.applyPublishFoldStates(protyle);
    assert.equal(element.firstElementChild.hasAttribute("fold"), false);
    assert.equal(element.lastElementChild.textContent, "child");
    assert.equal(fold.prepareViewFoldTransaction(protyle, [
        {action: "foldHeading", id: "heading"},
        {action: "setAttrs", id: "list", data: JSON.stringify({fold: "1"})},
    ]).doOperations.length, 0);
    protyle.block.rootID = "another";
    element.innerHTML = listHTML + headingHTML;
    await fold.applyPublishFoldStates(protyle);
    assert.equal(element.firstElementChild.getAttribute("fold"), "1");
    let resolve;
    window.readHeading = () => new Promise(done => { resolve = done; });
    const pending = fold.setViewFoldTransient(protyle, element.lastElementChild, false);
    fold.unregisterViewFoldContext(protyle);
    resolve({code: 0, data: headingHTML + '<div data-node-id="late" data-type="NodeParagraph">late</div>'});
    await pending;
    assert.equal(element.querySelector('[data-node-id="late"]'), null);
    window.siyuan.isPublish = false;
    await fold.applyPublishFoldStates(protyle);
    assert.equal(fold.hasViewFoldContext(protyle), false);
    assert.equal(window.transactions.length, 0);
    window.siyuan.isPublish = true;
    element.innerHTML = '<div data-node-id="carrier" data-type="NodeAttributeView" data-av-id="database" custom-sy-av-view="first">' +
        '<div class="layout-tab-bar"><div class="item item--focus" data-id="first"></div><div class="item" data-id="second" data-page="20"></div></div>' +
        '<div data-type="av-group-fold" data-id="a"><svg class="av__group-arrow--open"></svg></div>' +
        '<div data-type="av-group-fold" data-id="b"><svg class="av__group-arrow--open"></svg></div><div class="av__body"></div></div>';
    const carrier = element.firstElementChild;
    const click = (target, altKey = false) => window.avAction.avClick(protyle, {
        target, altKey, preventDefault() {}, stopPropagation() {},
    });
    click(carrier.querySelector('[data-type="av-group-fold"]'));
    click(carrier.querySelector('[data-type="av-group-fold"]'), true);
    const groups = {viewID: "first", view: {groups: [{id: "a", groupFolded: true}, {id: "b", groupFolded: true}]}};
    window.publishAV.applyPublishAVFolds(carrier, groups);
    assert.deepEqual(groups.view.groups.map(group => group.groupFolded), [false, false]);
    click(carrier.querySelector('[data-id="second"]'));
    assert.equal(window.publishAV.getPublishAVView(carrier), "second");
    assert.equal(carrier.getAttribute("custom-sy-av-view"), "second");
    assert.equal(window.avRenders.length, 1);
    assert.equal(window.transactions.length, 0);
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true,
    }});
    let code = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(`
            window.siyuan = {isPublish: true};
            window.requests = []; window.transactions = [];
            window.readHeading = async () => ({code: 0, data:
                '<div data-node-id="heading" data-type="NodeHeading" data-subtype="h1"></div>' +
                '<div data-node-id="child" data-type="NodeParagraph">child</div>'});
            const dependencies = new Proxy({
                applyFocusFold: async () => {},
                normalizeHTMLAssetIFrameBlockDOM: html => html,
                fetchSyncPost: async url => { window.requests.push(url); return window.readHeading(); },
                transaction: (...args) => window.transactions.push(args),
            }, {get: (target, key) => key in target ? target[key] : () => {}});
            window.fold = {};
            new Function("exports", "require", ${JSON.stringify(compile("protyle/util/viewFold.ts"))})(window.fold, () => dependencies);
            window.blockFold = {};
            new Function("exports", "require", ${JSON.stringify(compile("protyle/util/blockFold.ts"))})(
                window.blockFold, name => name === "./viewFold" ? window.fold : dependencies);
            window.publishAV = {};
            new Function("exports", ${JSON.stringify(compile("protyle/render/av/publishState.ts"))})(window.publishAV);
            window.avAction = {}; window.avRenders = [];
            const avDependencies = new Proxy({
                ...window.publishAV,
                Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view", TIMEOUT_COUNT: 1},
                hasClosestBlock: element => element.closest('[data-type="NodeAttributeView"]'),
                hasClosestByClassName: (element, name) => element.closest("." + name),
                transaction: (...args) => window.transactions.push(args),
                getGroupFoldedStates: () => ({a: false, b: false}),
                setAVGroupFolded: (element, folded) => element.firstElementChild.classList.toggle("av__group-arrow--open", !folded),
                avRender: element => window.avRenders.push(element),
            }, {get: (target, key) => key in target ? target[key] : () => {}});
            new Function("exports", "require", ${JSON.stringify(compile("protyle/render/av/action.ts"))})(
                window.avAction, () => avDependencies);
        `);
        await win.webContents.executeJavaScript(`(${cases.toString()})()`);
        console.log("Publish read-only fold cases passed");
    } catch (error) {
        console.error(error);
        code = 1;
    } finally {
        win.destroy();
        app.exit(code);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    const {it} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    it("发布标题和列表折叠不写入，重载保持状态并丢弃过期响应", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-publish-fold-"));
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 40000,
            });
            assert.match(stdout, /Publish read-only fold cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-publish-fold-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
