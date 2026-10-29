const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const compile = source => ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;
const declarations = (file, names) => {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    return source.statements.filter(statement => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => names.includes(item.name.getText(source))))
        .map(statement => statement.getText(source)).join("\n");
};

const browserCases = async (sources, entries, themes) => {
    const check = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const styles = document.createElement("style");
    const custom = document.createElement("style");
    document.head.append(styles, custom);
    document.body.style.background = "var(--b3-theme-background, #fff)";
    const host = document.createElement("div");
    host.style.cssText = "position:relative;width:300px;height:200px;margin:16px;display:flex;align-items:center;justify-content:space-evenly";
    document.body.append(host);
    const spinnerHTML = '<span class="b3-loading" aria-hidden="true"></span>';
    for (const [entry, css] of Object.entries(entries)) {
        for (const theme of ["light", "dark", "startup"]) {
            styles.textContent = css + (themes[theme] || "");
            host.innerHTML = '<span class="b3-loading b3-loading--small" aria-hidden="true"></span>' + spinnerHTML +
                '<span class="b3-loading b3-loading--large" aria-hidden="true"></span>';
            const spinners = Array.from(host.children);
            const spinner = spinners[1];
            check.deepEqual(spinners.map(element => element.getBoundingClientRect().width), [16, 32, 48]);
            check.deepEqual(spinners.map(element => element.getBoundingClientRect().height), [16, 32, 48]);
            check.equal(spinner.childElementCount, 0);
            const foreground = document.createElement("div");
            foreground.style.color = "var(--b3-theme-on-surface, #808080)";
            host.append(foreground);
            check.equal(getComputedStyle(spinner).color, getComputedStyle(foreground).color);
            foreground.remove();
            check.match(getComputedStyle(spinner, "::before").backgroundImage, /conic-gradient/);
            check.notEqual(getComputedStyle(spinner, "::before").maskImage, "none");
            const first = getComputedStyle(spinner, "::before").transform;
            await wait(100);
            check.notEqual(getComputedStyle(spinner, "::before").transform, first, `${entry}/${theme}: animates`);
            await ipcRenderer.invoke("capture-loading", `${entry}-${theme}`);
            custom.textContent = ".b3-loading{--b3-loading-size:24px;--b3-loading-color:#345678;--b3-loading-width:3px;--b3-loading-duration:2s}";
            check.deepEqual(spinners.map(element => element.getBoundingClientRect().width), [24, 24, 24]);
            check.equal(getComputedStyle(spinner).color, "rgb(52, 86, 120)");
            check.equal(getComputedStyle(spinner, "::before").animationDuration, "2s");
            check.match(getComputedStyle(spinner, "::before").maskImage, /3\.3px/);
            custom.textContent += ".b3-loading::before{border:0;border-radius:0;background:currentColor;mask:none;-webkit-mask:none;animation:none}" +
                '.b3-loading::after{content:"";position:absolute;width:4px;height:4px;background:currentColor}';
            check.equal(getComputedStyle(spinner, "::before").animationName, "none");
            check.equal(getComputedStyle(spinner, "::before").maskImage, "none");
            check.equal(getComputedStyle(spinner, "::before").backgroundColor, "rgb(52, 86, 120)");
            check.equal(getComputedStyle(spinner, "::after").content, '""');
            check.equal(spinner.childElementCount, 0, "themes can replace the graphic without changing markup");
            custom.textContent = "";
            host.classList.add("fn__none");
            check.equal(spinner.getClientRects().length, 0);
            host.classList.remove("fn__none");
        }
    }
    await ipcRenderer.invoke("loading-media", [{name: "prefers-reduced-motion", value: "reduce"}]);
    check.equal(matchMedia("(prefers-reduced-motion: reduce)").matches, true);
    check.equal(getComputedStyle(host.querySelector(".b3-loading"), "::before").animationName, "none");
    await ipcRenderer.invoke("loading-media", [{name: "forced-colors", value: "active"}]);
    const forced = getComputedStyle(host.querySelector(".b3-loading"), "::before");
    check.equal(forced.maskImage, "none");
    check.equal(forced.backgroundImage, "none");
    check.equal(forced.borderTopWidth, "2px");
    await ipcRenderer.invoke("loading-media", []);

    const progress = {};
    new Function("exports", sources.progress)(progress);
    window.siyuan = {zIndex: 1};
    for (const entry of ["base", "mobile"]) {
        for (const theme of ["light", "dark"]) {
            styles.textContent = entries[entry] + themes[theme];
            host.replaceChildren();
            progress.progressLoading({code: 1, msg: "Rebuilding index, please wait..."});
            const panel = document.querySelector(".b3-dialog__loading");
            const track = panel.querySelector('[role="progressbar"]');
            const bar = track.firstElementChild;
            const bounds = panel.getBoundingClientRect();
            check.ok(bounds.left >= 16 && bounds.right <= innerWidth - 16);
            check.ok(bounds.top >= 16 && bounds.bottom <= innerHeight - 16);
            check.ok(Math.abs(bounds.x + bounds.width / 2 - innerWidth / 2) < 1);
            check.equal(getComputedStyle(track).color, getComputedStyle(panel).color);
            check.notEqual(getComputedStyle(track).backgroundColor, "rgb(255, 255, 255)");
            const first = getComputedStyle(bar, "::before").transform;
            await wait(100);
            check.notEqual(getComputedStyle(bar, "::before").transform, first, `${entry}/${theme}: progress animates`);
            await ipcRenderer.invoke("capture-loading", `progress-${entry}-${theme}`);
            custom.textContent = ":root{--b3-loading-color:#345678;--b3-loading-duration:2s}";
            check.equal(getComputedStyle(track).color, "rgb(52, 86, 120)");
            check.equal(getComputedStyle(bar, "::before").animationDuration, "2s");
            custom.textContent = "";
            await ipcRenderer.invoke("loading-media", [{name: "prefers-reduced-motion", value: "reduce"}]);
            check.equal(getComputedStyle(bar, "::before").animationName, "none");
            const segment = bar.getAnimations({subtree: true});
            check.equal(segment.length, 0);
            await ipcRenderer.invoke("loading-media", [{name: "forced-colors", value: "active"}]);
            check.equal(getComputedStyle(bar, "::before").backgroundImage, "none");
            check.notEqual(getComputedStyle(bar, "::before").backgroundColor, "rgba(0, 0, 0, 0)");
            await ipcRenderer.invoke("loading-media", []);
            progress.progressLoading({code: 0, msg: "Rebuilding index", data: {current: 42, total: 100}});
            check.equal(document.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"), "42");
            check.equal(getComputedStyle(document.querySelector(".b3-dialog__progressbar"), "::before").content, "none");
            await ipcRenderer.invoke("capture-loading", `progress-determinate-${entry}-${theme}`);
            progress.progressLoading({code: 2});
        }
    }

    styles.textContent = entries.base + themes.light;
    host.replaceChildren();
    const editor = {};
    new Function("exports", "Constants", "sanitizeKernelHTML", sources.editor)(editor,
        {TIMEOUT_LOAD: 20}, text => text);
    const protyle = {element: host};
    editor.addLoading(protyle, "Loading");
    editor.removeLoading(protyle);
    await wait(40);
    check.equal(host.querySelector(".b3-loading"), null, "fast operations do not flash a loader");
    editor.addLoading(protyle, "Loading");
    await wait(40);
    check.ok(host.querySelector(".wysiwygLoading .b3-loading"));
    check.equal(host.textContent.trim(), "Loading");
    editor.removeLoading(protyle);
    check.equal(host.querySelector(".b3-loading"), null);
    check.equal(host.dataset.loading, "finished");

    styles.textContent = entries.mobile + themes.light;
    window.siyuan = {languages: {}, config: {readonly: false, tag: {sort: 0}}};
    for (const name of ["MobileBookmarks", "MobileTags"]) {
        const requests = [];
        const exports = {};
        const modules = {
            "../../layout/dock/panelSearch": {bindPanelSearch() {}},
            "../../util/fetch": {fetchPost: (_url, _data, callback) => requests.push(callback)},
            "../../constants": {Constants: {SIYUAN_APPID: "loading-test"}},
            "../../layout/dock/tagFilter": {getTagFilterKeywords: () => []},
            "../../util/Tree": {Tree: class {
                updateData() {}
                getExpandIds() { return []; }
                collapseAll() {}
                setExpandIds() {}
            }},
        };
        new Function("require", "exports", sources[name])(module => modules[module] || {}, exports);
        const panel = new exports[name]({}, host);
        const loading = host.lastElementChild;
        check.ok(loading.matches(".fn__loading"));
        check.ok(loading.querySelector(".b3-loading"));
        const bounds = loading.getBoundingClientRect();
        const indicator = loading.querySelector(".b3-loading").getBoundingClientRect();
        check.ok(Math.abs(indicator.x + indicator.width / 2 - bounds.x - bounds.width / 2) < 1);
        check.ok(Math.abs(indicator.y + indicator.height / 2 - bounds.y - bounds.height / 2) < 1);
        panel.update();
        requests.shift()({data: []});
        check.equal(getComputedStyle(loading).display, "flex", "queued refresh keeps the indicator visible");
        requests.shift()({data: []});
        check.equal(getComputedStyle(loading).display, "none", "mobile completion hides the outer container");
        panel.update();
        check.equal(getComputedStyle(loading).display, "flex");
        requests.shift()({data: []});
        check.equal(getComputedStyle(loading).display, "none");
    }

    host.innerHTML = '<div id="packages">' + sources.bazaarLoader + "<img data-content-image>" + spinnerHTML + "</div>";
    const messages = [];
    const bazaar = new Function("element", "BAZAAR_PACKAGE_CONFIG", "showMessage", sources.bazaar)(host,
        {plugins: {panelID: "packages"}}, message => messages.push(message));
    bazaar._onBazaar({code: 1, msg: "Failed"}, "plugins", {});
    check.equal(host.querySelector('[data-type="img-loading"]'), null, "marketplace errors remove the CSS loader container");
    check.ok(host.querySelector("[data-content-image]"));
    check.ok(host.querySelector(".b3-loading"), "unrelated indicators remain intact");
    check.deepEqual(messages, ["Failed"]);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.disableHardwareAcceleration();
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 380, height: 280,
            webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
        const watchdog = setTimeout(() => app.exit(1), 50000);
        try {
            const entries = Object.fromEntries(["base", "mobile", "export"].map(name => [name,
                require("sass").compile(path.join(__dirname, `../src/assets/scss/${name}.scss`),
                    {logger: require("sass").Logger.silent}).css]));
            const themes = {light: read("appearance/themes/daylight/theme.css"), dark: read("appearance/themes/midnight/theme.css")};
            const bazaarText = read("src/config/bazaar.ts");
            const bazaarAST = ts.createSourceFile("bazaar.ts", bazaarText, ts.ScriptTarget.Latest, true);
            const bazaarObject = bazaarAST.statements.find(statement => ts.isVariableStatement(statement) &&
                statement.declarationList.declarations.some(item => item.name.getText(bazaarAST) === "bazaar"))
                .declarationList.declarations[0].initializer;
            const method = bazaarObject.properties.find(property => property.name?.getText(bazaarAST) === "_onBazaar");
            const sources = {
                progress: compile(read("src/dialog/progress.ts")),
                editor: compile(declarations("src/protyle/ui/initUI.ts", ["addLoading", "removeLoading"])),
                MobileBookmarks: compile(read("src/mobile/dock/MobileBookmarks.ts")),
                MobileTags: compile(read("src/mobile/dock/MobileTags.ts")),
                bazaar: compile(`const bazaar = {element, _isBazaarRequestCurrent: () => true, ${method.getText(bazaarAST)}};`) + "return bazaar;",
                bazaarLoader: bazaarText.match(/<div data-type="img-loading"[^>]*>[\s\S]*?<\/div>/)[0],
            };
            win.webContents.debugger.attach("1.3");
            ipcMain.handle("loading-media", (_event, features) => win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {features}));
            ipcMain.handle("capture-loading", async (_event, name) => {
                if (!process.env.SIYUAN_LOADING_SCREENSHOTS) return;
                // 隐藏窗口切换整张样式表后，等待离屏绘制完成再保存截图。
                await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
                await new Promise(resolve => setTimeout(resolve, 200));
                fs.mkdirSync(process.env.SIYUAN_LOADING_SCREENSHOTS, {recursive: true});
                fs.writeFileSync(path.join(process.env.SIYUAN_LOADING_SCREENSHOTS, `${name}.png`), (await win.webContents.capturePage()).toPNG());
            });
            await win.loadURL("about:blank");
            await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
                features: [{name: "prefers-reduced-motion", value: "no-preference"}],
            });
            await win.webContents.executeJavaScript(`(${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(entries)}, ${JSON.stringify(themes)})`);
            console.log("Verified loading themes, customization, accessibility, editor timing, mobile refresh and marketplace failure");
            win.destroy();
            clearTimeout(watchdog);
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
    test("loading indicators share CSS on desktop, mobile and export and preserve lifecycle behavior", {timeout: 60000}, async () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-loading-indicator-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const result = await promisify(execFile)(require("electron"), [__filename, temporary],
                {env, windowsHide: true, timeout: 55000});
            assert.match(result.stdout, /Verified loading themes/);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            fs.rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });

    test("built-in loading indicators no longer request external spinner images", () => {
        const walk = directory => fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry =>
            entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
        for (const file of walk(path.join(__dirname, "../src"))) {
            if (!/\.(ts|tpl)$/.test(file) || file.endsWith(".test.ts")) continue;
            assert.doesNotMatch(fs.readFileSync(file, "utf8"), /loading(?:-pure)?\.svg/, file);
        }
    });
}
