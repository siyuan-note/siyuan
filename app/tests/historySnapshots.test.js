const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async (sources, css, mobile, dark) => {
    const assert = require("node:assert/strict");
    const path = require("node:path");
    const tick = () => new Promise(resolve => setTimeout(resolve, 80));
    document.body.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = css;
    document.head.replaceChildren(style);
    document.documentElement.dataset.themeMode = dark ? "dark" : "light";
    new Function(sources.icons)();
    const menu = document.createElement("div");
    window.siyuan = {languages: JSON.parse(sources.languages), config: {sync: {provider: 4}}, dialogs: [], storage: {}, zIndex: 100,
        menus: {menu: {element: menu, remove() {}}}};
    const toolbar = document.createElement("div");
    toolbar.className = `history__snapshots${mobile ? " history__snapshots--mobile" : ""}`;
    toolbar.innerHTML = `<button class="b3-button b3-button--text history__snapshot-mobile-control" data-action="filters">Filter</button>
<div class="history__snapshot-date-controls"><button class="b3-button b3-button--outline" type="submit">Filter</button></div>
<button class="b3-button b3-button--text" data-action="purge">Purge</button>
<button class="block__icon block__icon--show history__snapshot-mobile-control" data-action="source-more">More</button>`;
    document.body.append(toolbar);
    const visible = selector => getComputedStyle(toolbar.querySelector(selector)).display !== "none";
    for (const narrow of [false, true]) {
        toolbar.classList.toggle("history__snapshots--narrow", narrow);
        assert.equal(visible('[data-action="filters"]'), mobile, "filter toggle belongs only to mobile");
        assert.equal(visible('[data-action="source-more"]'), mobile, "purge menu belongs only to mobile");
        assert.equal(visible('[data-action="purge"]'), !mobile, "desktop provides the direct purge action");
        assert.equal(visible(".history__snapshot-date-controls"), !mobile, "mobile filters start collapsed");
        toolbar.classList.add("history__snapshots--filters");
        assert.equal(visible(".history__snapshot-date-controls"), true, "expanded mobile filters remain usable");
        toolbar.classList.remove("history__snapshots--filters");
    }
    toolbar.remove();
    const snapshots = [
        {id: "a".repeat(40), fileID: "doc-file", tags: ["发布版本", "阶段归档"], memo: "功能验收完成\n保留此版本用于后续对照", created: 1790557200000},
        {id: "b".repeat(40), fileID: "doc-file", tags: ["周五备份"], memo: "包含相同文档版本", created: 1790470800000},
    ];
    let responseMode = "success";
    let pending;
    let signal;
    const files = [{id: "doc-file", path: "/notebook/project/document.sy"}, ...Array.from({length: 20}, (_, i) => ({id: "file-" + i, path: "/notebook/project/note-" + i + ".sy"}))];
    let nextID = 0;
    const dateSessions = [];
    const stubs = {
        "datePicker/index": {openInternalDatePicker: options => {
            let finish;
            const session = {options, result: new Promise(resolve => { finish = resolve; }),
                confirm: value => finish({type: "confirm", value}),
                destroyed: false, destroy() { this.destroyed = true; finish({type: "cancel", reason: "destroy"}); }};
            dateSessions.push(session);
            return session;
        }},
        "block/panelOwnership": {getDialogBlockPanel() {}, destroyDialogBlockPanels() {}},
        "util/genID": {genUUID: () => String(++nextID)},
        "util/zIndex": {isAbove: () => false},
        "dialog/moveResize": {moveResize() {}},
        "util/functions": {isMobile: () => mobile, getFrontend: () => mobile ? "browser-mobile" : "browser-desktop"},
        "protyle/util/compatibility": {isNotCtrl: () => true, saveExportFile() {}},
        "protyle": {Protyle: class {}},
        "constants": {Constants: {TIMEOUT_DBLCLICK: 0, TIMEOUT_OPENDIALOG: 0, SIYUAN_ASSETS_IMAGE: [], SIYUAN_ASSETS_AUDIO: [], SIYUAN_ASSETS_VIDEO: []}},
        "asset/renderAssets": {renderAssetsPreview: () => ""},
        "dialog/confirmDialog": {confirmDialog() {}},
        "menus/menuToggle": {toggleMenu() {}},
        "menus/Menu": {MenuItem: class {}},
        "protyle/util/onGet": {disabledProtyle() {}, onGet() {}},
        "util/pathName": {pathPosix: () => require("node:path").posix},
        "util/hostCapabilities": {getHostCapabilities: () => ({importExport: true})},
        "dayjs": require(path.join(sources.app, "node_modules/dayjs")),
        "filesize": require(path.join(sources.app, "node_modules/filesize")),
        "util/fetch": {
            fetchSyncPost: async (url, body, _headers, _process, abortSignal) => {
                if (url === "/api/history/getDocHistorySnapshots") {
                    return {code: 0, data: {histories: [{created: "1", historyPath: "/history/date/notebook/document.sy", snapshots}]}};
                }
                assert.equal(url, "/api/repo/getRepoSnapshots");
                assert.equal(body.includeFiles, true);
                signal = abortSignal;
                if (responseMode === "pending") {
                    return new Promise(resolve => { pending = resolve; });
                }
                if (responseMode === "error") {
                    return {code: -1, msg: "read failure"};
                }
                return {code: 0, data: {snapshots: responseMode === "missing" ? [] : [{...snapshots.find(item => item.id === body.id), files}]}};
            },
            fetchPost: (url, body, callback) => {
                assert.equal(url, "/api/repo/openRepoSnapshotFile");
                callback({code: 0, data: {displayInText: true, content: "文档内容 " + body.id}});
            },
        },
    };
    const modules = {};
    const load = name => {
        if (stubs[name]) {return stubs[name];}
        if (modules[name]) {return modules[name];}
        const key = sources[name] ? name : name + "/index";
        assert.ok(sources[key], "missing module " + key);
        const exports = {};
        modules[name] = exports;
        new Function("require", "exports", sources[key])(specifier => load(specifier.startsWith(".") ? require("node:path").posix.normalize(require("node:path").posix.join(require("node:path").posix.dirname(key), specifier)) : specifier), exports);
        return exports;
    };
    const {Dialog} = load("dialog");
    const mobileRuntime = new Function("Dialog", "mobile", "return " + sources.mobileRuntime)(Dialog, mobile);
    stubs["dialog/mobileDialog"] = mobileRuntime;
    stubs["dialog/mobileConfirmDialog"] = mobileRuntime;
    stubs["dialog/mobileInputDialog"] = mobileRuntime;
    const {initRepoPanel} = load("history/repoPanel");
    const panel = document.createElement("div");
    panel.className = "history__repo fn__block";
    panel.innerHTML = `<div class="history__action"><div class="history__repo-pagination"></div><input class="b3-text-field"><button data-type="compare">Compare</button>${new Function("return `" + sources.snapshotButtons + "`;")()}</div><ul data-type="repoList"></ul>`;
    document.body.append(panel);
    let refreshes = 0;
    const disposePanel = initRepoPanel(panel, () => { refreshes++; });
    const start = panel.querySelector('[data-range="start"]');
    const end = panel.querySelector('[data-range="end"]');
    assert.equal(panel.querySelector('[data-role="date-calendar"]'), null, "snapshot dates reserve no inline calendar space");
    assert.equal(start.type, "date");
    assert.equal(end.type, "date");
    if (mobile) panel.querySelector('[data-action="filters"]').click();
    start.focus();
    assert.equal(dateSessions.length, 0, "focus alone does not open the date dropdown");
    start.click();
    start.click();
    assert.equal(dateSessions.length, 1, "repeated clicks reuse the open dropdown");
    assert.equal(dateSessions.at(-1).options.ownerElement, start);
    assert.equal(dateSessions.at(-1).options.min, "1970-01-01");
    dateSessions.at(-1).confirm("2026-11-01");
    await Promise.resolve();
    assert.equal(end.min, "2026-11-01");
    assert.equal(start.getAttribute("aria-expanded"), "false");
    end.value = "2026-11-30";
    end.dispatchEvent(new Event("change", {bubbles: true}));
    assert.equal(start.max, "2026-11-30");
    end.click();
    assert.equal(dateSessions.at(-1).options.ownerElement, end);
    assert.equal(dateSessions.at(-1).options.min, "2026-11-01");
    dateSessions.at(-1).confirm("2026-11-25");
    await Promise.resolve();
    assert.equal(end.value, "2026-11-25", "dropdown selection edits its own range endpoint");
    assert.equal(start.max, "2026-11-25");
    end.value = "2026-10-31";
    end.dispatchEvent(new Event("input", {bubbles: true}));
    panel.querySelector('[data-role="date-range"]').dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
    assert.equal(refreshes, 0, "invalid range drafts cannot query snapshots");
    end.value = "2026-11-30";
    end.dispatchEvent(new Event("change", {bubbles: true}));
    assert.equal(refreshes, 0, "date editing keeps the existing explicit filter boundary");
    panel.querySelector('[data-role="date-range"]').dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
    assert.equal(refreshes, 2, "filter refreshes local and cloud snapshots");
    panel.querySelector('[data-action="range-clear"]').click();
    assert.equal(start.value, "");
    assert.equal(end.value, "");
    assert.equal(start.max, "9999-12-31");
    assert.equal(end.min, "1970-01-01");
    assert.equal(refreshes, 4);
    assert.equal(dateSessions.at(-1).options.autoConfirm, true, "range endpoints use the shared auto-confirm dropdown");
    await tick();
    const local = panel.querySelector('[data-repo-source="local"]');
    const cloud = panel.querySelector('[data-repo-source="cloud"]');
    assert.ok(local.querySelector('.history__snapshot-heading [data-type="fullCheckRepo"]'), "full check belongs to local snapshots");
    assert.equal(cloud.querySelector('[data-type="fullCheckRepo"]'), null, "cloud snapshots must not expose local checks");
    for (const font of [16, 28]) {
        panel.style.fontSize = font + "px";
        await tick();
        const heading = local.querySelector(".history__snapshot-heading");
        const button = heading.querySelector('[data-type="fullCheckRepo"]');
        assert.ok(heading.scrollWidth <= heading.clientWidth + 1, "snapshot controls must wrap on narrow screens");
        assert.ok(button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().right <= innerWidth + 1, "full check must remain visible");
    }
    end.click();
    const closingSession = dateSessions.at(-1);
    disposePanel();
    assert.equal(closingSession.destroyed, true, "panel disposal closes its active date dropdown");
    assert.equal(start.classList.contains("date-picker-input"), false);
    assert.equal(end.classList.contains("date-picker-input"), false);
    panel.remove();
    const {DocHistorySnapshots} = load("history/docSnapshots");
    const {closeNotebookHistoryDialogs} = load("history/notebookDialogs");
    const history = new Dialog({title: "项目计划 - 文件历史", width: mobile ? "100vw" : "90vw", height: mobile ? "100dvh" : "80vh",
        content: '<div class="history__repo fn__block" style="height:100%"><div class="fn__flex fn__flex-1 history__panel"><ul class="b3-list b3-list--background history__side" style="width:240px"><li class="b3-list-item b3-list-item--focus"><div class="fn__flex-1 fn__flex-column"><span class="b3-list-item__text">2026-09-28 09:00:00</span><span data-history-tags="1"></span></div></li></ul><div class="fn__flex-1 fn__flex-column"><div class="protyle-title__input">项目计划</div><textarea class="history__text fn__flex-1" readonly>原文件历史预览</textarea></div></div></div>'});
    const root = history.element.querySelector(".history__repo");
    const view = new DocHistorySnapshots({}, root, "doc", "notebook");
    if (dark) {
        load("history/repoFile").renderRepoFileList([{fileID: "doc-file", indexID: snapshots[0].id, title: "项目计划", updated: 1790557200000, hSize: "1 KB"}], root.querySelector(".history__side"), false, true);
        view.setEntries([{created: "doc-file", historyPath: "", snapshots}]);
        view.select("doc-file");
        assert.match(root.querySelector("[data-history-tags]").textContent, /发布版本/);
    } else {
        await view.load(["1"], "all");
        view.select("1");
    }
    await tick();
    const links = root.querySelectorAll(".history__association button");
    assert.equal(links.length, 2);
    assert.ok(root.scrollWidth <= root.clientWidth + 1, "history horizontal overflow");
    await require("electron").ipcRenderer.invoke("history-snapshots-capture", `history-${mobile ? "mobile" : "desktop"}-${dark ? "dark" : "light"}`);
    const original = root.innerHTML;
    links[1].focus();
    links[1].click();
    await tick();
    const detail = window.siyuan.dialogs.at(-1);
    assert.equal(window.siyuan.dialogs.length, 2);
    assert.match(detail.element.querySelector(".b3-dialog__header").textContent, /周五备份/);
    assert.equal(detail.element.querySelectorAll(".history__snapshot-detail-files li").length, files.length);
    assert.equal(detail.element.querySelector("textarea").value, "文档内容 doc-file");
    assert.ok(detail.element.querySelector("textarea").readOnly);
    for (const font of [16, 28]) {
        detail.element.style.fontSize = font + "px";
        await tick();
        const panels = detail.element.querySelector(".history__snapshot-detail-panels");
        const preview = detail.element.querySelector(".history__snapshot-detail-preview");
        assert.ok(panels.scrollWidth <= panels.clientWidth + 1, "detail horizontal overflow");
        assert.ok(preview.clientHeight > 80, "preview must remain visible");
        assert.equal(getComputedStyle(panels).flexDirection, mobile ? "column" : "row");
    }
    detail.element.style.fontSize = "";
    await require("electron").ipcRenderer.invoke("history-snapshots-capture", `${mobile ? "mobile" : "desktop"}-${dark ? "dark" : "light"}`);
    detail.destroy();
    await tick();
    assert.equal(root.innerHTML, original);
    assert.equal(document.activeElement, links[1]);
    responseMode = "missing";
    links[0].click();
    await tick();
    assert.equal(window.siyuan.dialogs.at(-1).element.querySelector("[data-detail-status]").textContent, window.siyuan.languages.historySnapshotMissing);
    window.siyuan.dialogs.at(-1).destroy();
    await tick();
    responseMode = "error";
    links[0].click();
    await tick();
    assert.equal(window.siyuan.dialogs.at(-1).element.querySelector("[data-detail-status]").textContent, "read failure");
    window.siyuan.dialogs.at(-1).destroy();
    await tick();
    responseMode = "pending";
    links[0].click();
    await tick();
    const loading = window.siyuan.dialogs.at(-1).element.querySelector("[data-detail-status]");
    assert.ok(parseFloat(getComputedStyle(loading).paddingLeft) >= 16, "loading status needs horizontal spacing");
    assert.ok(parseFloat(getComputedStyle(loading).paddingTop) >= 12, "loading status needs vertical spacing");
    closeNotebookHistoryDialogs("notebook");
    await tick();
    assert.ok(signal.aborted);
    pending({code: 0, data: {snapshots: [{...snapshots[0], files}]}});
    await tick();
    assert.equal(window.siyuan.dialogs.length, 1);
    view.destroy();
    history.destroy();
    await tick();

    let confirmRestore;
    let releaseUnload;
    let finishDetail;
    let detailSignal;
    let deferDetail = false;
    const operations = [];
    const queries = [];
    let lastPackage = "";
    stubs["dialog/mobileConfirmDialog"] = {mobileConfirmDialog: (_title, _tip, callback) => { confirmRestore = callback; }};
    stubs["plugin/loader"] = {unloadPlugin: async () => {
        operations.push("unload");
        await new Promise(resolve => { releaseUnload = resolve; });
    }};
    stubs["util/fetch"].fetchSyncPost = async (url, body, _headers, _process, abortSignal) => {
        if (url === "/api/bazaar/getInstalledPlugin") {
            return {code: 0, data: {packages: [
                {name: "example", preferredName: "Example <img src=x onerror=alert(1)>", enabled: true},
                {name: "disabled-package", preferredName: "Disabled", enabled: false},
            ]}};
        }
        if (url === "/api/repo/getPluginSnapshots") {
            lastPackage = body.name;
            queries.push(body);
            return {code: 0, data: {pageCount: 2, totalCount: 40, snapshots: Array.from({length: 20}, (_, index) => ({
                id: String(index).padStart(40, "a"), created: snapshots[0].created, memo: "<img src=x> Snapshot " + index,
                program: {count: 1, size: 1024}, data: {count: 1, size: 2000000},
            }))}};
        }
        if (url === "/api/repo/getRepoSnapshots") {
            detailSignal = abortSignal;
            const response = {code: 0, data: {snapshots: [{id: body.id, created: snapshots[0].created, memo: "Plugin", files: [
                {id: "program-file", path: `plugins/${lastPackage}/index.js`},
                {id: "data-file", path: `storage/petal/${lastPackage}/data.json`},
                {id: "other-file", path: `storage/petal/${lastPackage}-other/data.json`},
            ]}]}};
            if (deferDetail) return new Promise(resolve => { finishDetail = () => resolve(response); });
            return response;
        }
        if (url === "/api/petal/setPetalEnabled") { operations.push("disable"); assert.equal(body.enabled, false); return {code: 0}; }
        assert.equal(url, "/api/repo/restorePluginSnapshot");
        operations.push("restore");
        return {code: 0, data: {backupID: "backup"}};
    };
    const {mountPluginSnapshots} = load("history/pluginSnapshots");
    let disposePlugins;
    const pluginDialog = new Dialog({title: "Snapshots", width: mobile ? "100vw" : "90vw", height: mobile ? "100dvh" : "80vh",
        content: '<div class="history__repo fn__block"><div class="history__action"><div class="history__repo-pagination"></div><input class="b3-text-field"><button data-type="compare">Compare</button></div><ul data-type="repoList"></ul></div>',
        beforeClose: () => disposePlugins?.canClose() !== false,
        destroyCallback: () => disposePlugins?.(),
    });
    const pluginRoot = pluginDialog.element.querySelector(".history__repo");
    disposePlugins = initRepoPanel(pluginRoot, () => {}, (container, setRestoring) =>
        mountPluginSnapshots({appId: "app", plugins: [{name: "example"}]}, container, setRestoring));
    const dialogCount = window.siyuan.dialogs.length;
    pluginRoot.querySelector('[data-action="plugin-snapshots"]').click();
    await tick();
    assert.equal(window.siyuan.dialogs.length, dialogCount, "plugin mode reuses the existing snapshot dialog");
    assert.equal(getComputedStyle(pluginRoot.querySelector(".history__snapshot-columns")).display, "none");
    assert.equal(getComputedStyle(pluginRoot.querySelector('[data-action="filters"]')).display, "none");
    const pluginInput = pluginRoot.querySelector('[role="combobox"]');
    pluginInput.focus();
    await tick();
    assert.equal(pluginRoot.querySelectorAll('[role="option"]').length, 2, "disabled installed plugins remain selectable");
    assert.equal(pluginRoot.querySelector(".history__plugin-options img"), null, "package labels remain text");
    const options = pluginRoot.querySelectorAll('[role="option"]');
    pluginInput.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
    assert.equal(pluginInput.getAttribute("aria-activedescendant"), options[1].id);
    const optionBounds = options[1].getBoundingClientRect();
    assert.ok(optionBounds.bottom <= innerHeight);
    assert.equal(document.elementFromPoint(optionBounds.x + optionBounds.width / 2, optionBounds.y + optionBounds.height / 2)?.closest('[role="option"]'), options[1], "dropdown options remain visible and reachable outside the input row");
    await require("electron").ipcRenderer.invoke("history-snapshots-capture", `plugin-chooser-${mobile ? "mobile" : "desktop"}-${dark ? "dark" : "light"}`);
    pluginInput.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    assert.equal(pluginInput.getAttribute("aria-expanded"), "false");
    pluginInput.value = "Example";
    pluginInput.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    pluginRoot.querySelector("[data-plugin-search]").requestSubmit();
    assert.equal(queries.length, 0, "IME composition cannot query or select a partial plugin name");
    pluginInput.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    pluginInput.dispatchEvent(new Event("input", {bubbles: true}));
    assert.equal(pluginRoot.querySelectorAll('[role="option"]').length, 1);
    pluginRoot.querySelector('[role="option"]').click();
    await tick();
    assert.equal(queries.at(-1).name, "example");
    const rows = pluginRoot.querySelectorAll("[data-plugin-list] > li");
    assert.equal(rows.length, 20);
    assert.match(rows[0].textContent, /1.02 kB/);
    assert.match(rows[0].textContent, /2 MB/);
    assert.equal(rows[0].querySelector("img"), null);
    await require("electron").ipcRenderer.invoke("history-snapshots-capture", `plugin-list-${mobile ? "mobile" : "desktop"}-${dark ? "dark" : "light"}`);
    const actions = rows[0].querySelectorAll("button");
    actions[0].click();
    await tick();
    assert.equal(window.siyuan.dialogs.length, dialogCount, "plugin files and preview stay inside the same dialog");
    let pluginFiles = pluginRoot.querySelectorAll(".history__snapshot-detail-files [data-id]");
    assert.equal(pluginFiles.length, 1);
    assert.equal(pluginFiles[0].dataset.id, "data-file");
    pluginFiles[0].click();
    await tick();
    assert.equal(pluginRoot.querySelector("textarea").value, "文档内容 data-file");
    assert.ok(pluginRoot.scrollWidth <= pluginRoot.clientWidth + 1);
    await require("electron").ipcRenderer.invoke("history-snapshots-capture", `plugin-detail-${mobile ? "mobile" : "desktop"}-${dark ? "dark" : "light"}`);
    pluginRoot.querySelector("[data-plugin-back]").click();
    actions[1].click();
    await tick();
    pluginFiles = pluginRoot.querySelectorAll(".history__snapshot-detail-files [data-id]");
    assert.equal(pluginFiles.length, 1);
    assert.equal(pluginFiles[0].dataset.id, "program-file");
    pluginRoot.querySelector("[data-plugin-back]").click();
    for (const font of [16, 28]) {
        pluginRoot.style.fontSize = font + "px";
        await tick();
        const list = pluginRoot.querySelector("[data-plugin-list]");
        assert.ok(list.scrollHeight > list.clientHeight, "plugin rows scroll within their panel");
        assert.ok(list.getBoundingClientRect().bottom <= innerHeight + 1);
        assert.ok(pluginRoot.scrollWidth <= pluginRoot.clientWidth + 1, "plugin controls fit narrow and enlarged layouts");
    }
    pluginInput.value = "Dis"; pluginInput.dispatchEvent(new Event("input", {bubbles: true}));
    pluginInput.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    await tick();
    assert.equal(queries.at(-1).name, "disabled-package");
    pluginInput.value = "removed-package"; pluginInput.dispatchEvent(new Event("input", {bubbles: true}));
    pluginRoot.querySelector("[data-plugin-search]").requestSubmit(); await tick();
    assert.equal(queries.at(-1).name, "removed-package", "uninstalled packages can still be queried by exact name");
    pluginInput.value = "example";
    pluginRoot.querySelector("[data-plugin-search]").requestSubmit(); await tick();
    pluginRoot.querySelector('[data-plugin-page="next"]').click(); await tick();
    assert.equal(queries.at(-1).page, 2);
    pluginRoot.querySelector('[data-plugin-restore="true"]').click();
    const restoring = confirmRestore(); await tick();
    assert.deepEqual(operations, ["disable", "unload"]);
    assert.equal(disposePlugins.canClose(), false);
    pluginDialog.destroy();
    assert.equal(pluginDialog.element.dataset.dialogClosing, undefined, "restoring keeps the parent available");
    releaseUnload(); assert.equal(await restoring, true);
    assert.deepEqual(operations, ["disable", "unload", "restore"]);
    assert.match(pluginRoot.querySelector("[data-plugin-result]").textContent, /backup/);
    assert.equal(disposePlugins.canClose(), true);
    pluginRoot.querySelector('[data-action="normal"]').click();
    assert.equal(pluginRoot.classList.contains("history__snapshots--plugins"), false);
    pluginRoot.querySelector('[data-action="plugin-snapshots"]').click();
    deferDetail = true;
    pluginRoot.querySelector("[data-plugin-list] button").click(); await tick();
    pluginDialog.destroy(); await tick();
    assert.ok(detailSignal.aborted, "closing the parent cancels its inline file request");
    finishDetail(); await tick();
    assert.equal(window.siyuan.dialogs.length, 0);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true}});
        let code = 0;
        try {
            ipcMain.handle("history-snapshots-capture", async (_event, name) => {
                if (process.env.SIYUAN_HISTORY_CAPTURE_DIR) {
                    assert.match(name, /^(history-|plugin-list-|plugin-detail-|plugin-chooser-)?(mobile|desktop)-(dark|light)$/);
                    win.webContents.invalidate();
                    await new Promise(resolve => setTimeout(resolve, 350));
                    fs.writeFileSync(path.join(process.env.SIYUAN_HISTORY_CAPTURE_DIR, name + ".png"), (await win.webContents.capturePage()).toPNG());
                }
            });
            const ts = require("typescript");
            const sass = require("sass");
            const sources = {app: path.resolve(__dirname, ".."), icons: fs.readFileSync(path.join(__dirname, "../appearance/icons/litheness/icon.js"), "utf8"), languages: fs.readFileSync(path.join(__dirname, "../appearance/langs/zh-CN.json"), "utf8")};
            sources.snapshotButtons = fs.readFileSync(path.join(__dirname, "../src/history/history.ts"), "utf8").match(/<button class="b3-button b3-button--outline" data-type="genRepo">[\s\S]*?data-type="fullCheckRepo">[^<]*<\/button>/)[0];
            sources.mobileRuntime = require("./fixtures/mobileDialogRuntime.cjs").mobileDialogRuntimeSource();
            for (const name of ["datePicker/binding", "datePicker/model", "dialog/index", "util/escape", "util/upDownHint", "history/docSnapshots", "history/snapshotDetail", "history/pluginSnapshotPaths", "history/pluginSnapshotSelect", "history/pluginSnapshots", "history/notebookDialogs", "history/repoFile", "history/repoPanel", "history/repoBatch", "history/repoRange", "history/repoPurge"]) {
                sources[name] = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
            }
            sources["dialog/index"] = require("./fixtures/anchoredInputRuntime.cjs").withAnchoredInputRuntime(sources["dialog/index"]);
            for (const mobile of [false, true]) {
                const styles = sass.compile(path.join(__dirname, `../src/assets/scss/${mobile ? "mobile" : "base"}.scss`), {logger: sass.Logger.silent}).css;
                for (const dark of [false, true]) {
                    win.setContentSize(mobile ? 390 : 1280, 800);
                    await win.loadURL("data:text/html,<html><body></body></html>");
                    win.show();
                    win.focus();
                    assert.deepEqual(await win.webContents.executeJavaScript("[innerWidth, innerHeight]"), [mobile ? 390 : 1280, 800]);
                    const theme = fs.readFileSync(path.join(__dirname, `../appearance/themes/${dark ? "midnight" : "daylight"}/theme.css`), "utf8");
                    await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(theme + styles)}, ${mobile}, ${dark})`);
                }
            }
            console.log("History snapshots passed: desktop/mobile, light/dark, date dropdown bindings.");
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("history snapshots preserve selection, details and platform toolbar visibility in responsive themes", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-history-snapshots-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const headlessArgs = process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY ?
            ["--no-sandbox", "--disable-gpu", "--ozone-platform=headless"] : [];
        try {
            await promisify(execFile)(require("electron"), [__filename, profile, ...headlessArgs], {env, windowsHide: true, timeout: 90000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
