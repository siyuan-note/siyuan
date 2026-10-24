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
    const stubs = {
        "block/panelOwnership": {getDialogBlockPanel() {}, destroyDialogBlockPanels() {}},
        "util/genID": {genUUID: () => String(++nextID)},
        "util/zIndex": {isAbove: () => false},
        "dialog/moveResize": {moveResize() {}},
        "util/functions": {isMobile: () => mobile},
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
    const {initRepoPanel} = load("history/repoPanel");
    const panel = document.createElement("div");
    panel.className = "history__repo fn__block";
    panel.innerHTML = `<div class="history__action"><div class="history__repo-pagination"></div><input class="b3-text-field"><button data-type="compare">Compare</button>${new Function("return `" + sources.snapshotButtons + "`;")()}</div><ul data-type="repoList"></ul>`;
    document.body.append(panel);
    const disposePanel = initRepoPanel(panel, () => {});
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
    disposePanel();
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
                    assert.match(name, /^(history-)?(mobile|desktop)-(dark|light)$/);
                    win.webContents.invalidate();
                    await new Promise(resolve => setTimeout(resolve, 350));
                    fs.writeFileSync(path.join(process.env.SIYUAN_HISTORY_CAPTURE_DIR, name + ".png"), (await win.webContents.capturePage()).toPNG());
                }
            });
            const ts = require("typescript");
            const sass = require("sass");
            const sources = {app: path.resolve(__dirname, ".."), icons: fs.readFileSync(path.join(__dirname, "../appearance/icons/litheness/icon.js"), "utf8"), languages: fs.readFileSync(path.join(__dirname, "../appearance/langs/zh-CN.json"), "utf8")};
            sources.snapshotButtons = fs.readFileSync(path.join(__dirname, "../src/history/history.ts"), "utf8").match(/<button class="b3-button b3-button--outline" data-type="genRepo">[\s\S]*?data-type="fullCheckRepo">[^<]*<\/button>/)[0];
            for (const name of ["dialog/index", "util/escape", "history/docSnapshots", "history/snapshotDetail", "history/notebookDialogs", "history/repoFile", "history/repoPanel", "history/repoBatch", "history/repoRange", "history/repoPurge"]) {
                sources[name] = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
            }
            sources["dialog/index"] = require("./fixtures/anchoredInputRuntime.cjs").withAnchoredInputRuntime(sources["dialog/index"]);
            for (const mobile of [false, true]) {
                const styles = sass.compile(path.join(__dirname, `../src/assets/scss/${mobile ? "mobile" : "base"}.scss`), {logger: sass.Logger.silent}).css;
                for (const dark of [false, true]) {
                    win.setContentSize(mobile ? 390 : 1280, 800);
                    await win.loadURL("data:text/html,<html><body></body></html>");
                    const theme = fs.readFileSync(path.join(__dirname, `../appearance/themes/${dark ? "midnight" : "daylight"}/theme.css`), "utf8");
                    await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(theme + styles)}, ${mobile}, ${dark})`);
                }
            }
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
        try {
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 90000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
