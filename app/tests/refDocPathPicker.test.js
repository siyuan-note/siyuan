const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async (sources, mobile) => {
    const check = require("node:assert/strict");
    const tick = () => new Promise(resolve => setTimeout(resolve, 20));
    const notebooks = [{id: "plain", name: "Plain"}, {id: "other", name: "Other"},
        {id: "secret", name: "Secret", encrypted: true}];
    const results = notebooks.map(item => ({box: item.id, path: "/parent.sy", hPath: item.name + "/Parent"}));
    window.siyuan = {
        dialogs: [], zIndex: 1, notebooks,
        languages: {cancel: "Cancel", confirm: "Confirm", searchPlaceholder: "Search", newFileAtPath: "Choose location and create document"},
        storage: {move: {k: "", keys: []}}, config: {search: {caseSensitive: false, limit: 20}},
        menus: {menu: {element: document.createElement("div"), remove() {}}},
    };
    let id = 0;
    const deps = {
        genUUID: () => String(++id), isAbove: () => false, moveResize() {}, isMobile: () => mobile,
        Constants: {LOCAL_MOVE_PATH: "move", TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0},
        getFileTreeDefaultIconAttr: () => "", getFileTreeIconHTML: () => "",
        escapeHtml: text => text, escapeAriaLabel: text => text, updateHotkeyTip: text => text,
        highlightSearchText: text => text, addClearButton() {}, setStorageVal() {},
        isOnlyMeta: () => false, matchHotKey: () => false,
        fetchPost(url, data, cb) {
            if (url === "/api/notebook/lsNotebooks") {
                cb({data: {notebooks}});
            } else if (url === "/api/filetree/searchDocs") {
                cb({data: results});
            } else {
                throw new Error("Unexpected request " + url);
            }
        },
    };
    const load = name => {
        const exports = {};
        new Function("require", "exports", sources[name])(() => deps, exports);
        return exports;
    };
    Object.assign(deps, load("dialog/index"));
    const {movePathTo} = load("util/pathName");
    for (const source of ["plain", "secret"]) {
        for (const confirmBy of ["click", "enter", "cancel"]) {
            window.siyuan.storage.move.k = "";
            const calls = [];
            let restored = 0;
            movePathTo({title: window.siyuan.languages.newFileAtPath, flashcard: false, sourceNotebookIds: [source],
                cb: (...args) => calls.push(args), restoreFocus: () => restored++});
            const dialog = window.siyuan.dialogs[0];
            const container = dialog.element.querySelector(".b3-dialog__container");
            check.equal(container.style.width, mobile ? "92vw" : "50vw");
            const expected = source === "secret" ? ["secret"] : ["plain", "other"];
            const boxes = selector => Array.from(dialog.element.querySelectorAll(selector)).map(item => item.dataset.box);
            check.deepEqual(boxes("#foldTree li"), expected);
            check.equal(!!dialog.element.querySelector("#foldTree.b3-list--mobile"), mobile);
            const input = dialog.element.querySelector("input");
            input.value = "Parent";
            input.dispatchEvent(new Event("input", {bubbles: true}));
            check.deepEqual(boxes("#foldList li"), expected);
            if (confirmBy === "cancel") {
                dialog.element.querySelector(".b3-button--cancel").click();
            } else if (confirmBy === "enter") {
                input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
            } else {
                const items = dialog.element.querySelectorAll("#foldList li");
                items[items.length - 1].click();
                dialog.element.querySelector(".b3-button--text").click();
            }
            await tick();
            check.equal(restored, 1);
            check.equal(window.siyuan.dialogs.length, 0);
            if (confirmBy === "cancel") {
                check.equal(calls.length, 0);
            } else {
                check.deepEqual(calls, [[["/parent.sy"], [confirmBy === "click" ? expected[expected.length - 1] : expected[0]]]]);
            }
        }
    }
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        let code = 0;
        try {
            const ts = require("typescript");
            const preprocess = require("ifdef-loader/preprocessor").parse;
            for (const mobile of [false, true]) {
                await win.loadURL("data:text/html,<html><body></body></html>");
                const sources = {};
                for (const name of ["util/pathName", "dialog/index"]) {
                    sources[name] = ts.transpileModule(preprocess(fs.readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"),
                        {MOBILE: mobile, BROWSER: true}, false, true), {
                        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
                    }).outputText;
                }
                await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)}, ${mobile})`);
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
    test("desktop and mobile path pickers filter encrypted destinations and support confirm and cancel", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-ref-doc-path-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 30000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
