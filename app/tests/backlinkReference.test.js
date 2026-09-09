const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    const modules = {};
    for (const name of ["protyle/wysiwyg/backlinkReference", "protyle/wysiwyg/renderBacklink", "protyle/util/clear"]) {
        modules[name] = ts.transpileModule(readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
        }).outputText;
    }
    return {
        modules,
        css: require("sass").compile(path.join(__dirname, "../src/assets/scss/protyle/_wysiwyg.scss")).css,
        lute: readFileSync(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js"), "utf8"),
    };
};

const runCases = async ({modules, css, lute: luteSource}) => {
    const assert = require("node:assert/strict");
    const script = document.createElement("script");
    script.textContent = luteSource;
    document.head.appendChild(script);
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    window.siyuan = {config: {editor: {backlinkHideReference: false}}};
    const cache = {};
    const noop = () => {};
    const stubs = {
        "protyle/ui/initUI": {removeLoading: noop},
        "protyle/util/processCode": {processRender: noop},
        "protyle/render/highlightRender": {highlightRender: noop},
        "protyle/render/av/backlink": {prepareBacklinkAV: noop},
        "protyle/render/av/render": {avRender: async () => {}},
        "protyle/render/blockRender": {blockRender: noop},
        "protyle/util/viewFold": {clearViewFoldDefaults: noop, applyViewFoldStates: async () => {},
            markViewFoldDefault: noop, clearViewFoldOccurrenceState: noop},
        "constants": {Constants: {CUSTOM_RIFF_DECKS: "custom-riff-decks"}},
        "protyle/wysiwyg/blockSelection": {BLOCK_SELECTION_MODE_CLASS: "protyle-wysiwyg--select-mode"},
    };
    const load = name => {
        if (!modules[name]) {
            return stubs[name] || {};
        }
        if (!cache[name]) {
            cache[name] = {};
            new Function("require", "exports", modules[name])(
                dependency => load(require("node:path").posix.normalize(require("node:path").posix.dirname(name) + "/" + dependency)),
                cache[name]);
        }
        return cache[name];
    };
    const {renderBacklink, getBacklinkHeadingMore} = load("protyle/wysiwyg/renderBacklink");
    const {updateBacklinkReferenceVisibility} = load("protyle/wysiwyg/backlinkReference");
    const {clearBlockElement} = load("protyle/util/clear");
    const lute = window.Lute.New();
    lute.SetBlockRef(true);
    document.body.innerHTML = '<button id="outside">outside</button><div id="editor"><div class="protyle-wysiwyg" contenteditable="true"></div></div>';
    const element = document.querySelector(".protyle-wysiwyg");
    const protyle = {element: document.querySelector("#editor"), options: {backlinkData: []}, block: {}, wysiwyg: {element}};
    const template = document.createElement("template");
    template.innerHTML = lute.Md2BlockDOM('- ((20240101000000-abcdefg "A")) ((20240101000001-abcdefg "B"))\n  - content');
    const referenceID = template.content.querySelector('[data-type="NodeParagraph"]').dataset.nodeId;
    const data = {id: "parent", revision: "one", referenceBlockID: referenceID, dom: template.innerHTML, expand: true, blockPaths: []};
    await renderBacklink(protyle, [data]);
    const reference = () => element.querySelector(`[data-node-id="${referenceID}"]`);
    const visible = node => getComputedStyle(node).display !== "none";
    assert.equal(visible(reference()), true, "the default preserves reference blocks");
    const before = lute.BlockDOM2StdMd(element.innerHTML);
    window.siyuan.config.editor.backlinkHideReference = true;
    updateBacklinkReferenceVisibility(protyle);
    assert.equal(visible(reference()), false, "the option applies without a context revision change");
    const parentAction = () => reference().parentElement.querySelector(":scope > .protyle-action");
    const childList = () => reference().parentElement.querySelector(":scope > .list");
    assert.equal(visible(parentAction()), false, "the hidden reference must not leave a parent bullet");
    assert.equal(getComputedStyle(childList()).marginLeft, "0px", "child content loses the hidden parent indentation");
    assert.equal(visible(childList().querySelector(".protyle-action")), true, "the child keeps its own bullet");
    assert.equal(element.querySelectorAll('[data-type="block-ref"]').length, 2, "both references remain in the editor DOM");
    element.focus();
    assert.equal(visible(reference()), true, "editing restores the complete block structure");
    assert.equal(visible(parentAction()), true, "editing restores the parent bullet");
    assert.equal(getComputedStyle(childList()).marginLeft, "34px", "editing restores the parent indentation");
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    assert.match(selection.getRangeAt(0).toString(), /A[\s\S]*B[\s\S]*content/, "cross-block selection retains the reference nodes");
    selection.removeAllRanges();
    document.querySelector("#outside").focus();
    assert.equal(visible(reference()), false, "leaving the editor restores the preference");
    assert.equal(lute.BlockDOM2StdMd(element.innerHTML), before, "display state cannot remove source references");
    const clone = reference().parentElement.cloneNode(true);
    clearBlockElement(clone);
    assert.equal(clone.querySelector("[data-backlink-reference]"), null, "runtime markers are removed before serialization");
    assert.equal(clone.hasAttribute("data-backlink-reference-list"), false, "list layout markers are removed before serialization");
    assert.equal(clone.querySelectorAll('[data-type="block-ref"]').length, 2, "serialization cleanup retains both references");
    reference().parentElement.setAttribute("fold", "1");
    assert.equal(visible(reference()), true, "folded lists retain their identifying reference");
    assert.equal(visible(parentAction()), true, "folded lists retain their parent bullet");
    reference().parentElement.removeAttribute("fold");
    await renderBacklink(protyle, [data]);
    assert.equal(visible(reference()), false, "unchanged context refresh preserves hiding");
    await renderBacklink(protyle, [{...data, revision: "two", referenceBlockID: undefined}]);
    assert.equal(visible(reference()), true, "changed eligibility removes stale hiding");
    await renderBacklink(protyle, [data]);
    protyle.element.setAttribute("data-ismention", "true");
    updateBacklinkReferenceVisibility(protyle);
    assert.equal(visible(reference()), true, "mentions are unaffected");
    protyle.element.removeAttribute("data-ismention");
    updateBacklinkReferenceVisibility(protyle);
    element.focus();
    reference().firstElementChild.append(" body");
    document.querySelector("#outside").focus();
    assert.equal(visible(reference()), true, "new body text remains visible before the next server response");
    assert.equal(visible(parentAction()), true, "new body text restores the parent bullet");

    template.innerHTML = lute.Md2BlockDOM('# ((20240101000000-abcdefg "A"))\n\nfirst\n\nsecond\n\nthird');
    const headingID = template.content.firstElementChild.dataset.nodeId;
    await renderBacklink(protyle, [{...data, id: "heading", dom: template.innerHTML, referenceBlockID: headingID}]);
    const heading = element.querySelector(`[data-node-id="${headingID}"]`);
    assert.equal(visible(heading), false, "pure reference headings can be hidden");
    getBacklinkHeadingMore(element.querySelector(".protyle-breadcrumb__item"));
    assert.equal(visible(heading), false, "expanding heading content does not reveal the hidden reference");
    assert.equal(visible(element.lastElementChild), true, "expanded content is visible");
    window.siyuan.config.editor.backlinkHideReference = false;
    updateBacklinkReferenceVisibility(protyle);
    assert.equal(visible(heading), true, "disabling the option restores references immediately");
    return "Backlink reference visibility cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true,
        }});
        let code = 0;
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            win.webContents.debugger.attach("1.3");
            await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
            console.log(await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources())})`));
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    const {it} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    it("hides propagated references without losing editable source content", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-backlink-reference-"));
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 40000,
            });
            assert.match(stdout, /Backlink reference visibility cases passed/);
        } finally {
            assert.equal(path.dirname(profile), os.tmpdir());
            assert.ok(path.basename(profile).startsWith("siyuan-backlink-reference-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
