const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const runCases = async sources => {
    const check = require("node:assert/strict");
    let mobile = false;
    let counted;
    let focused;
    let toolbarOpened = 0;
    const modules = {
        "util/genID": {genUUID: () => "generated"},
        constants: {Constants: {TIMEOUT_INPUT: 0}},
        "util/hostCapabilities": {getHostCapabilities: () => ({}), sanitizeKernelHTML: text => text},
        "dialog/progress": {},
        "util/fetch": {},
        "layout/status": {countBlockWord: ids => counted = ids},
        "util/functions": {isMobile: () => mobile},
        "mobile/util/keyboardToolbar": {activeBlur: () => document.activeElement.blur()},
        "protyle/util/selection": {focusBlock: element => {
            focused = element;
            const range = document.createRange();
            range.selectNodeContents(element.querySelector('[contenteditable="true"]'));
            range.collapse(true);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
        }},
        "protyle/ui/hideElements": {hideElements: () => {}},
        "protyle/wysiwyg/verticalNavigationState": {},
        "menus/menuToggle": {},
    };
    // 仅替换滚动条构造及其他操作的依赖，通知流程使用真实的 loadAll。
    for (const name of ["protyle/util/onGet", "protyle/util/compatibility", "protyle/util/hasClosest",
        "protyle/wysiwyg/commonHotkey", "dialog/tooltip", "util/pathName", "protyle/scroll/visibility",
        "protyle/scroll/loadAll", "protyle/scroll/dynamicLoadState", "protyle/scroll/saveScroll",
        "protyle/scroll/slider", "util/touchDragBridge", "protyle/util/transactionQueue",
        "util/keymapBindings", "protyle/scroll/page", "protyle/scroll/pageButtons"]) {
        modules[name] = {};
    }
    const load = name => {
        if (modules[name]) {
            return modules[name];
        }
        const exports = {};
        modules[name] = exports;
        new Function("require", "exports", sources[name])(dependency => {
            const parts = name.split("/");
            parts.pop();
            dependency.split("/").forEach(part => {
                if (part === "..") {
                    parts.pop();
                } else if (part !== ".") {
                    parts.push(part);
                }
            });
            return load(parts.join("/"));
        }, exports);
        return exports;
    };
    const {showSelectAllIncompleteTip} = load("protyle/util/selectAllTip");
    const {initMessage} = load("dialog/message");
    const {Scroll} = load("protyle/scroll/index");
    const {renderMultiSelectToolbar} = load("mobile/util/multiSelectToolbar");
    const settle = () => new Promise(resolve => setTimeout(resolve, 10));
    const fixture = (reset = true) => {
        if (reset) {
            document.body.innerHTML = '<div id="message"></div>';
            window.siyuan = {zIndex: 0, config: {appearance: {notifications: {}}, editor: {dynamicLoadBlocks: 64}}, languages: {
                selectAllIncompleteTip: "Unloaded blocks remain unselected",
                loadAllAndSelectAll: "Load full document and select all",
                loading: "Loading...",
            }};
            initMessage();
        }
        counted = undefined;
        focused = undefined;
        toolbarOpened = 0;
        const editor = document.createElement("div");
        const element = document.createElement("div");
        editor.append(element);
        document.body.append(editor);
        element.innerHTML = '<div data-node-id="middle" class="protyle-wysiwyg--select"><div contenteditable="true">Middle</div>' +
            '<div data-node-id="nested" class="protyle-wysiwyg--select protyle-wysiwyg--select-mode" select-start="0" select-end="1">Nested</div></div>';
        const subElement = document.createElement("div");
        document.body.append(subElement);
        let complete;
        let requests = 0;
        const protyle = {
            element: editor,
            block: {rootID: "document", parentID: "document", scroll: true},
            options: {}, wysiwyg: {element},
            scroll: Object.assign(Object.create(Scroll.prototype), {
                invalidateDynamicLoad: () => {},
                update: () => {},
                loadUntilBoundary: (currentProtyle, rootID, mode) => {
                    if (mode === 2) {
                        return Promise.resolve(true);
                    }
                    requests++;
                    return new Promise((resolve, reject) => complete = (success, error) => {
                        if (error) {
                            reject(new Error("Loading failed"));
                        } else {
                            if (success) {
                                element.insertAdjacentHTML("afterbegin", '<div data-node-id="first" data-node-index="0"><div contenteditable="true">First</div></div>');
                                element.insertAdjacentHTML("beforeend", '<div data-node-id="last"><div contenteditable="true">Last</div></div><div class="placeholder"></div>');
                                element.setAttribute("data-bottom-eof", "");
                            }
                            resolve(success);
                        }
                    });
                },
            }),
            toolbar: {
                subElement,
                isMultiSelectMode: () => !!subElement.querySelector(".multiSelectCount"),
                showMultiSelectMode: () => {
                    toolbarOpened++;
                    renderMultiSelectToolbar(subElement, element.querySelectorAll(".protyle-wysiwyg--select").length, () => {}, () => {});
                },
            },
        };
        const show = () => showSelectAllIncompleteTip(protyle);
        const button = () => document.querySelector('#message [data-id="selectAllIncompleteTip"] button');
        const notification = () => document.querySelector('#message [data-id="selectAllIncompleteTip"]');
        const selected = () => Array.from(element.querySelectorAll(".protyle-wysiwyg--select"), item => item.dataset.nodeId);
        return {protyle, element, show, button, notification, selected, complete: (...args) => complete(...args),
            requests: () => requests};
    };

    // 重复提示会替换按钮，必须绑定最新按钮，并等待全文成功加载后再选择顶层块。
    for (mobile of [false, true]) {
        const f = fixture();
        if (mobile) {
            f.protyle.toolbar.showMultiSelectMode();
        }
        f.show();
        const previous = f.button();
        f.show();
        check.notEqual(previous, f.button());
        const button = f.button();
        const notification = f.notification();
        button.click();
        button.click();
        check.equal(f.requests(), 1);
        // 加载提示复用本条通知的 id，避免新增通知导致列表位置跳动
        check.equal(f.notification(), notification);
        check.equal(document.querySelectorAll("#message .b3-snackbar").length, 1);
        check.equal(notification.textContent, "Loading...");
        check.equal(f.button(), null);
        check.equal(button.disabled, true);
        check.deepEqual(f.selected(), ["middle", "nested"]);
        f.complete(true);
        await settle();
        check.deepEqual(f.selected(), ["first", "middle", "last"]);
        check.deepEqual(counted, ["first", "middle", "last"]);
        check.equal(f.element.querySelector("[select-start], [select-end], .protyle-wysiwyg--select-mode"), null);
        check.equal(f.button(), null);
        if (mobile) {
            check.equal(f.protyle.toolbar.subElement.querySelector(".multiSelectCount").textContent, "3");
            check.equal(toolbarOpened, 1);
            check.equal(getSelection().rangeCount, 0);
        } else {
            check.equal(focused.dataset.nodeId, "first");
            check.equal(getSelection().isCollapsed, true);
        }
    }

    // 移动端退出多选后点击通知，重新展示多选工具栏；通知消失不取消已开始的加载。
    mobile = true;
    const reopened = fixture();
    reopened.show();
    reopened.button().click();
    reopened.notification().remove();
    reopened.complete(true);
    await settle();
    check.equal(toolbarOpened, 1);
    check.deepEqual(reopened.selected(), ["first", "middle", "last"]);

    for (mobile of [false, true]) {
        for (const error of [false, true]) {
            const f = fixture();
            f.show();
            const notification = f.notification();
            f.button().click();
            f.complete(false, error);
            await settle();
            check.deepEqual(f.selected(), ["middle", "nested"]);
            check.equal(counted, undefined);
            check.equal(f.button().disabled, false);
            check.equal(f.notification(), notification, "retry reuses the same notification");
            if (error) {
                check.match(document.getElementById("message").textContent, /Loading failed/);
            }
            f.button().click();
            f.complete(true);
            await settle();
            check.deepEqual(f.selected(), ["first", "middle", "last"]);
        }
    }

    // 用户关闭提示或禁用通知后，失败的加载不重新显示提示，也不遗留加载状态。
    for (const dismiss of [f => f.notification().remove(),
        () => window.siyuan.config.appearance.notifications.selectAllIncompleteTip = false]) {
        const f = fixture();
        f.show();
        f.button().click();
        dismiss(f);
        f.complete(false);
        await settle();
        check.equal(f.notification(), null);
    }

    // 旧加载结束后不能关闭或恢复已被其他文档替换的提示，包括新的加载状态。
    for (mobile of [false, true]) {
        for (const outcome of ["success", "failure", "error"]) {
            for (const startNewLoad of [false, true]) {
                const first = fixture();
                first.show();
                first.button().click();
                const second = fixture(false);
                second.protyle.block.rootID = "other-document";
                second.show();
                const secondButton = second.button();
                if (startNewLoad) {
                    secondButton.click();
                }
                const content = second.notification().firstElementChild;
                first.complete(outcome === "success", outcome === "error");
                await settle();
                check.equal(content.isConnected, true);
                check.equal(second.notification().firstElementChild, content);
                if (startNewLoad) {
                    check.equal(second.notification().textContent, "Loading...");
                    second.complete(true);
                    await settle();
                    check.deepEqual(second.selected(), ["first", "middle", "last"]);
                    check.equal(second.notification(), null);
                } else {
                    check.equal(second.button(), secondButton);
                    check.equal(secondButton.disabled, false);
                }
            }
        }
    }

    // 非通知按钮调用 loadAll 时，仍自行清理独立的加载提示。
    for (const success of [false, true]) {
        const f = fixture();
        const loading = f.protyle.scroll.loadAll(f.protyle);
        check.match(document.getElementById("message").textContent, /Loading/);
        f.complete(success);
        check.equal(await loading, success);
        await settle();
        check.equal(document.querySelector("#message .b3-snackbar"), null);
    }

    mobile = false;
    for (const change of [f => f.protyle.block.rootID = "other", f => f.protyle.block.parentID = "zoomed",
        f => f.protyle.element.remove(), f => f.protyle.wysiwyg.element = document.createElement("div")]) {
        for (const duringLoad of [false, true]) {
            const f = fixture();
            f.show();
            if (duringLoad) {
                f.button().click();
            }
            change(f);
            if (duringLoad) {
                f.complete(true);
            } else {
                f.button().click();
                check.equal(f.requests(), 0);
            }
            await settle();
            check.equal(counted, undefined);
        }
    }

    const loaded = fixture();
    loaded.show();
    loaded.protyle.block.scroll = false;
    loaded.button().click();
    await settle();
    check.equal(loaded.requests(), 0);
    check.deepEqual(loaded.selected(), ["middle"]);

    for (const disable of [f => f.protyle.lite = true, f => f.protyle.block.showAll = true,
        f => f.protyle.block.scroll = false, f => f.protyle.options.backlinkData = {},
        () => window.siyuan.config.appearance.notifications.selectAllIncompleteTip = false,
        f => {
            f.element.firstElementChild.dataset.nodeIndex = "0";
            f.element.setAttribute("data-bottom-eof", "");
        }]) {
        const f = fixture();
        disable(f);
        f.show();
        check.equal(f.button(), null);
    }
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        let code = 0;
        try {
            const sources = Object.fromEntries(["protyle/util/selectAllTip", "protyle/util/documentRange",
                "protyle/wysiwyg/blockSelection", "protyle/scroll/index", "dialog/message", "mobile/util/multiSelectToolbar", "util/escape"].map(name => [name,
                ts.transpileModule(readFileSync(path.join(__dirname, `../src/${name}.ts`), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
                }).outputText]));
            await win.loadURL("data:text/html,<html><head></head><body></body></html>");
            const result = await win.webContents.executeJavaScript(`(async () => {
                try {
                    await (${runCases.toString()})(${JSON.stringify(sources)});
                    return "passed";
                } catch (error) {
                    return error.stack;
                }
            })()`);
            assert.equal(result, "passed");
            console.log("Select-all notification actions passed");
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    require("node:test").test("select-all notification loads and selects document blocks on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-select-all-tip-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Select-all notification actions passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-select-all-tip-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
