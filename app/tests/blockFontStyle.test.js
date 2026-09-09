const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = () => {
    const assert = require("node:assert/strict");
    document.body.innerHTML = '<div id="editor"><div data-node-id="quote" data-type="NodeBlockquote" style="font-family: Georgia">' +
        '<div data-node-id="one" data-type="NodeParagraph"><div contenteditable="true">plain<span data-type="text" style="font-family: Arial; color: red">inline</span></div><div class="protyle-attr">badge</div></div>' +
        '<div data-node-id="empty" data-type="NodeParagraph"><div contenteditable="true"></div></div></div>' +
        '<div data-node-id="two" data-type="NodeParagraph"><div contenteditable="true">two</div></div>' +
        '<div data-node-id="code" data-type="NodeCodeBlock"><div contenteditable="true">code</div></div>' +
        '<div data-node-id="math" data-type="NodeMathBlock"></div>' +
        '<div data-node-id="av" data-type="NodeAttributeView"></div>' +
        '<div data-node-id="list" data-type="NodeList"><div data-node-id="li" data-type="NodeListItem" class="li"><div data-node-id="child" data-type="NodeParagraph"><div contenteditable="true">child</div></div></div></div>' +
        '<div data-node-id="table" data-type="NodeTable"><table><tbody><tr><td><span data-type="text" style="font-family: Arial">cell</span></td></tr></tbody></table></div></div>';
    const editor = document.getElementById("editor");
    const block = id => editor.querySelector(`[data-node-id="${id}"]`);
    const one = block("one");
    const range = document.createRange();
    range.selectNodeContents(one.firstElementChild);
    const inlineCalls = [];
    const protyle = {wysiwyg: {element: editor}, toolbar: {range,
        setInlineMark: (...args) => inlineCalls.push(args),
        setBlockElementsInlineMark: () => { throw new Error("Unexpected inline block formatting"); },
    }};
    window.siyuan = {storage: {recent: []}};
    const state = nodes => window.family.getFontFamilyState(protyle, nodes);
    const apply = (nodes, type, value) => window.font.fontEvent(protyle, nodes, type, value, false);
    assert.equal(state([one]).family, "Georgia");
    assert.equal(state([block("quote")]).family, "Georgia");
    assert.equal(state([block("empty")]).family, "Georgia");
    assert.equal(state([one, block("two")]).mixed, true);
    assert.equal(state([block("code"), block("math"), block("av")]).disabled, true);
    assert.equal(state([block("li")]).disabled, true);
    assert.equal(state([block("list")]).disabled, false);
    assert.equal(state([one, block("code")]).family, "Georgia");
    assert.equal(window.family.getInlineFontFamilyState(protyle, [editor.querySelector("td")]).family, "Arial");
    assert.equal(state([block("table")]).family, undefined);

    const body = one.innerHTML;
    apply([one, block("empty"), block("two")], "fontFamily", "Verdana");
    assert.equal(one.style.fontFamily, "Verdana");
    assert.equal(one.innerHTML, body);
    assert.equal(block("empty").style.fontFamily, "Verdana");
    assert.equal(state([one, block("two")]).mixed, false);
    assert.equal(state([one]).family, "Verdana");
    const batch = window.batches.at(-1);
    assert.equal(batch.operations.length, 3);
    assert.equal(batch.undoOperations.length, 3);
    const replay = operations => operations.forEach(operation => { block(operation.id).outerHTML = operation.data; });
    replay(batch.undoOperations);
    assert.equal(block("one").style.fontFamily, "");
    assert.equal(block("one").innerHTML, body);
    replay(batch.operations);
    assert.equal(block("one").style.fontFamily, "Verdana");
    assert.equal(block("one").innerHTML, body);
    apply([block("one")], "fontFamily", "");
    assert.equal(state([block("one")]).family, "Georgia");
    apply([block("one")], "fontFamily", "Verdana");
    block("one").style.fontSize = "24px";
    block("one").style.color = "blue";
    apply([block("one")], "clear");
    assert.equal(block("one").innerHTML, body);
    assert.equal(block("one").style.fontFamily, "");
    assert.equal(block("one").style.fontSize, "");
    assert.equal(block("one").style.color, "");
    const listBody = block("list").innerHTML;
    apply([block("list"), block("table")], "fontFamily", "Verdana");
    assert.equal(block("list").innerHTML, listBody);
    assert.equal(block("table").querySelector("span").style.fontFamily, "Arial");
    apply([block("code"), block("math"), block("av")], "fontFamily", "Verdana");
    ["code", "math", "av"].forEach(id => assert.equal(block(id).style.fontFamily, ""));
    apply([], "fontFamily", "Arial");
    assert.equal(inlineCalls.at(-1)[1], "text");
    assert.deepEqual(inlineCalls.at(-1)[3], {type: "fontFamily", color: "Arial"});
    apply([], "clear");
    assert.equal(inlineCalls.at(-1)[1], "clear");
    range.setStart(block("one").querySelector("span").firstChild, 1);
    range.collapse(true);
    assert.equal(state().family, "Arial");
    document.documentElement.style.setProperty("--b3-font-family", "Tahoma");
    assert.equal(getComputedStyle(block("one").querySelector(".protyle-attr")).fontFamily, "Tahoma");
    assert.equal(getComputedStyle(block("one").firstElementChild).fontFamily, "Georgia");
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const root = path.join(__dirname, "../src/protyle");
        const read = name => readFileSync(path.join(root, name + ".ts"), "utf8");
        const extract = (name, names) => {
            const source = ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true);
            const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
                statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
            assert.equal(statements.length, names.length);
            return statements.map(statement => statement.getText(source)).join("\n");
        };
        // 使用实际字体分流、状态读取和事务序列化，隔离存储与内核通信。
        const modules = {
            "toolbar/fontFamilyCore": read("toolbar/fontFamilyCore"),
            "util/hasClosest": read("util/hasClosest"),
            "toolbar/fontFamilyMenu": 'import {FONT_FAMILY_EXCLUDED_BLOCK_TYPES, getInlineFontFamilySelection, hasInlineFontFamilyExcludedType} from "./fontFamilyCore";\n' +
                'import {hasClosestBlock} from "../util/hasClosest"; const Constants = {ZWSP:"\\u200b"};\n' +
                extract("toolbar/fontFamilyMenu", ["getNodeFontFamily", "getFontFamilyState", "getInlineFontFamilyState"]),
            "wysiwyg/transaction": 'const Constants = {ATTRIBUTE_EDITING:"data-editing"}; const cleanHeadingNumberHTML = html => html;\n' +
                "const transaction = (protyle, operations, undoOperations) => window.batches.push({operations, undoOperations});\n" +
                extract("wysiwyg/transaction", ["updateBatchTransaction"]),
            "toolbar/Font": 'import {updateBatchTransaction} from "../wysiwyg/transaction";\n' +
                'const Constants = {LOCAL_FONTSTYLES:"recent", ZWSP:"\\u200b"}; const MAX_RECENT_FONT_STYLES = 14;\n' +
                "const getRecentInlineStyleKey = value => value; const setStorageVal = () => {};\n" +
                extract("toolbar/Font", ["fontEvent"]),
        };
        const sources = Object.fromEntries(Object.entries(modules).map(([name, source]) => [name,
            ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText]));
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.insertCSS(require("sass").compile(path.join(__dirname, "../src/assets/scss/protyle/_attr.scss")).css);
        await win.webContents.executeJavaScript(`(() => {
            const sources = ${JSON.stringify(sources)}, cache = {};
            const load = name => {
                if (!cache[name]) {
                    if (!sources[name]) { throw new Error(name); }
                    cache[name] = {};
                    const resolve = dependency => load(require("node:path").posix.normalize(
                        require("node:path").posix.dirname(name) + "/" + dependency));
                    new Function("require", "exports", sources[name])(resolve, cache[name]);
                }
                return cache[name];
            };
            window.batches = [];
            window.family = load("toolbar/fontFamilyMenu");
            window.font = load("toolbar/Font");
        })()`);
        await win.webContents.executeJavaScript(`(${runCases.toString()})()`);
        console.log("Block font style cases passed");
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
    require("node:test").it("keeps block font styles separate from inline text and attribute badges", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-block-font-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Block font style cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-block-font-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
