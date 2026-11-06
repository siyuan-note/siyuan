const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    const modules = {};
    for (const name of ["protyle/wysiwyg/backlinkReference", "protyle/wysiwyg/renderBacklink", "protyle/util/clear",
        "protyle/render/av/backlinkReuse", "protyle/render/backlinkImageReuse", "protyle/render/imageResize",
        "protyle/render/imageDisplay", "protyle/render/imageTitle",
        "protyle/breadcrumb/appearance", "util/escape", "asset/html"]) {
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
    window.siyuan = {config: {editor: {backlinkHideReference: false, displayImgAlt: true, displayImgName: true}},
        languages: {title: "Title", rename: "Rename"}};
    const cache = {};
    const noop = () => {};
    const stubs = {
        "protyle/wysiwyg/backlinkTypeFold": {setBacklinkTypeFoldExpandHandler: noop, updateBacklinkTypeFolds: noop},
        "protyle/ui/initUI": {removeLoading: noop},
        "protyle/util/processCode": {processRender: root => load("protyle/render/imageDisplay").renderImageDisplay(root)},
        "util/pathName": {getAssetName: () => "sample", getAssetExtension: () => ".png"},
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
    const {renderBacklink} = load("protyle/wysiwyg/renderBacklink");
    const lute = window.Lute.New();
    lute.SetBlockRef(true);
    document.body.innerHTML = '<button id="outside">outside</button><div id="editor"><div class="protyle-wysiwyg" contenteditable="true"></div></div>';
    const element = document.querySelector(".protyle-wysiwyg");
    const protyle = {element: document.querySelector("#editor"), options: {backlinkData: []}, block: {}, wysiwyg: {element}};
    const template = document.createElement("template");
    const data = {id: "images", revision: "initial", expand: true, blockPaths: []};
    const {bindImageResize} = load("protyle/render/imageResize");
    const dispose = bindImageResize(element);
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    template.innerHTML = lute.Md2BlockDOM('![first](assets/sample.png "caption") ![second](assets/sample.png)\n\n![third](assets/sample.png)');
    const imageData = {...data, id: "images", dom: template.innerHTML};
    await renderBacklink(protyle, [imageData]);
    await settle();
    const images = Array.from(element.querySelectorAll(".img"));
    const frames = images.map(image => image.querySelector(".protyle-image-resize"));
    assert.equal(images.length, 3);
    let configurations = 0;
    images.forEach(image => {
        const classes = image.querySelector("img").parentElement.classList;
        const add = classes.add.bind(classes);
        classes.add = (...tokens) => { configurations++; add(...tokens); };
    });
    await renderBacklink(protyle, [{...imageData, revision: "updated-text", dom: imageData.dom.replace("</div>", "updated</div>")}]);
    await settle();
    Array.from(element.querySelectorAll(".img")).forEach((image, index) => assert.equal(image, images[index],
        "changing other context text preserves each image within its own block and ordinal"));
    Array.from(element.querySelectorAll(".protyle-image-resize")).forEach((frame, index) => assert.equal(frame, frames[index]));
    assert.equal(configurations, 0, "moving unchanged images preserves initialized resize controls");
    const expectedMarkdown = lute.BlockDOM2StdMd(element.innerHTML);
    await renderBacklink(protyle, [{...imageData, revision: "restored-text"}]);
    await settle();
    Array.from(element.querySelectorAll(".img")).forEach((image, index) => assert.equal(image, images[index]));
    assert.notEqual(lute.BlockDOM2StdMd(element.innerHTML), expectedMarkdown, "the surrounding text still updates");
    for (const [attribute, value] of [["src", "assets/new.png"], ["alt", "new alt"], ["data-title", "new title"], ["style", "width: 120px;"]]) {
        template.innerHTML = imageData.dom;
        template.content.querySelector("img").setAttribute(attribute, value);
        await renderBacklink(protyle, [{...imageData, revision: attribute, dom: template.innerHTML}]);
        await settle();
        assert.notEqual(element.querySelector(".img"), images[0], `${attribute} changes replace the image`);
        assert.equal(element.querySelector("img").getAttribute(attribute), value);
        assert.equal(element.querySelectorAll(".img")[1], images[1], "the other image in the same block is reused");
        assert.equal(element.querySelectorAll(".img")[2], images[2], "the other block is reused");
    }
    await renderBacklink(protyle, [{...imageData, revision: "duplicate-a"}, {...imageData, id: "duplicate", revision: "duplicate-b"}]);
    await settle();
    const copies = Array.from(element.querySelectorAll(".img"));
    assert.equal(new Set(copies).size, 6, "the same source block in separate occurrences has independent images");
    await renderBacklink(protyle, [{...imageData, revision: "duplicate-a2"}, {...imageData, id: "duplicate", revision: "duplicate-b2"}]);
    await settle();
    Array.from(element.querySelectorAll(".img")).forEach((image, index) => assert.equal(image, copies[index]));
    template.innerHTML = imageData.dom;
    template.content.querySelector(".img").style.width = "120px";
    await renderBacklink(protyle, [{...imageData, revision: "width", dom: template.innerHTML}]);
    await settle();
    assert.notEqual(element.querySelector(".img"), copies[0], "saved container widths invalidate reuse");
    assert.equal(element.querySelector(".img").style.width, "120px");
    const removedImage = element.querySelectorAll(".img")[1];
    removedImage.remove();
    await renderBacklink(protyle, [{...imageData, revision: "detached", dom: template.innerHTML}]);
    await settle();
    assert.notEqual(element.querySelectorAll(".img")[1], removedImage, "detached image records cannot reinsert stale nodes");
    const {captureBacklinkImageSources} = load("protyle/render/backlinkImageReuse");
    for (const [className, type] of [["av", "NodeAttributeView"], ["", "NodeBlockQueryEmbed"], ["protyle-wysiwyg__embed", "preview"]]) {
        const dynamic = document.createElement("div");
        dynamic.className = className;
        dynamic.dataset.type = type;
        dynamic.innerHTML = imageData.dom;
        assert.equal(captureBacklinkImageSources([dynamic]).size, 0, "dynamic database and embed image content is not reused");
    }
    await renderBacklink(protyle, []);
    await settle();
    assert.equal(element.querySelector(".img"), null, "deleted occurrences release their images");
    dispose();
    return "Backlink image reuse cases passed";
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
    it("backlink refresh reuses unchanged image controls and replaces changed image sources", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-backlink-image-reuse-"));
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 40000,
            });
            assert.match(stdout, /Backlink image reuse cases passed/);
        } finally {
            assert.equal(path.dirname(profile), os.tmpdir());
            assert.ok(path.basename(profile).startsWith("siyuan-backlink-image-reuse-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
