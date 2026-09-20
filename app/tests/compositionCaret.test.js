const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const rendererSource = () => {
    const ts = require("typescript");
    const read = name => readFileSync(path.join(__dirname, "../src/protyle", `${name}.ts`), "utf8");
    const extract = (file, names) => {
        const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
        const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
        assert.equal(statements.length, names.length, file);
        return statements.map(statement => statement.getText(source)).join("\n");
    };
    const wysiwyg = ts.createSourceFile("index.ts", read("wysiwyg/index"), ts.ScriptTarget.Latest, true);
    const handlers = {};
    let isAfterInlineMath;
    const visit = node => {
        if (ts.isCallExpression(node) && node.expression.getText(wysiwyg) === "this.element.addEventListener" &&
            ["compositionstart", "compositionend"].includes(node.arguments[0]?.text)) {
            handlers[node.arguments[0].text] = node.arguments[1].getText(wysiwyg);
        }
        if (ts.isVariableDeclaration(node) && node.name.getText(wysiwyg) === "isAfterInlineMath") {
            isAfterInlineMath = node.initializer.getText(wysiwyg);
        }
        ts.forEachChild(node, visit);
    };
    visit(wysiwyg);
    assert.deepEqual(Object.keys(handlers).sort(), ["compositionend", "compositionstart"]);
    assert.ok(isAfterInlineMath);
    // 使用实际事件入口、平台检测、选区恢复和事务生成，只替代网络及无关渲染。
    const source = `
        const Constants = {ZWSP: "\\u200b", ATTRIBUTE_EDITING: "data-editing"};
        const getAVTemplateInteractiveElement = () => false;
        const getBlockSelectionModeElement = () => undefined;
        const revealTabsForTarget = () => {};
        const getAtomicVerticalNavigationOwner = () => undefined;
        const getSemanticMarkerPrefixLengthForNode = () => 0;
        const cleanListMindmapHTML = html => html, cleanHeadingNumberHTML = html => html;
        const cleanTableCellRichHTML = html => html, cleanBlockSelectionModeHTML = html => html;
        const transaction = (protyle, doOperations, undoOperations) => {
            protyle.transactions.push({doOperations, undoOperations});
        };
        const input = protyle => { protyle.inputs++; };
    ` + read("wysiwyg/compositionCaret") + read("util/browserCompatibility") +
        extract("util/compatibility", ["isIOSDevice", "isMac"]) +
        extract("util/hasClosest", ["hasClosestBlock", "hasClosestByAttribute", "hasClosestByClassName",
            "hasClosestByTag", "isBlockElement"]) +
        extract("wysiwyg/getBlock", ["getContenteditableElement", "isContainerBlock", "isNotEditBlock", "hasPreviousSibling"]) +
        extract("util/selection", ["getEditorRange", "focusByRange", "getSelectionOffset", "selectIsEditor",
            "focusByOffset", "searchNode", "setLastNodeRange", "setInsertWbrHTML", "focusByWbr"]) +
        extract("wysiwyg/transaction", ["updateTransaction"]) + `
        export function bind(protyle) {
            let isComposition = false, beforeInputCompositionHandled = false;
            let compositionRange, crossBlockComposition;
            const isAfterInlineMath = ${isAfterInlineMath};
            const pending = [];
            const handlers = (function () {
                return {start: ${handlers.compositionstart}, end: ${handlers.compositionend}};
            }).call(protyle.wysiwyg);
            protyle.wysiwyg.element.addEventListener("compositionstart", handlers.start);
            protyle.wysiwyg.element.addEventListener("compositionend", event => pending.push(handlers.end(event)));
            return () => Promise.all(pending.splice(0));
        }
    `;
    return ts.transpileModule(source, {compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    }}).outputText;
};

const runCases = async () => {
    const assert = require("node:assert/strict");
    const {bind, focusByRange, focusByWbr, setInsertWbrHTML, captureCompositionText} = window.compositionCaret;
    const profiles = [
        {name: "iPhone", platform: "iPhone", userAgent: "iPhone", maxTouchPoints: 5, ios: true},
        {name: "iPad", platform: "iPad", userAgent: "iPad", maxTouchPoints: 5, ios: true},
        {name: "iPad desktop UA", platform: "MacIntel", userAgent: "Macintosh", maxTouchPoints: 5, ios: true},
        {name: "macOS", platform: "MacIntel", userAgent: "Macintosh", maxTouchPoints: 0, ios: false},
        {name: "Windows", platform: "Win32", userAgent: "Windows", maxTouchPoints: 0, ios: false},
        {name: "Android", platform: "Linux armv8l", userAgent: "Android", maxTouchPoints: 5, ios: false},
    ];
    const setPlatform = profile => {
        for (const key of ["platform", "userAgent", "maxTouchPoints"]) {
            Object.defineProperty(navigator, key, {configurable: true, value: profile[key]});
        }
    };
    const paragraph = content => '<div class="p" data-node-id="p" data-type="NodeParagraph">' +
        `<div contenteditable="true">${content}</div><div contenteditable="false" class="protyle-attr"></div></div>`;
    const table = content => '<div class="table" data-node-id="table" data-type="NodeTable">' +
        `<table contenteditable="true"><tbody><tr><td>${content}</td><td>other</td></tr></tbody></table></div>`;
    const setup = (html, profile = profiles[2]) => {
        setPlatform(profile);
        document.body.innerHTML = `<div class="protyle-wysiwyg" contenteditable="true">${html}</div>`;
        const element = document.body.firstElementChild;
        const protyle = {wysiwyg: {element, lastHTMLs: {}, escapeInline() {}}, transactions: [], inputs: 0};
        const flush = bind(protyle);
        const setRange = (node, start, end = start) => {
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, end);
            focusByRange(range);
            return range;
        };
        const start = (node, offset, end = offset) => {
            const range = setRange(node, offset, end);
            setInsertWbrHTML(element.firstElementChild, range, protyle);
            element.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
        };
        const finish = async (data = "") => {
            element.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data}));
            await flush();
        };
        const assertCaret = (node, offset) => {
            assert.equal(getSelection().rangeCount, 1);
            const range = getSelection().getRangeAt(0);
            assert.equal(range.collapsed, true);
            assert.equal(range.startContainer, node);
            assert.equal(range.startOffset, offset);
        };
        return {element, protyle, start, finish, flush, setRange, assertCaret};
    };
    let cases = 0;
    for (const profile of profiles) {
        const f = setup(paragraph("前后"), profile);
        const node = f.element.querySelector('[contenteditable="true"]').firstChild;
        f.start(node, 1);
        node.insertData(1, "你好");
        f.setRange(node, 3);
        await f.finish();
        f.assertCaret(node, profile.ios ? 3 : 1);
        assert.equal(node.data, "前你好后", profile.name);
        assert.equal(f.protyle.transactions.length, 1);
        const saved = f.protyle.transactions[0];
        assert.match(saved.doOperations[0].data, /前你好后/);
        assert.match(saved.undoOperations[0].data, /前<wbr>后/);
        f.element.firstElementChild.outerHTML = saved.undoOperations[0].data;
        focusByWbr(f.element, document.createRange());
        assert.equal(f.element.textContent, "前后");
        f.assertCaret(f.element.querySelector('[contenteditable="true"]').firstChild, 1);
        f.element.firstElementChild.outerHTML = saved.doOperations[0].data;
        assert.equal(f.element.textContent, "前你好后");
        assert.equal(f.element.querySelectorAll("wbr").length, 0);
        cases++;
    }
    for (const selected of [false, true]) {
        const f = setup(paragraph("前选中后"));
        const node = f.element.querySelector('[contenteditable="true"]').firstChild;
        f.start(node, 1, selected ? 3 : 1);
        if (selected) {
            node.deleteData(1, 2);
        }
        node.insertData(1, "ni");
        node.deleteData(1, 2);
        f.setRange(node, node.length);
        await f.finish();
        f.assertCaret(node, 1);
        assert.equal(node.data, selected ? "前后" : "前选中后");
        assert.equal(f.protyle.transactions.length, selected ? 1 : 0);
        if (selected) {
            f.element.firstElementChild.outerHTML = f.protyle.transactions[0].undoOperations[0].data;
            focusByWbr(f.element, document.createRange());
            assert.equal(f.element.textContent, "前选中后");
        }
        cases++;
    }
    for (const retained of [false, true]) {
        const f = setup(table("前后"));
        const cells = f.element.querySelectorAll("td");
        const node = cells[0].firstChild;
        f.start(node, 1);
        cells[1].textContent = "changed elsewhere";
        if (retained) {
            node.insertData(1, "你好");
            f.setRange(node, 3);
        } else {
            f.setRange(cells[1].firstChild, 0);
        }
        await f.finish();
        f.assertCaret(node, retained ? 3 : 1);
        cases++;
    }
    for (const retained of [false, true]) {
        const f = setup(paragraph('<span contenteditable="false" data-type="inline-math"></span>\u200b后'));
        const editable = f.element.querySelector('[contenteditable="true"]');
        const node = editable.lastChild;
        f.start(node, 1);
        editable.firstChild.innerHTML = '<span class="katex">newly rendered formula</span>';
        f.element.querySelector(".protyle-attr").textContent = "new attribute";
        if (retained) {
            node.insertData(1, "你好");
        }
        f.setRange(node, retained ? 3 : node.length);
        await f.finish();
        f.assertCaret(node, retained ? 3 : 1);
        cases++;
    }
    for (const retained of [false, true]) {
        const f = setup(paragraph(""));
        const editable = f.element.querySelector('[contenteditable="true"]');
        f.start(editable, 0);
        editable.append(document.createTextNode(retained ? "你好" : "\u200b"));
        f.setRange(editable.firstChild, editable.firstChild.length);
        await f.finish();
        f.assertCaret(retained ? editable.firstChild : editable, retained ? 2 : 0);
        cases++;
    }
    {
        const f = setup(paragraph("前选中后"));
        const node = f.element.querySelector('[contenteditable="true"]').firstChild;
        f.start(node, 1, 3);
        node.replaceData(1, 2, "你好");
        f.setRange(node, 3);
        await f.finish();
        f.assertCaret(node, 3);
        assert.match(f.protyle.transactions[0].undoOperations[0].data, /前选中<wbr>后/);
        cases++;
    }
    {
        const f = setup(paragraph('前<span style="font-weight: bold">后</span>'));
        const editable = f.element.querySelector('[contenteditable="true"]');
        f.start(editable, 1);
        const text = document.createTextNode("你好");
        editable.insertBefore(text, editable.lastChild);
        f.setRange(text, 2);
        await f.finish();
        f.assertCaret(text, 2);
        cases++;
    }
    {
        const f = setup(paragraph("前后"));
        const node = f.element.querySelector('[contenteditable="true"]').firstChild;
        const range = f.setRange(node, 1);
        const hasRetainedText = captureCompositionText(node.parentElement, range);
        node.insertData(1, "你好");
        assert.equal(hasRetainedText(f.setRange(node, 0)), false);
        assert.equal(hasRetainedText(f.setRange(node, 1, 3)), false);
        assert.equal(hasRetainedText(f.setRange(node, 3)), true);
        node.parentElement.remove();
        assert.equal(hasRetainedText(range), false);
        cases++;
    }
    {
        const f = setup(table("前后"));
        const cells = f.element.querySelectorAll("td");
        const range = f.setRange(cells[0].firstChild, 1);
        range.setEnd(cells[1].firstChild, 2);
        assert.equal(captureCompositionText(cells[0], range), undefined);
        cases++;
    }
    {
        const f = setup(paragraph("前后"));
        const node = f.element.querySelector('[contenteditable="true"]').firstChild;
        f.start(node, 1);
        node.insertData(1, "你好");
        f.setRange(node, 3);
        await f.finish("你好");
        f.assertCaret(node, 3);
        assert.equal(f.protyle.inputs, 1);
        cases++;
    }
    return cases;
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(`window.compositionCaret = {};
            new Function("exports", ${JSON.stringify(rendererSource())})(window.compositionCaret);`);
        const cases = await win.webContents.executeJavaScript(`(${runCases.toString()})()`);
        console.log(`Composition caret: ${cases} Electron cases passed`);
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
    require("node:test").it("preserves iOS composition carets and existing cancellation and undo behavior", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-composition-caret-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Composition caret: 19 Electron cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-composition-caret-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
