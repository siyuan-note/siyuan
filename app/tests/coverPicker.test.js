const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async (sources, css, mobile, manifest, languages, image) => {
    const assert = require("node:assert/strict");
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.body.replaceChildren();
    const style = document.createElement("style");
    style.textContent = css + "body {margin:0;} .b3-dialog__container {transition:none;}";
    document.head.replaceChildren(style);
    const menu = {element: document.createElement("div"), remove() {}};
    window.siyuan = {languages, dialogs: [], storage: {}, zIndex: 0, menus: {menu}};
    window.fetch = async url => {
        assert.equal(url, "/appearance/covers/manifest.json");
        return {ok: true, json: async () => manifest};
    };
    const stubs = {
        "util/functions": {isMobile: () => mobile},
        "util/genID": {genUUID: () => "cover-picker"},
        "util/zIndex": {isAbove: () => false},
        "dialog/moveResize": {moveResize() {}},
        "protyle/ui/hideElements": {hideElements() {}},
        "constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
    };
    const cache = {};
    const load = name => {
        if (stubs[name]) {
            return stubs[name];
        }
        if (sources[name + "/index"]) {
            return load(name + "/index");
        }
        if (!sources[name]) {
            return {};
        }
        if (!cache[name]) {
            cache[name] = {};
            const resolve = dependency => load(require("node:path").posix.normalize(
                require("node:path").posix.dirname(name) + "/" + dependency));
            new Function("require", "exports", sources[name])(resolve, cache[name]);
        }
        return cache[name];
    };
    const {Background} = load("protyle/header/Background");
    const owner = document.createElement("div");
    const background = new Background({element: owner, block: {rootID: "cover-document"}, disabled: false});
    owner.append(background.element);
    owner.hidden = true;
    document.body.append(owner);
    background.element.querySelector('[data-type="show-random"]').click();
    await settle();
    const dialog = window.siyuan.dialogs[0];
    assert.ok(dialog, "the built-in cover action opens the production dialog");
    const body = dialog.element.querySelector(".b3-dialog__body");
    const tabs = body.querySelector(".b3-cover__tabs");
    const list = body.querySelector(".b3-cover__cards");
    const loadImages = async () => {
        // 使用实际封面的固有尺寸，检查图片加载后的卡片布局。
        await Promise.all(Array.from(list.querySelectorAll("img"), async element => {
            element.loading = "eager";
            element.src = image;
            await element.decode();
        }));
        await settle();
    };
    const checkGaps = () => {
        const rects = Array.from(list.children, element => element.getBoundingClientRect());
        const columns = rects.findIndex(rect => rect.top > rects[0].top + 1);
        assert.ok(columns > 0, "the cover list has multiple rows");
        const gap = parseFloat(getComputedStyle(list).rowGap);
        assert.ok(gap > 0);
        for (let index = columns; index < rects.length; index++) {
            const actual = rects[index].top - rects[index - columns].bottom;
            assert.ok(Math.abs(actual - gap) < 1, `row ${index}: expected ${gap}px gap, got ${actual}px`);
        }
        assert.ok(list.clientHeight > 100, "the picture region remains usable");
        assert.ok(body.scrollHeight <= body.clientHeight + 1, "the dialog body does not scroll with the picture list");
    };
    assert.equal(list.children.length, manifest.length);
    await loadImages();
    checkGaps();
    const tabsTop = tabs.getBoundingClientRect().top;
    list.scrollTop = list.scrollHeight;
    await settle();
    assert.ok(list.scrollTop > 0);
    assert.equal(tabs.getBoundingClientRect().top, tabsTop, "category navigation stays in place while browsing");
    assert.equal(body.scrollTop, 0);
    assert.ok(list.lastElementChild.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 1,
        "the last row is reachable");

    const category = tabs.children[1];
    category.click();
    await loadImages();
    assert.equal(body.querySelector(".b3-cover__tabs"), tabs);
    assert.equal(body.querySelector(".b3-cover__cards"), list);
    assert.equal(list.scrollTop, 0);
    assert.equal(list.children.length, manifest.filter(cover => cover.category === category.dataset.category).length);
    assert.ok(category.classList.contains("b3-chip--current"));
    checkGaps();
    tabs.firstElementChild.click();
    await loadImages();
    assert.equal(list.children.length, manifest.length);
    checkGaps();
    dialog.destroy();
    await settle();
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true,
    }});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const preprocess = require("ifdef-loader/preprocessor").parse;
        const sass = require("sass");
        const root = path.join(__dirname, "..");
        const manifest = JSON.parse(fs.readFileSync(path.join(root, "appearance/covers/manifest.json"), "utf8"));
        const languages = JSON.parse(fs.readFileSync(path.join(root, "appearance/langs/zh-CN.json"), "utf8"));
        const image = "data:image/webp;base64," + fs.readFileSync(path.join(root, "appearance/covers", manifest[0].file)).toString("base64");
        for (const mobile of [false, true]) {
            const sources = {};
            for (const name of ["protyle/header/Background", "protyle/header/coverData", "dialog/index"]) {
                const source = preprocess(fs.readFileSync(path.join(root, "src", name + ".ts"), "utf8"),
                    {MOBILE: mobile, BROWSER: false}, false, true);
                sources[name] = ts.transpileModule(source, {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
                }).outputText;
            }
            const theme = fs.readFileSync(path.join(root, `appearance/themes/${mobile ? "midnight" : "daylight"}/theme.css`), "utf8");
            const css = theme + sass.compile(path.join(root, `src/assets/scss/${mobile ? "mobile" : "base"}.scss`), {
                logger: sass.Logger.silent,
            }).css;
            for (const [width, height] of mobile ? [[390, 700], [320, 568]] : [[1280, 800], [894, 529]]) {
                win.setContentSize(width, height);
                await win.loadURL("data:text/html,<html><body></body></html>");
                await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)},
                    ${JSON.stringify(css)}, ${mobile}, ${JSON.stringify(manifest)}, ${JSON.stringify(languages)}, ${JSON.stringify(image)})`);
            }
        }
        console.log("Cover picker layout cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").it("keeps cover rows separated and category navigation fixed on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-cover-picker-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Cover picker layout cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-cover-picker-"));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
