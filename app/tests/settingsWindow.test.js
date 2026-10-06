const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const loadRendererModule = (source, modules) => {
    const exports = {};
    new Function("require", "exports", source)(name => {
        if (!modules[name]) throw new Error("unexpected module: " + name);
        return modules[name];
    }, exports);
    return exports;
};

const rendererModules = (sources) => {
    let sequence = 0;
    window.siyuan = {dialogs: [], zIndex: 1, storage: {zoom: 1}, config: {system: {
        workspaceDir: "D:/workspaces/Workspace A & <B>/", dataDir: "D:/workspaces/Workspace A & <B>/data"}},
        languages: {cancel: "Cancel", save: "Save", config: "Settings", workspace: "Workspace",
        min: "Minimize", max: "Maximize", restore: "Restore", close: "Close"},
        menus: {menu: {element: document.createElement("div"), remove() {}}}, ws: {app: {plugins: [], appId: "test"}}};
    const genUUID = () => "test-" + Date.now() + "-" + (++sequence);
    const {Dialog} = loadRendererModule(sources.dialog, {
        "../block/panelOwnership": {getDialogBlockPanel() {}, destroyDialogBlockPanels() {}},
        "../util/genID": {genUUID}, "../util/zIndex": {isAbove: () => false}, "./moveResize": {moveResize() {}},
        "../util/functions": {isMobile: () => false}, "../protyle/util/compatibility": {isNotCtrl: () => true},
        "../constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}},
    });
    const context = {isSettingsWindow: () => document.body.classList.contains("body--settings")};
    const {ipcRenderer} = require("electron");
    const controls = loadRendererModule(sources.controls, {
        electron: {ipcRenderer}, "../constants": {Constants: {SIYUAN_CMD: "siyuan-cmd", LOCAL_ZOOM: "zoom"}},
        "../util/functions": {setToolbarLeftMac() {}},
    });
    document.body.classList.toggle("body--win32", process.platform !== "darwin");
    const fit = loadRendererModule(sources.fit, {
        "../../boot/windowControls": controls, "../../protyle/util/compatibility": {isMac: () => process.platform === "darwin"},
    });
    const frontend = loadRendererModule(sources.frontend, {
        "./hostCapabilities": {getHostCapabilities: () => ({})}, "../editor/pdfAssetLink": {},
    });
    const titles = loadRendererModule(sources.titles, {
        "./escape": {}, "../constants": {Constants: {}}, "./pathName": {pathPosix: () => require("node:path").posix},
    });
    return {Dialog, genUUID, context, fit, controls, frontend, titles};
};

const bootChild = async (sources) => {
    const {ipcRenderer} = require("electron");
    const {waitForSettingsWindowPaint} = loadRendererModule(sources.paint, {});
    const {Dialog, genUUID, context, fit, frontend, titles} = rendererModules(sources);
    require("node:assert/strict").equal(navigator.userAgent.startsWith("SiYuan/"), false);
    require("node:assert/strict").equal(frontend.getFrontend(), "desktop", navigator.userAgent);
    const host = await new Promise(resolve => {
        const token = new URLSearchParams(location.search).get("settingsWindowToken");
        window.opener.dispatchEvent(new CustomEvent("siyuan-settings-host-" + token, {detail: resolve}));
    });
    class Plugin {openSetting() {}}
    const pluginSettings = {};
    new Function("Plugin", "exports", sources.pluginSettings)(Plugin, pluginSettings);
    await waitForSettingsWindowPaint(async () => {
        const theme = document.createElement("link");
        theme.id = "pendingTheme";
        theme.rel = "stylesheet";
        theme.href = "/fixture/pending.css";
        document.head.append(theme);
        const missing = document.createElement("link");
        missing.rel = "stylesheet";
        missing.href = "/fixture/missing.css";
        document.head.append(missing);
        const canceled = document.createElement("link");
        canceled.rel = "stylesheet";
        canceled.href = "/fixture/pending.css?canceled";
        document.head.append(canceled);
        await ipcRenderer.invoke("test-settings-initializing");
        canceled.remove();
        window.siyuan.config.system.workspaceDir = "";
        window.siyuan.config.system.dataDir = "";
        const {openBazaarPath} = loadRendererModule(sources.bazaarPath, {
            path: require("node:path"), "../../util/pathName": {useShell() { throw new Error("child opened a relative path"); }},
            "../setting/windowContext": {getSettingsWindowHost: () => host},
        });
        const callsBefore = window.opener.settingsPaths.length;
        openBazaarPath("plugins", "example");
        openBazaarPath("plugins", "example", true);
        const expected = require("node:path");
        require("node:assert/strict").deepEqual(Array.from(window.opener.settingsPaths.slice(callsBefore), item => Array.from(item)), [
            ["openPath", expected.join("D:/workspaces/Workspace A & <B>/data", "plugins", "example")],
            ["openPath", expected.join("D:/workspaces/Workspace A & <B>/data", "storage", "petal", "example")],
        ]);
        document.title = host.title;
        if (host.plugin) {
            const {Setting} = loadRendererModule(sources.setting, {
                "../util/functions": {isMobile: () => false, getFrontend: frontend.getFrontend},
                "../dialog": {Dialog}, "../config/setting/nativeWindow": {},
                "../config/setting/windowContext": context, "../config/setting/windowDialog": fit,
                "../util/genID": {genUUID},
            });
            host.plugin.mount(options => {
                const setting = new Setting(options);
                options.items.forEach(item => setting.addItem(item));
                setting.open(host.plugin.name);
                return setting.dialog;
            });
            window.addEventListener("unload", () => host.plugin.closed());
        } else {
            const withoutSettings = host.app.plugins.find(plugin => plugin.name === "without-settings");
            require("node:assert/strict").equal(pluginSettings.hasPluginSetting(withoutSettings), true);
            require("node:assert/strict").equal(host.hasPluginSetting(withoutSettings.name), false);
            require("node:assert/strict").equal(titles.getWorkspaceName(), "Workspace");
            require("node:assert/strict").equal(document.title, "Settings - Workspace A & <B>");
            const dialog = new Dialog({content: "<div></div>"});
            fit.fitSettingsWindowDialog(dialog);
            require("node:assert/strict").equal(dialog.element.querySelector("#drag").textContent, document.title);
        }
    });
    const check = require("node:assert/strict");
    await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/stage/protyle/js/protyle-html.js";
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
    });
    check.equal(typeof window.Lute, "undefined");
    const pluginEvents = [];
    const {initTooltips} = loadRendererModule(sources.tooltip, {
        "../util/functions": {isMobile: () => false},
        "../plugin/EventBusCore": {emitToPlugins: name => pluginEvents.push(name),
            forEachPluginSubscriber: (name, callback) => callback({emit: () => pluginEvents.push(name)})},
    });
    const tooltip = document.createElement("div");
    tooltip.id = "tooltip";
    tooltip.className = "tooltip fn__none";
    const button = document.createElement("button");
    button.className = "ariaLabel";
    button.innerHTML = "<svg><use></use></svg>";
    button.setAttribute("aria-label", encodeURIComponent('<b>Directory</b><img src="x" onerror="alert(1)">'));
    button.setAttribute("data-delay", "0");
    button.setAttribute("data-position", "north");
    document.body.append(tooltip, button);
    initTooltips();
    const hover = element => element.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    hover(button.querySelector("use"));
    check.equal(tooltip.classList.contains("fn__none"), false);
    check.equal(tooltip.innerHTML, '<b>Directory</b><img src="x">');
    check.equal(tooltip.style.animationDelay, "0ms");
    check.equal(tooltip.style.pointerEvents, "none");
    check.ok(parseFloat(tooltip.style.left) >= 0);
    check.ok(parseFloat(tooltip.style.top) >= 0);
    button.setAttribute("aria-label", "100% complete");
    hover(button);
    check.equal(tooltip.textContent, "100% complete");
    button.classList.add("b3-tooltips");
    hover(button);
    check.equal(tooltip.classList.contains("fn__none"), true);
    button.classList.remove("b3-tooltips");
    hover(button);
    hover(document.body);
    check.equal(tooltip.classList.contains("fn__none"), true);
    check.ok(pluginEvents.includes("before-show-tooltip"));
    check.ok(pluginEvents.includes("before-hide-tooltip"));
    button.remove();
    const {Setting: NestedSetting} = loadRendererModule(sources.setting, {
        "../util/functions": {isMobile: () => false, getFrontend: frontend.getFrontend}, "../dialog": {Dialog},
        "../config/setting/nativeWindow": {}, "../config/setting/windowContext": context,
        "../config/setting/windowDialog": fit, "../util/genID": {genUUID},
    });
    const rootDialog = window.siyuan.dialogs[0];
    const nested = new NestedSetting({});
    nested.open("Nested settings");
    check.equal(nested.dialog.element.querySelector(".toolbar"), null);
    nested.close();
    check.equal(window.siyuan.dialogs.includes(rootDialog), true);
    if (!document.getElementById("pendingTheme").sheet) throw new Error("settings shown before theme loaded");
    ipcRenderer.send("siyuan-settings-ready");
    ipcRenderer.send("test-settings-ready");
};

const runCases = async (sources) => {
    const assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const {Dialog, genUUID, context, fit, titles} = rendererModules(sources);
    window.settingsPaths = [];
    const bazaarPath = loadRendererModule(sources.bazaarPath, {
        path: require("node:path"), "../../util/pathName": {useShell: (...args) => window.settingsPaths.push(args)},
        "../setting/windowContext": {getSettingsWindowHost: () => undefined},
    });
    class Plugin {openSetting() {}}
    const pluginSettings = {};
    new Function("Plugin", "exports", sources.pluginSettings)(Plugin, pluginSettings);
    const native = loadRendererModule(sources.native, {
        electron: {ipcRenderer}, "../../util/genID": {genUUID}, "../../protyle/util/compatibility": {setStorageVal() {}},
        "../../layout/util": {exportLayout: async options => options.cb()}, "../../dialog/processSystem": {exitSiYuan: async () => {}},
        "../../plugin/globalState": {subscribeGlobalPluginState: () => () => {}, applyPluginReload: async () => {}},
        "../../plugin/loader": {loadPlugin: async () => {}, unloadPlugin: async () => {}},
        "../../boot/globalEvent/globalShortcut": {sendGlobalShortcut() {}, sendUnregisterGlobalShortcut() {}},
        "../../constants": {Constants: {SIYUAN_CMD: "siyuan-cmd"}},
        "../../plugin": pluginSettings,
        "../../util/processTitle": titles,
        "../entryVisibility/dockOrder": {getDockEntryOrderSnapshot: () => ({})},
        "./taskBlocker": {hasNativeSettingTasks: () => false},
        "../bazaar/openPath": bazaarPath,
    });
    const {Setting} = loadRendererModule(sources.setting, {
        "../util/functions": {isMobile: () => false, getFrontend: () => "desktop"}, "../dialog": {Dialog},
        "../config/setting/nativeWindow": native, "../config/setting/windowContext": context,
        "../config/setting/windowDialog": fit, "../util/genID": {genUUID},
    });
    const wait = () => new Promise(resolve => setTimeout(resolve, 50));
    const legacy = new Setting({});
    legacy.open("Legacy");
    assert.equal(legacy.dialog.element.ownerDocument, document);
    legacy.dialog.destroy();
    await wait();

    const toggles = {first: false, second: false};
    const saves = [];
    const {genSwitchRow} = loadRendererModule(sources.fragments, {});
    const markup = () => genSwitchRow("first", "First setting", "Description", toggles.first) +
        genSwitchRow("second", "Second setting", "Description", toggles.second);
    const clickDialog = new Dialog({content: '<div class="config__tab-wrap"><div class="config__tab-container" data-name="editor">' +
        markup() + "</div></div>"});
    clickDialog.element.setAttribute("data-key", "settings");
    let remounted = 0;
    const mounting = loadRendererModule(sources.mount, {
        "../render/render": {}, "../search/normalize": {getSearchKeywordsLower: () => ""},
        "../../constants": {Constants: {DIALOG_SETTING: "settings"}},
        "./tabs": {getSettingTab: () => ({mount: async root => { remounted++; root.innerHTML = markup(); }})},
        "./windowContext": {getSettingsOwnerApp: () => window.siyuan.ws.app},
    });
    const saving = loadRendererModule(sources.save, {
        "./mount": mounting,
        "./item": {getSettingItem: id => ({readValue: input => input.checked, save: value => {
            toggles[id] = value;
            saves.push(id);
            void mounting.remountOpenSettingTab("editor");
        }})},
    });
    window.siyuan.config.readonly = false;
    saving.bindSettingSaveDelegation(clickDialog.element.querySelector(".config__tab-wrap"));
    const clickLabel = async id => {
        const rect = clickDialog.element.querySelector("#" + id).closest("label").getBoundingClientRect();
        await ipcRenderer.invoke("test-settings-pointer", "mouseDown", Math.round(rect.left + 10), Math.round(rect.top + rect.height / 2));
        // 离屏窗口不派发失焦事件，补发与按下标签时相同的事件，保留原生鼠标点击流程。
        document.dispatchEvent(new FocusEvent("focusout"));
        await wait();
        await ipcRenderer.invoke("test-settings-pointer", "mouseUp", Math.round(rect.left + 10), Math.round(rect.top + rect.height / 2));
        await wait();
    };
    await clickLabel("first");
    assert.deepEqual(saves, ["first"]);
    const secondInput = clickDialog.element.querySelector("#second");
    await clickLabel("second");
    assert.deepEqual(saves, ["first", "second"], "each settings label responds to its first physical click");
    assert.equal(clickDialog.element.querySelector("#second"), secondInput, "deferred refresh preserves the pressed label");
    assert.equal(secondInput.checked, true);
    document.activeElement.blur();
    document.dispatchEvent(new FocusEvent("focusout"));
    await wait();
    assert.equal(remounted, 1, "refresh resumes after leaving the input");
    clickDialog.destroy();
    await wait();

    let confirmed = 0;
    let destroyed = 0;
    let created = 0;
    const control = document.createElement("input");
    control.value = "original";
    const panel = document.createElement("div");
    panel.className = "config__panel";
    panel.append(control);
    const setting = new Setting({openInWindow: true, confirmCallback: () => {
        assert.equal(control.value, "changed");
        confirmed++;
    }, destroyCallback: () => destroyed++});
    setting.addItem({title: "Control", createActionElement: () => { created++; return panel; }});
    setting.open("Plugin");
    await ipcRenderer.invoke("test-settings-wait");
    assert.equal(created, 1);
    assert.notEqual(control.ownerDocument, document);
    assert.equal(setting.dialog.element.querySelector("input"), control);
    assert.equal(setting.dialog.element.querySelector(".toolbar #drag").textContent, "Plugin");
    if (process.platform !== "darwin") {
        assert.ok(setting.dialog.element.querySelector("#minWindow"));
        assert.ok(setting.dialog.element.querySelector("#maxWindow"));
        assert.ok(setting.dialog.element.querySelector("#closeWindow"));
        for (const id of ["minWindow", "maxWindow", "restoreWindow"]) {
            setting.dialog.element.querySelector("#" + id).click();
        }
        await wait();
        assert.deepEqual(await ipcRenderer.invoke("test-settings-commands"), ["minimize", "maximize", "restore"]);
    }
    await ipcRenderer.invoke("test-settings-size", 493, 376);
    await wait();
    const childDocument = control.ownerDocument;
    if (process.platform === "win32") {
        const points = ["#drag", "#minWindow", "#maxWindow", "#closeWindow"].map(selector => {
            const rect = childDocument.querySelector(selector).getBoundingClientRect();
            return {x: (rect.left + rect.right) / 2 / childDocument.defaultView.innerWidth,
                y: (rect.top + rect.bottom) / 2 / childDocument.defaultView.innerHeight};
        });
        const hits = await ipcRenderer.invoke("test-settings-hit-test", points);
        assert.deepEqual(hits, [2, 1, 1, 1]);
        for (const state of ["maximized", "fullscreen"]) {
            await ipcRenderer.invoke("test-settings-native-state", state);
            await wait();
            const topPoints = ["#drag", "#minWindow", "#maxWindow", "#closeWindow"].map(selector => {
                const rect = childDocument.querySelector(selector).getBoundingClientRect();
                return {x: (rect.left + rect.right) / 2 / childDocument.defaultView.innerWidth, y: 0};
            });
            assert.deepEqual(await ipcRenderer.invoke("test-settings-hit-test", topPoints),
                [state === "fullscreen" ? 1 : 2, 1, 1, 1], state);
            for (const selector of ["#minWindow", "#maxWindow", "#closeWindow"]) {
                const button = childDocument.querySelector(selector);
                const rect = button.getBoundingClientRect();
                assert.ok(button.contains(childDocument.elementFromPoint((rect.left + rect.right) / 2, 0)), state + selector);
            }
        }
        await ipcRenderer.invoke("test-settings-native-state", "normal");
        await ipcRenderer.invoke("test-settings-size", 493, 376);
        await wait();
    }
    for (const theme of ["daylight", "midnight"]) {
        const link = childDocument.getElementById("fixtureTheme");
        await new Promise(resolve => {
            link.onload = resolve;
            link.href = "/fixture/" + theme + ".css?v=" + Date.now();
        });
        for (const fontSize of [14, 32]) {
            childDocument.documentElement.style.setProperty("--b3-font-size", fontSize + "px");
            const toolbar = setting.dialog.element.querySelector(".toolbar");
            const container = setting.dialog.element.querySelector(".b3-dialog__container");
            const childWindow = childDocument.defaultView;
            assert.equal(childWindow.getComputedStyle(container).borderTopWidth, "0px");
            assert.equal(childWindow.getComputedStyle(panel).borderRadius, "0px");
            assert.equal(childDocument.defaultView.getComputedStyle(toolbar).height, "32px");
            assert.equal(childDocument.defaultView.getComputedStyle(toolbar.querySelector("#drag")).getPropertyValue("-webkit-app-region"), "drag");
            const title = toolbar.querySelector("#drag").getBoundingClientRect();
            assert.ok(Math.abs((title.left + title.right) / 2 - childDocument.defaultView.innerWidth / 2) < 1);
            const range = childDocument.createRange();
            range.selectNodeContents(toolbar.querySelector("#drag"));
            const caption = range.getBoundingClientRect();
            assert.ok(Math.abs((caption.left + caption.right) / 2 - childDocument.defaultView.innerWidth / 2) < 1);
            if (process.platform !== "darwin") {
                for (const state of ["body--maximize", "body--fullscreen"]) {
                    childDocument.body.classList.add(state);
                    for (const id of ["minWindow", "maxWindow", "restoreWindow", "closeWindow"]) {
                        const button = childDocument.getElementById(id);
                        if (!button.getClientRects().length) continue;
                        const rect = button.getBoundingClientRect();
                        assert.equal(rect.top, 0, id + " at screen top in " + state);
                        assert.equal(rect.bottom, toolbar.getBoundingClientRect().bottom -
                            parseFloat(childWindow.getComputedStyle(toolbar).borderBottomWidth));
                        assert.ok(button.contains(childDocument.elementFromPoint((rect.left + rect.right) / 2, 0)));
                    }
                    childDocument.body.classList.remove(state);
                }
                const close = toolbar.querySelector("#closeWindow").getBoundingClientRect();
                assert.ok(close.right <= childDocument.defaultView.innerWidth);
                assert.ok(close.height >= 30);
            }
        }
    }
    setting.open("Plugin");
    await wait();
    assert.equal(created, 1);
    control.value = "changed";
    setting.dialog.element.querySelectorAll(".b3-dialog__action button")[1].click();
    await wait();
    assert.equal(confirmed, 1);
    assert.equal(destroyed, 1);
    assert.equal(setting.dialog, undefined);

    setting.open("Plugin");
    await ipcRenderer.invoke("test-settings-wait");
    if (process.platform === "darwin") setting.close();
    else setting.dialog.element.querySelector("#closeWindow").click();
    await wait();
    assert.equal(confirmed, 1);
    assert.equal(destroyed, 2);
    const withoutSettings = Object.assign(new Plugin(), {name: "without-settings"});
    window.siyuan.ws.app.plugins.push(withoutSettings);
    await native.openNativeSettings(window.siyuan.ws.app, {tab: "appearance"});
    await ipcRenderer.invoke("test-settings-wait");
    const builtinHost = await ipcRenderer.invoke("test-settings-token");
    const host = await new Promise(resolve => {
        window.dispatchEvent(new CustomEvent("siyuan-settings-host-" + builtinHost, {detail: resolve}));
    });
    assert.equal(host.title, "Settings - Workspace A & <B>");
    const legacySetting = new Setting({});
    assert.equal(host.hasPluginSetting("without-settings"), false);
    assert.equal(host.hasPluginSetting("missing"), false);
    const emptyCommands = (await ipcRenderer.invoke("test-settings-commands")).length;
    await host.openPluginSetting("without-settings");
    await wait();
    assert.equal((await ipcRenderer.invoke("test-settings-commands")).length, emptyCommands);
    const configured = Object.assign(new Plugin(), {name: "configured", setting: new Setting({})});
    window.siyuan.ws.app.plugins.push(configured);
    assert.equal(host.hasPluginSetting("configured"), true);
    window.siyuan.ws.app.plugins.push({name: "legacy", openSetting: () => legacySetting.open("Legacy plugin")});
    assert.equal(host.hasPluginSetting("legacy"), true);
    await host.openPluginSetting("legacy");
    assert.equal(legacySetting.dialog.element.ownerDocument, document);
    await wait();
    assert.equal((await ipcRenderer.invoke("test-settings-commands")).at(-1), "show-owner");
    legacySetting.dialog.destroy();
    await wait();
    const modernSetting = new Setting({openInWindow: true});
    window.siyuan.ws.app.plugins.push({name: "modern", openSetting: () => modernSetting.open("Modern plugin")});
    const commandsBefore = (await ipcRenderer.invoke("test-settings-commands")).length;
    await host.openPluginSetting("modern");
    await ipcRenderer.invoke("test-settings-wait");
    assert.notEqual(modernSetting.dialog.element.ownerDocument, document);
    assert.equal((await ipcRenderer.invoke("test-settings-commands")).length, commandsBefore);
    modernSetting.close();
    await wait();
    await native.openNativeSettings(window.siyuan.ws.app, {tab: "editor"});
    assert.equal(await ipcRenderer.invoke("test-settings-window-count"), 1);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, ipcMain, screen} = require("electron");
    const {createServer} = require("node:http");
    const {createSettingsWindows} = require("../electron/settingsWindows");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        let owner;
        let code = 0;
        let ready = 0;
        let waiting;
        const children = new Set();
        const shown = new Set();
        const commands = [];
        const ts = require("typescript");
        const sources = {};
        const styles = require("sass").compile(path.join(__dirname, "../src/assets/scss/base.scss"), {
            logger: {warn() {}, debug() {}},
        }).css;
        const themes = Object.fromEntries(["daylight", "midnight"].map(name => [name,
            fs.readFileSync(path.join(__dirname, "../appearance/themes", name, "theme.css"), "utf8") +
            "\n.config__panel {border-radius: var(--b3-border-radius-b);}\n"]));
        for (const [key, file] of Object.entries({dialog: "dialog/index.ts", setting: "plugin/Setting.ts",
            native: "config/setting/nativeWindow.ts", fit: "config/setting/windowDialog.ts", controls: "boot/windowControls.ts",
            paint: "config/setting/windowPaint.ts", frontend: "util/functions.ts", titles: "util/processTitle.ts",
            mount: "config/setting/mount.ts", save: "config/setting/save.ts", fragments: "config/render/fragments.ts",
            bazaarPath: "config/bazaar/openPath.ts", tooltip: "dialog/tooltip.ts"})) {
            let source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
            if (key === "frontend") {
                source = require("ifdef-loader/preprocessor").parse(source, {MOBILE: false, BROWSER: false}, false, true);
            }
            sources[key] = ts.transpileModule(source, {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
            }).outputText;
        }
        const pluginSource = ts.createSourceFile("plugin/index.ts", fs.readFileSync(path.join(__dirname, "../src/plugin/index.ts"), "utf8"),
            ts.ScriptTarget.ES2021, true);
        const pluginSetting = pluginSource.statements.find(statement => ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(item => item.name.getText(pluginSource) === "hasPluginSetting"));
        sources.pluginSettings = ts.transpileModule(pluginSetting.getText(pluginSource), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
        }).outputText;
        const server = createServer((request, response) => {
            const pathname = new URL(request.url, "http://localhost").pathname;
            if (pathname === "/stage/protyle/js/protyle-html.js") {
                response.setHeader("Content-Type", "text/javascript; charset=utf-8");
                response.end(fs.readFileSync(path.join(__dirname, "../stage/protyle/js/protyle-html.js")));
                return;
            }
            if (pathname.startsWith("/fixture/")) {
                response.setHeader("Content-Type", "text/css; charset=utf-8");
                if (pathname === "/fixture/missing.css") {
                    response.writeHead(404);
                    response.end();
                    return;
                }
                if (pathname === "/fixture/pending.css") {
                    setTimeout(() => response.end(themes.midnight), 200);
                    return;
                }
                response.end(pathname === "/fixture/base.css" ? styles : themes[path.basename(pathname, ".css")]);
                return;
            }
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            const child = request.url.startsWith("/stage/build/app/settings.html");
            if (child && (new URL(request.url, "http://localhost").searchParams.has("token") ||
                !request.headers.cookie?.includes("settings-auth=authenticated"))) {
                response.writeHead(401);
                response.end(JSON.stringify({code: -1, msg: "Auth failed [query token]"}));
                return;
            }
            if (!child) response.setHeader("Set-Cookie", "settings-auth=authenticated; HttpOnly; SameSite=Strict; Path=/");
            response.end(`<html><head><link rel="stylesheet" href="/fixture/base.css"><link id="fixtureTheme" rel="stylesheet" href="/fixture/daylight.css"></head><body class="${child ? "body--settings" : ""}">${child ?
                `<script>const loadRendererModule = ${loadRendererModule.toString()}; const rendererModules = ${rendererModules.toString()}; (${bootChild.toString()})(${JSON.stringify(sources)});</script>` : ""}</body></html>`);
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const origin = "http://127.0.0.1:" + server.address().port;
        const policy = createSettingsWindows({ipcMain, screen, getTarget: id => owner?.webContents.id === id ? {origin, mode: "local"} : undefined,
            initialize: win => {
                win.webContents.userAgent = "SiYuan/fixture Electron " + win.webContents.userAgent;
                win.webContents.on("console-message", details => {
                    if (details.level === "error" && details.message.startsWith("Uncaught")) {
                        console.error(details.message);
                        app.exit(1);
                    }
                });
                children.add(win);
                assert.equal(win.getParentWindow(), null);
                assert.equal(win.isModal(), false);
                if (process.platform !== "darwin") assert.equal(win.isMenuBarVisible(), false);
                assert.equal(win.isVisible(), false);
                win.on("closed", () => { children.delete(win); shown.delete(win); });
            }, show(win) { shown.add(win); }, log() {}});
        ipcMain.handle("test-settings-initializing", event => {
            const win = [...children].find(child => child.webContents === event.sender);
            assert.ok(win);
            assert.equal(shown.has(win), false);
            assert.equal(win.isVisible(), false);
        });
        ipcMain.on("test-settings-ready", event => {
            const win = [...children].find(child => child.webContents === event.sender);
            assert.equal(shown.has(win), true);
            if (waiting) { waiting(); waiting = undefined; } else ready++;
        });
        ipcMain.handle("test-settings-wait", () => ready ? (--ready, Promise.resolve()) : new Promise(resolve => { waiting = resolve; }));
        ipcMain.handle("test-settings-window-count", () => children.size);
        ipcMain.on("siyuan-cmd", (event, command) => {
            if (event.sender === owner.webContents) {
                assert.equal(command, "show");
                commands.push("show-owner");
                return;
            }
            assert.ok([...children].some(child => child.webContents === event.sender));
            commands.push(command);
        });
        ipcMain.handle("test-settings-commands", () => commands);
        ipcMain.handle("test-settings-pointer", (event, type, x, y) => {
            event.sender.sendInputEvent({type, x, y, button: "left", clickCount: 1});
        });
        ipcMain.handle("test-settings-token", () => new URL([...children][0].webContents.getURL()).searchParams.get("settingsWindowToken"));
        ipcMain.handle("test-settings-size", (_event, width, height) => {
            for (const child of children) child.setSize(width, height);
        });
        ipcMain.handle("test-settings-native-state", async (_event, state) => {
            const child = [...children][0];
            const transition = (event, action) => new Promise(resolve => {
                child.once(event, resolve);
                action();
            });
            if (child.isFullScreen()) {
                await transition("leave-full-screen", () => child.setFullScreen(false));
            }
            if (state === "fullscreen") {
                await transition("enter-full-screen", () => child.setFullScreen(true));
            } else if (state === "maximized" && !child.isMaximized()) {
                await transition("maximize", () => child.maximize());
            } else if (state === "normal" && child.isMaximized()) {
                await transition("unmaximize", () => child.unmaximize());
            }
        });
        if (process.platform === "win32") {
            const {promisify} = require("node:util");
            const {execFile} = require("node:child_process");
            ipcMain.handle("test-settings-hit-test", async (_event, points) => {
                const child = [...children][0];
                const buffer = child.getNativeWindowHandle();
                const handle = buffer.length === 8 ? buffer.readBigUInt64LE().toString() : String(buffer.readUInt32LE());
                const {stdout} = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive",
                    "-File", path.join(__dirname, "fixtures/windowHitTest.ps1"), handle, JSON.stringify(points)],
                {windowsHide: true, timeout: 15000});
                return JSON.parse(stdout);
            });
        }
        try {
            owner = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
            owner.webContents.userAgent = "SiYuan/fixture Electron " + owner.webContents.userAgent;
            owner.webContents.setWindowOpenHandler(details => {
                const result = policy(owner.webContents, details);
                return result || {action: "deny"};
            });
            await owner.loadURL(origin + "/stage/build/app/");
            const runRendererCases = () => owner.webContents.executeJavaScript(`const loadRendererModule = ${loadRendererModule.toString()}; const rendererModules = ${rendererModules.toString()}; (${runCases.toString()})(${JSON.stringify(sources)})`);
            await runRendererCases();
            const previousTokens = new Set([...children].map(child => new URL(child.webContents.getURL()).searchParams.get("settingsWindowToken")));
            assert.ok(previousTokens.size > 0);
            const reloaded = new Promise(resolve => owner.webContents.once("did-finish-load", resolve));
            const closedForReload = [...children].map(child => new Promise(resolve => child.once("closed", resolve)));
            owner.reload();
            await Promise.all([reloaded, ...closedForReload]);
            await new Promise(resolve => setTimeout(resolve, 100));
            assert.equal(children.size, 0, "owner reload closes settings without restoring them");
            commands.length = 0;
            ready = 0;
            await runRendererCases();
            assert.ok(children.size > 0, "settings can be manually reopened after owner reload");
            for (const child of children) {
                assert.equal(previousTokens.has(new URL(child.webContents.getURL()).searchParams.get("settingsWindowToken")), false);
            }
            const closed = [...children].map(child => new Promise(resolve => child.once("closed", resolve)));
            owner.destroy();
            await Promise.all(closed);
            assert.equal(children.size, 0);
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            for (const child of children) child.destroy();
            if (owner && !owner.isDestroyed()) owner.destroy();
            server.close();
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("native settings preserve plugin controls, callbacks, default dialogs and owning-window lifecycle", {timeout: 120000}, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-settings-window-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            // 两轮窗口生命周期包含多个原生命中测试子进程，为 CI 启动开销预留时间。
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 110000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
