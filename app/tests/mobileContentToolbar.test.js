const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = async () => {
    const assert = require("node:assert/strict");
    window.siyuan = {zIndex: 0, languages: {}, menus: {menu: {remove() {}, fullscreen() {}}}};
    const commands = [];
    document.execCommand = command => {
        commands.push({command, text: getSelection().toString()});
        return true;
    };
    const createEditor = (gutter, table = false) => {
        const element = document.createElement("div");
        element.className = "protyle-wysiwyg";
        element.innerHTML = table ?
            '<div data-node-id="one" data-type="NodeTable"><table><tbody><tr><td contenteditable="true">Alpha <b>beta</b></td><td contenteditable="true">Other cell</td></tr></tbody></table></div>' :
            '<div data-node-id="one" data-type="NodeParagraph"><div contenteditable="true">Alpha <b>beta</b></div><div class="protyle-attr">Attribute</div></div>';
        element.insertAdjacentHTML("beforeend", '<div data-node-id="two" data-type="NodeParagraph"><div contenteditable="true">Other block</div></div>');
        const toolbar = new window.ContentToolbar();
        toolbar.element = document.createElement("div");
        toolbar.subElement = document.createElement("div");
        document.body.replaceChildren(element, toolbar.element, toolbar.subElement);
        const menus = [];
        const protyle = {wysiwyg: {element}, toolbar,
            hint: {element: document.createElement("div"), deactivateEmojiPanel() {}},
            gutter: gutter ? {renderMenu: (_protyle, block) => menus.push(block)} : undefined,
        };
        const block = element.firstElementChild;
        const editable = block.querySelector('[contenteditable="true"]');
        const range = document.createRange();
        range.setStart(editable.firstChild, 1);
        range.setEnd(editable.firstChild, 4);
        window.focusContentRange(range);
        toolbar.showContent(protyle, range, block);
        return {element, toolbar, protyle, block, editable, range, menus};
    };
    const click = async (state, action) => {
        const button = state.toolbar.subElement.querySelector(`[data-action="${action}"]`);
        assert.ok(button, `Missing action: ${action}`);
        button.click();
        await new Promise(resolve => setTimeout(resolve, 0));
    };
    const assertTextSelection = state => {
        assert.equal(state.toolbar.subElement.classList.contains("fn__none"), false);
        assert.equal(state.toolbar.isMultiSelectMode(), false);
        assert.equal(getSelection().toString(), "Alpha beta");
        assert.equal(state.element.querySelector(".protyle-wysiwyg--select"), null);
        ["copy", "cut", "more"].forEach(action => {
            assert.ok(state.toolbar.subElement.querySelector(`[data-action="${action}"]`));
        });
    };

    // 普通段落和表格单元格在无块菜单时均保留文字选区，连续操作不得进入不可用的块多选。
    for (const table of [false, true]) {
        for (const action of ["copy", "cut"]) {
            const state = createEditor(false, table);
            for (let index = 0; index < 3; index++) {
                await click(state, "select");
                assertTextSelection(state);
            }
            await click(state, "more");
            assert.ok(state.toolbar.subElement.querySelector('[data-action="copyPlainText"]'));
            await click(state, "back");
            assertTextSelection(state);
            await click(state, action);
            assert.deepEqual(commands.at(-1), {command: action, text: "Alpha beta"});
            assert.equal(state.toolbar.subElement.classList.contains("fn__none"), true);
        }
    }

    // 从光标位置全选后也应补齐复制和剪切按钮。
    const caret = createEditor(false);
    caret.range.collapse(true);
    caret.toolbar.showContent(caret.protyle, caret.range, caret.block);
    assert.equal(caret.toolbar.subElement.querySelector('[data-action="copy"]'), null);
    await click(caret, "select");
    assertTextSelection(caret);

    const marked = createEditor(false);
    marked.block.classList.add("protyle-wysiwyg--select");
    await click(marked, "select");
    assertTextSelection(marked);

    // 有块菜单时继续支持再次全选，并通过现有多选菜单操作已选块。
    const documentEditor = createEditor(true);
    await click(documentEditor, "select");
    assertTextSelection(documentEditor);
    await click(documentEditor, "select");
    assert.equal(documentEditor.toolbar.isMultiSelectMode(), true);
    assert.equal(documentEditor.element.querySelectorAll(".protyle-wysiwyg--select").length, 2);
    documentEditor.toolbar.subElement.querySelector('[data-type="menu"]').click();
    assert.deepEqual(documentEditor.menus, [documentEditor.block]);
    documentEditor.toolbar.subElement.querySelector('[data-type="exitMultiSelectMode"]').click();
    assert.equal(documentEditor.element.querySelector(".protyle-wysiwyg--select"), null);
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
        const root = path.join(__dirname, "../src");
        const read = name => readFileSync(path.join(root, name + ".ts"), "utf8");
        const parse = name => ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true);
        const extract = (name, names) => {
            const source = parse(name);
            const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
                statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
            assert.equal(statements.length, names.length);
            return statements.map(statement => statement.getText(source)).join("\n");
        };
        const toolbarSource = parse("protyle/toolbar/index");
        const toolbarClass = toolbarSource.statements.find(statement => ts.isClassDeclaration(statement) &&
            statement.name.text === "Toolbar");
        const methodNames = ["showContent", "showMultiSelectMode", "isMultiSelectMode", "clearSubElement"];
        const methods = toolbarClass.members.filter(member => methodNames.includes(member.name?.getText(toolbarSource)));
        assert.equal(methods.length, methodNames.length);
        // 使用真实工具栏事件、选区和多选实现，隔离定位、原生键盘、剪贴板及字数统计。
        const source = [
            'const Constants = {ZWSP: "\\u200b"};',
            "const countSelectWord = () => {}; const countBlockWord = () => {};",
            "const revealTabsForTarget = () => {}; const getAtomicVerticalNavigationOwner = () => undefined;",
            "const activeBlur = () => {}; const showMessage = () => {}; const showSelectAllIncompleteTip = () => {};",
            "const setPosition = () => {}; const getSelectionPosition = (_node, range) => range.getBoundingClientRect();",
            "const stripSemanticMarkersFromRangeText = range => range.toString();",
            read("protyle/util/hasClosest"),
            read("protyle/wysiwyg/blockSelection"),
            read("protyle/toolbar/subElementLifecycle"),
            read("mobile/util/multiSelectToolbar"),
            extract("protyle/wysiwyg/getBlock", ["getContenteditableElement"]),
            extract("protyle/ui/hideElements", ["hideElements"]),
            extract("protyle/util/selection", ["selectIsEditor", "selectAll", "getSelectionOffset", "focusByRange", "getEditorRange"]),
            "class ContentToolbar { private readonly LINE_HEIGHT = 32; render() {}\n" +
                methods.map(method => method.getText(toolbarSource)).join("\n") + "\n}",
            "window.ContentToolbar = ContentToolbar; window.focusContentRange = focusByRange;",
        ].join("\n");
        const compiled = ts.transpileModule(source, {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText;
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(`new Function("exports", ${JSON.stringify(compiled)})({})`);
        await win.webContents.executeJavaScript(`(${runCases.toString()})()`);
        console.log("Mobile content toolbar cases passed");
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
    require("node:test").it("keeps mobile selection actions usable with and without block menus", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-mobile-content-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Mobile content toolbar cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-mobile-content-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
