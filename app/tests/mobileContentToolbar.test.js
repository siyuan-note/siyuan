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
        window.bindContentDoubleClick.call({element}, protyle);
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

    // 双击文字选区复用内容工具栏，折叠选区、数据库与块多选不触发。
    for (const table of [false, true]) {
        const state = createEditor(false, table);
        state.toolbar.subElement.classList.add("fn__none");
        state.editable.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        assert.equal(state.toolbar.subElement.classList.contains("fn__none"), false);
        assert.equal(getSelection().toString(), "lph");
        await click(state, "copy");
        assert.deepEqual(commands.at(-1), {command: "copy", text: "lph"});
        state.range.collapse(true);
        window.focusContentRange(state.range);
        state.editable.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        assert.equal(state.toolbar.subElement.classList.contains("fn__none"), true);
        state.range.setEnd(state.editable.firstChild, 4);
        window.focusContentRange(state.range);
        state.block.classList.add("av");
        state.editable.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        assert.equal(state.toolbar.subElement.classList.contains("fn__none"), true);
    }

    // Android 分词跨普通格式扩展选区，思源菜单使用扩展后的文字执行复制和剪切。
    const selectChinese = state => {
        const range = document.createRange();
        range.selectNodeContents(state.editable.querySelector("b"));
        range.setStart(state.editable.querySelector("b").firstChild, 0);
        range.setEnd(state.editable.querySelector("b").firstChild, 1);
        window.focusContentRange(range);
    };
    const nativeCalls = [];
    window.JSAndroid = {getWordSelection(text, start, end) {
        nativeCalls.push({text, start, end});
        const offset = text.indexOf("为什么");
        return JSON.stringify([offset, offset + 3]);
    }};
    for (const table of [false, true]) {
        for (const action of ["copy", "cut"]) {
            const state = createEditor(false, table);
            state.editable.innerHTML = "😀呀，为什么".replace("什么", "<b>什</b>么");
            selectChinese(state);
            state.editable.querySelector("b").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
            assert.equal(getSelection().toString(), "为什么");
            assert.equal(state.toolbar.range.toString(), "为什么");
            assert.deepEqual(nativeCalls.at(-1), {text: "😀呀，为什么", start: 5, end: 6});
            assert.equal(state.toolbar.subElement.classList.contains("fn__none"), false);
            await click(state, action);
            assert.deepEqual(commands.at(-1), {command: action, text: "为什么"});
        }
    }

    // 特殊元素与隐藏标记切断分词上下文，已选词语、英文和代码块不重新分词。
    for (const boundary of ['<span data-type="code">为</span>', "为\u200b", '<a href="#">为</a>']) {
        const state = createEditor(false);
        state.editable.innerHTML = boundary + "<b>什</b>么";
        selectChinese(state);
        window.JSAndroid.getWordSelection = (text, start, end) => {
            assert.deepEqual({text, start, end}, {text: "什么", start: 0, end: 1});
            return "[0,2]";
        };
        assert.equal(window.expandAndroidWordSelection(state.block).toString(), "什么");
    }
    window.JSAndroid.getWordSelection = () => { throw new Error("Unexpected native call"); };
    const english = createEditor(false);
    assert.equal(window.expandAndroidWordSelection(english.block), undefined);
    assert.equal(getSelection().toString(), "lph");
    const special = createEditor(false);
    special.editable.innerHTML = "为<b>什</b>么";
    selectChinese(special);
    special.block.setAttribute("data-type", "NodeCodeBlock");
    assert.equal(window.expandAndroidWordSelection(special.block), undefined);
    special.block.setAttribute("data-type", "NodeParagraph");
    special.editable.querySelector("b").setAttribute("data-type", "block-ref");
    assert.equal(window.expandAndroidWordSelection(special.block), undefined);
    special.editable.querySelector("b").removeAttribute("data-type");
    const wordRange = getSelection().getRangeAt(0);
    wordRange.setStart(special.editable.firstChild, 0);
    wordRange.setEnd(special.editable.lastChild, 1);
    assert.equal(window.expandAndroidWordSelection(special.block), undefined);
    assert.equal(getSelection().toString(), "为什么");

    // 旧客户端、原生失败与无效偏移保留原选区，避免错误选中相邻内容。
    const fallback = createEditor(false);
    fallback.editable.innerHTML = "为<b>什</b>么";
    selectChinese(fallback);
    for (const reply of ["", "null", "{}", "[0]", "[-1,3]", "[0,4]", "[2,3]", "[0,1]", "[0,2.5]", "[1,2]"]) {
        window.JSAndroid.getWordSelection = () => reply;
        assert.equal(window.expandAndroidWordSelection(fallback.block), undefined);
        assert.equal(getSelection().toString(), "什");
    }
    window.JSAndroid.getWordSelection = () => { throw new Error("Unavailable"); };
    assert.equal(window.expandAndroidWordSelection(fallback.block), undefined);
    delete window.JSAndroid;
    fallback.editable.querySelector("b").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    assert.equal(fallback.toolbar.range.toString(), "什");
    await click(fallback, "copy");
    assert.deepEqual(commands.at(-1), {command: "copy", text: "什"});

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
        const wysiwygSource = read("protyle/wysiwyg/index");
        const doubleClickStart = wysiwygSource.indexOf('        this.element.addEventListener("dblclick",');
        const doubleClickEnd = wysiwygSource.indexOf("        let mobileBlur =", doubleClickStart);
        assert.ok(doubleClickStart > 0 && doubleClickEnd > doubleClickStart);
        // 使用真实工具栏事件、选区和多选实现，隔离定位、原生键盘、剪贴板及字数统计。
        const source = [
            'const Constants = {ZWSP: "\\u200b"};',
            "const countSelectWord = () => {}; const countBlockWord = () => {};",
            "const revealTabsForTarget = () => {}; const getAtomicVerticalNavigationOwner = () => undefined;",
            "const activeBlur = () => {}; const showMessage = () => {}; const showSelectAllIncompleteTip = () => {};",
            "const setPosition = () => {}; const getSelectionPosition = (_node, range) => range.getBoundingClientRect();",
            "const stripSemanticMarkersFromRangeText = range => range.toString();",
            "const getAVTemplateInteractiveElement = () => undefined; const getDiagramBlock = () => undefined;",
            "const isNotEditBlock = () => false;",
            "const contentMenu = (protyle, node) => protyle.toolbar.showContent(protyle, getSelection().getRangeAt(0), node);",
            read("protyle/util/hasClosest"),
            read("protyle/wysiwyg/blockSelection"),
            read("protyle/toolbar/subElementLifecycle"),
            read("mobile/util/multiSelectToolbar"),
            read("mobile/util/wordSelection"),
            "window.expandAndroidWordSelection = expandAndroidWordSelection;",
            extract("protyle/wysiwyg/getBlock", ["getContenteditableElement"]),
            extract("protyle/ui/hideElements", ["hideElements"]),
            extract("protyle/util/selection", ["selectIsEditor", "selectAll", "getSelectionOffset", "focusByRange", "getEditorRange"]),
            "class ContentToolbar { private readonly LINE_HEIGHT = 32; render() {}\n" +
                methods.map(method => method.getText(toolbarSource)).join("\n") + "\n}",
            "window.ContentToolbar = ContentToolbar; window.focusContentRange = focusByRange;",
            "window.bindContentDoubleClick = function(protyle) {" + wysiwygSource.slice(doubleClickStart, doubleClickEnd) + "};",
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
