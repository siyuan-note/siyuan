const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const rendererModules = () => {
    const ts = require("typescript");
    const root = path.join(__dirname, "../src/protyle");
    const modules = {};
    for (const name of ["verticalGeometry", "verticalVisibility", "verticalCaret", "verticalTarget",
        "verticalRegion", "verticalNavigation", "verticalNavigationState", "caretScroll", "caretScrollCore"]) {
        modules[`wysiwyg/${name}`] = readFileSync(path.join(root, "wysiwyg", `${name}.ts`), "utf8");
    }
    const extract = (file, names) => {
        const source = ts.createSourceFile(file, readFileSync(path.join(root, `${file}.ts`), "utf8"),
            ts.ScriptTarget.Latest, true);
        const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
        assert.equal(statements.length, names.length, file);
        return statements.map(statement => statement.getText(source)).join("\n");
    };
    // 使用实际选区、区域解析与标题按键入口；不挂载无关的工具栏及页签控制器。
    modules["util/selection"] = `const revealTabsForTarget = () => {};
        import {isAtomicVerticalNavigationRange} from "../wysiwyg/verticalNavigationState";
        import {getContenteditableElement} from "../wysiwyg/getBlock";
        import {hasClosestBlock} from "./hasClosest";\n` +
        extract("util/selection", ["setFirstNodeRange", "setLastNodeRange", "focusByRange", "focusBlock", "getEditorRange"]);
    modules["util/hasClosest"] = readFileSync(path.join(root, "util/hasClosest.ts"), "utf8");
    modules["wysiwyg/getBlock"] = 'import {hasClosestBlock, hasClosestByClassName} from "../util/hasClosest";\n' +
        extract("wysiwyg/getBlock", ["getContenteditableElement", "isContainerBlock", "getNextBlock", "getPreviousBlock"]);
    modules["render/tabsRender"] = "export const setTabTitleNavigationEditing = () => false;";
    modules["../util/highlightById"] = "export const scrollCenter = () => {};";
    modules["render/av/focus"] = 'import {focusEditableAtGoalX} from "../../wysiwyg/verticalCaret";\n' +
        "const clearSelect = () => {};\n" +
        extract("render/av/focus", ["getVisibleAVTitle", "focusAVTitleByVerticalArrow", "focusAVVerticalRegion",
            "getOwnVisibleElements", "getClosestCell"]);
    const title = ts.createSourceFile("Title.ts", readFileSync(path.join(root, "header/Title.ts"), "utf8"),
        ts.ScriptTarget.Latest, true);
    let keydown;
    const visit = node => {
        if (ts.isCallExpression(node) && node.expression.getText(title) === "this.editElement.addEventListener" &&
            node.arguments[0]?.text === "keydown") {
            keydown = node.arguments[1].getText(title);
        }
        ts.forEachChild(node, visit);
    };
    visit(title);
    assert.ok(keydown, "actual document title keydown handler");
    modules["header/titleKeydown"] = title.statements.filter(statement => ts.isImportDeclaration(statement) &&
        ["../wysiwyg/verticalCaret", "../wysiwyg/verticalNavigation", "../wysiwyg/caretScroll"]
            .includes(statement.moduleSpecifier.text)).map(statement => statement.getText(title)).join("\n") +
        `\nconst commonHotkey = () => false, matchHotKey = () => false, electronUndo = () => false;
        const enterDocumentFromTitle = () => { window.titleEnterCalls++; };
        export function bind(protyle, editElement) {
            const handler = (function () { return ${keydown}; }).call({editElement});
            editElement.addEventListener("keydown", handler);
        }`;
    // 保留正文 keyup 中实际的选区校正、数据库回退及 preventKeyup 分支，不挂载后续工具栏更新。
    const wysiwyg = ts.createSourceFile("index.ts", readFileSync(path.join(root, "wysiwyg/index.ts"), "utf8"),
        ts.ScriptTarget.Latest, true);
    let keyupStatements;
    const visitKeyup = node => {
        if (ts.isCallExpression(node) && node.expression.getText(wysiwyg) === "this.element.addEventListener" &&
            node.arguments[0]?.text === "keyup" && node.arguments[1].getText(wysiwyg).includes("shouldRunAVKeyupFallback")) {
            const statements = Array.from(node.arguments[1].body.statements);
            const end = statements.findIndex(statement => ts.isIfStatement(statement) &&
                statement.expression.getText(wysiwyg) === "this.preventKeyup");
            assert.ok(end >= 0);
            keyupStatements = statements.slice(0, end + 1).map(statement => statement.getText(wysiwyg)).join("\n");
        }
        ts.forEachChild(node, visitKeyup);
    };
    visitKeyup(wysiwyg);
    assert.ok(keyupStatements);
    modules["wysiwyg/navigationKeyup"] = `import {getEditorRange} from "../util/selection";
        import {hasClosestBlock, hasClosestByClassName} from "../util/hasClosest";
        import {shouldRunAVKeyupFallback} from "../render/av/verticalNavigation";
        const getAVTemplateInteractiveElement = () => false;
        const focusAVByArrow = () => { throw new Error("Unexpected legacy AV keyup fallback"); };
        export function bind(protyle) {
            let arrowStartElement = protyle.wysiwyg.element;
            const handler = function(event) { ${keyupStatements} };
            protyle.wysiwyg.element.addEventListener("keyup", handler.bind(protyle.wysiwyg));
        }`;
    modules["render/av/verticalNavigation"] = readFileSync(path.join(root, "render/av/verticalNavigation.ts"), "utf8");
    return Object.fromEntries(Object.entries(modules).map(([name, source]) => [name,
        ts.transpileModule(source, {compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        }}).outputText]));
};

const runGeometryCases = async () => {
    const assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const {focusEditableAtGoalX, isCaretAtVerticalBoundary, getCaretGoalX} = window.verticalCaret;
    const {getReachableVerticalRects} = window.verticalVisibility;
    const select = (node, offset) => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return range;
    };
    const setup = (text, whiteSpace = "pre", height = 320) => {
        document.body.innerHTML = `<div class="layout" style="height:${height}px;width:500px;overflow:hidden">
            <div class="protyle-content" style="height:100%;overflow:auto">
                <div class="protyle-wysiwyg" contenteditable="true" style="font:20px/30px monospace">
                    <div data-node-id="before"><div id="before">before</div></div>
                    <div data-node-id="code" class="code-block"><div class="hljs" style="overflow:auto;max-height:140px">
                        <div id="code" contenteditable="true" style="white-space:${whiteSpace};min-height:30px"></div>
                    </div></div>
                    <div data-node-id="after"><div id="after">after</div></div>
                </div>
            </div>
        </div>`;
        const code = document.getElementById("code");
        code.textContent = text;
        const content = document.querySelector(".protyle-content");
        const editor = document.querySelector(".protyle-wysiwyg");
        const before = document.getElementById("before");
        const after = document.getElementById("after");
        editor.addEventListener("keydown", event => {
            if (!["ArrowUp", "ArrowDown"].includes(event.key)) {
                return;
            }
            const range = getSelection().getRangeAt(0);
            const source = [before, code, after].find(element => element.contains(range.startContainer));
            const direction = event.key === "ArrowUp" ? "up" : "down";
            if (!source || !isCaretAtVerticalBoundary(source, range, direction)) {
                return;
            }
            const index = [before, code, after].indexOf(source) + (direction === "up" ? -1 : 1);
            const target = [before, code, after][index];
            if (target) {
                focusEditableAtGoalX(target, direction, getCaretGoalX(range), content);
                event.preventDefault();
            }
        });
        editor.focus();
        select(after.firstChild, 0);
        return {code, content, before, after, scroller: code.parentElement};
    };
    const press = key => ipcRenderer.invoke("vertical-navigation-key", key);
    let cases = 0;
    for (const whiteSpace of ["pre", "pre-wrap"]) {
        for (const text of ["\na\n", "a\nb\n\nc\n", "x\n\n", "\n", "\n\n\n"]) {
            const {code, content} = setup(text, whiteSpace);
            const starts = [0];
            for (let offset = 0; offset < text.length - 1; offset++) {
                if (text[offset] === "\n") {
                    starts.push(offset + 1);
                }
            }
            for (const [index, offset] of starts.entries()) {
                const range = select(code.firstChild, offset);
                assert.equal(isCaretAtVerticalBoundary(code, range, "up"), index === 0,
                    `${whiteSpace} ${JSON.stringify(text)} offset ${offset} up`);
                assert.equal(isCaretAtVerticalBoundary(code, range, "down"), index === starts.length - 1,
                    `${whiteSpace} ${JSON.stringify(text)} offset ${offset} down`);
            }
            for (const direction of ["up", "down"]) {
                assert.equal(focusEditableAtGoalX(code, direction, 40, content), true, `enter ${JSON.stringify(text)}`);
                assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0),
                    direction === "up" ? "down" : "up"), true);
                assert.ok(getSelection().anchorOffset < text.length);
            }
            cases++;
        }
        const {code, before, after} = setup("x\n\n", whiteSpace);
        await press("Up");
        assert.equal(getSelection().anchorNode, code.firstChild, `first up ${whiteSpace}`);
        assert.equal(getSelection().anchorOffset, 2);
        await press("Up");
        assert.equal(getSelection().anchorNode, code.firstChild,
            `second up ${whiteSpace}: ${getSelection().anchorNode.parentElement.outerHTML}, ${getSelection().anchorOffset}`);
        assert.ok(getSelection().anchorOffset <= 1);
        await press("Up");
        assert.equal(getSelection().anchorNode, before.firstChild, `third up ${whiteSpace}`);
        await press("Down");
        await press("Down");
        assert.equal(getSelection().anchorNode, code.firstChild);
        assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), "down"), true);
        await press("Down");
        assert.equal(getSelection().anchorNode, after.firstChild);
        cases++;
    }
    for (const whiteSpace of ["pre", "pre-wrap"]) {
        for (const markup of ["<span>a\nb\n</span><span>\nc\n</span>", "<span>a\nb\n\nc</span>\n"]) {
            const {code, content} = setup("", whiteSpace);
            code.innerHTML = markup;
            const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
            let offset = 4;
            let node = walker.nextNode();
            while (node && offset > node.textContent.length) {
                offset -= node.textContent.length;
                node = walker.nextNode();
            }
            const range = select(node, offset);
            assert.equal(isCaretAtVerticalBoundary(code, range, "up"), false, markup);
            assert.equal(isCaretAtVerticalBoundary(code, range, "down"), false, markup);
            assert.equal(focusEditableAtGoalX(code, "up", 40, content), true);
            cases++;
        }
        const {code, content} = setup("", whiteSpace);
        code.innerHTML = "<span>x\n</span><span>\n</span>";
        const range = select(code.firstChild.firstChild, 2);
        assert.equal(isCaretAtVerticalBoundary(code, range, "up"), false);
        assert.equal(isCaretAtVerticalBoundary(code, range, "down"), true);
        assert.equal(focusEditableAtGoalX(code, "up", 40, content), true);
        assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), "up"), false);
        cases++;
    }
    for (const height of [180, 320]) {
        for (const direction of ["up", "down"]) {
            const {code, content, scroller} = setup(Array.from({length: 30}, (_, i) => `line ${i}`).join("\n") + "\n",
                "pre", height);
            scroller.scrollTop = direction === "down" ? scroller.scrollHeight : 0;
            content.scrollTop = direction === "down" ? content.scrollHeight : 0;
            assert.equal(focusEditableAtGoalX(code, direction, 40, content), true, `nested scroll ${height} ${direction}`);
            assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0),
                direction === "up" ? "down" : "up"), true);
            assert.ok(direction === "up" ? scroller.scrollTop > 0 : scroller.scrollTop < 30);
            cases++;
        }
    }
    for (const font of ["14px/23px monospace", "28px/46px monospace"]) {
        const {code, content, scroller} = setup(`${"wrapped ".repeat(30)}\n\n`, "pre-wrap");
        code.style.font = font;
        const goalX = scroller.getBoundingClientRect().right - 25;
        assert.equal(focusEditableAtGoalX(code, "down", goalX, content), true);
        assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), "up"), true);
        const contentRange = document.createRange();
        contentRange.selectNodeContents(code);
        const firstLine = contentRange.getClientRects()[0];
        const expectedX = Math.max(firstLine.left, Math.min(goalX, firstLine.right));
        assert.ok(Math.abs(getSelection().getRangeAt(0).getBoundingClientRect().left - expectedX) < parseFloat(font),
            `${font}: goal ${goalX}, caret ${getSelection().getRangeAt(0).getBoundingClientRect().left}, offset ${getSelection().anchorOffset}`);
        assert.equal(focusEditableAtGoalX(code, "up", goalX, content), true);
        assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), "up"), false);
        assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), "down"), true);
        cases++;
    }
    {
        const {code, content} = setup("");
        for (const direction of ["up", "down"]) {
            assert.equal(focusEditableAtGoalX(code, direction, 40, content), true);
            assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), direction), true);
        }
        assert.equal(code.innerHTML, "");
        cases++;
    }
    for (const direction of ["up", "down"]) {
        const text = direction === "down" ? `x\n${"long".repeat(200)}\n` : `${"long".repeat(200)}\nx\n`;
        const {code, content, scroller} = setup(text);
        scroller.scrollLeft = 1000;
        assert.equal(focusEditableAtGoalX(code, direction, 40, content), true, `horizontal scroll ${direction}`);
        assert.equal(scroller.scrollLeft, 0);
        cases++;
    }
    {
        const {code, content, scroller} = setup(`${"long".repeat(200)}\nlast\n`);
        scroller.scrollLeft = 1000;
        assert.equal(focusEditableAtGoalX(code, "down", 100, content), true);
        assert.equal(scroller.scrollLeft, 1000);
        assert.ok(Math.abs(getSelection().getRangeAt(0).getBoundingClientRect().left - 100) < 10);
        cases++;
    }
    for (const style of ["display:none", "visibility:hidden", "height:0;overflow:hidden", "height:0;overflow:clip"]) {
        const {code, content, after} = setup("hidden\n");
        code.parentElement.setAttribute("style", style);
        assert.equal(focusEditableAtGoalX(code, "up", 40, content), false, style);
        assert.equal(getSelection().anchorNode, after.firstChild);
        cases++;
    }
    const {code, content, after} = setup("folded\n");
    code.closest(".code-block").setAttribute("fold", "1");
    assert.equal(focusEditableAtGoalX(code, "down", 40, content), false);
    assert.equal(getSelection().anchorNode, after.firstChild);
    const range = document.createRange();
    range.selectNodeContents(code);
    code.closest(".code-block").removeAttribute("fold");
    code.parentElement.style.marginTop = "600px";
    content.style.overflow = "hidden";
    assert.deepEqual(getReachableVerticalRects(code, Array.from(range.getClientRects())), []);
    assert.equal(focusEditableAtGoalX(code, "down", 40, content), false);
    cases++;
    return cases;
};

const runEntryCases = async () => {
    const assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const {getVerticalCaretRect} = window.verticalCaret;
    const {scheduleCaretScroll, scheduleOffscreenCaretScroll} = window.caretScroll;
    const {focusAdjacentVerticalRegion, bindVerticalNavigationReset} = window.verticalNavigation;
    window.siyuan = {config: {editor: {fontSize: 20, cursorSurroundingLines: 0},
        keymap: {general: {enterBack: {custom: ""}}}}};
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const select = (element, offset = 0) => {
        const range = document.createRange();
        range.setStart(element.firstChild || element, offset);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    };
    const paragraph = '<div data-node-id="p" data-type="NodeParagraph"><div id="body" contenteditable="true">body</div></div>';
    const setup = markup => {
        document.body.innerHTML = `<div id="protyle" style="height:240px;width:500px;overflow:hidden;font:20px/30px monospace">
            <div class="protyle-content" style="height:100%;overflow:auto">
                <div id="title" contenteditable="true">title</div>
                <div class="protyle-wysiwyg" contenteditable="true">${markup}</div>
                <div style="height:240px"></div>
            </div></div>`;
        const editor = document.querySelector(".protyle-wysiwyg");
        const protyle = {element: document.getElementById("protyle"),
            contentElement: document.querySelector(".protyle-content"), wysiwyg: {element: editor}, disabled: false};
        const title = document.getElementById("title");
        window.titleKeydown.bind(protyle, title);
        bindVerticalNavigationReset(editor);
        title.focus();
        select(title);
        return {protyle, editor, title};
    };
    const visibleCaret = (protyle, editable) => {
        const caret = getVerticalCaretRect(editable, getSelection().getRangeAt(0));
        const viewport = protyle.contentElement.getBoundingClientRect();
        assert.ok(caret && caret.top >= viewport.top - 1 && caret.bottom <= viewport.bottom + 1,
            `caret ${caret?.top}..${caret?.bottom}, viewport ${viewport.top}..${viewport.bottom}`);
    };
    let cases = 0;
    for (const lines of [0, 1, 3]) {
        window.siyuan.config.editor.cursorSurroundingLines = lines;
        for (const whiteSpace of ["pre", "pre-wrap"]) {
            for (const tail of ["\n", "text\n"]) {
                const {protyle, editor} = setup(`<div data-node-id="code" data-type="NodeCodeBlock" class="code-block">
                    <div class="hljs"><div contenteditable="true" style="white-space:${whiteSpace}"></div></div></div>${paragraph}`);
                const code = editor.querySelector(".hljs").lastElementChild;
                code.textContent = "line\n".repeat(30) + tail;
                editor.focus();
                select(document.getElementById("body"));
                protyle.contentElement.scrollTop = 900;
                let keyups = 0;
                editor.addEventListener("keyup", () => keyups++);
                editor.addEventListener("keydown", event => {
                    if (event.key !== "ArrowUp") { return; }
                    scheduleCaretScroll(protyle, "up");
                    assert.equal(focusAdjacentVerticalRegion(protyle, editor.lastElementChild, "up", 30), "moved");
                    event.preventDefault();
                });
                await ipcRenderer.invoke("vertical-navigation-key", "Up");
                await frame();
                assert.equal(keyups, 1);
                assert.ok(code.contains(getSelection().anchorNode));
                visibleCaret(protyle, code);
                assert.ok(protyle.contentElement.scrollTop > 600,
                    `${lines}/${whiteSpace}/${JSON.stringify(tail)}: scroll ${protyle.contentElement.scrollTop}, ` +
                    `code height ${code.offsetHeight}, offset ${getSelection().anchorOffset}`);
                if (lines > 0) {
                    // 左右键的越界滚动与纵向按键使用同一空行坐标。
                    protyle.contentElement.scrollTop = 0;
                    scheduleOffscreenCaretScroll(protyle);
                    await frame();
                    visibleCaret(protyle, code);
                    // 排队后更换选区，回调必须读取新光标，而不是上一次的位置。
                    scheduleCaretScroll(protyle, "up");
                    select(code, 0);
                    await frame();
                    visibleCaret(protyle, code);
                    assert.ok(protyle.contentElement.scrollTop < 100);
                }
                cases++;
            }
        }
    }
    window.siyuan.config.editor.cursorSurroundingLines = 3;
    for (const guard of ["disabled", "detached", "nested", "atomic"]) {
        const {protyle, editor} = setup(paragraph);
        const body = document.getElementById("body");
        body.style.marginTop = "600px";
        select(body);
        scheduleCaretScroll(protyle, "down");
        if (guard === "disabled") { protyle.disabled = true; }
        if (guard === "detached") { protyle.element.remove(); }
        if (guard === "nested") { body.parentElement.classList.add("protyle-wysiwyg"); }
        if (guard === "atomic") { editor.firstElementChild.classList.add("protyle-wysiwyg--navigation"); }
        await frame();
        assert.equal(protyle.contentElement.scrollTop, 0, guard);
        cases++;
    }
    const callout = `<div class="callout" data-node-id="callout" data-type="NodeCallout">
        <div class="callout-info"><div id="target" class="callout-title" contenteditable="true">callout title</div></div>
        <div class="callout-content">${paragraph}</div></div>`;
    const variants = [
        [paragraph, "body", false],
        [callout, "target", false],
        [`<div class="bq" data-node-id="quote">${callout}</div>`, "target", false],
        [`<div id="target" class="bq" data-node-id="quote" fold="1">${paragraph}</div>`, "target", true],
        [callout.replace('class="callout"', 'class="callout" fold="1" id="folded"'), "folded", true],
        ["<div id=\"target\" class=\"custom-block\" data-type=\"NodeCustomBlock\" data-node-id=\"custom\">custom</div>", "target", true],
        [`<div class="av" data-type="NodeAttributeView" data-node-id="av">
            <div id="target" class="av__title" contenteditable="true">database title</div></div>`, "target", false],
        [`<div class="bq" data-node-id="hidden" style="display:none">hidden</div>${paragraph}`, "body", false],
        ["<div data-type=\"NodeTable\" data-node-id=\"table\"><table><tr><td id=\"target\" contenteditable=\"true\">cell</td></tr></table></div>", "target", false],
    ];
    window.titleEnterCalls = 0;
    for (const [markup, id, atomic] of variants) {
        const {protyle, editor} = setup(markup);
        const html = editor.innerHTML;
        let keyups = 0;
        editor.addEventListener("keyup", () => keyups++);
        window.navigationKeyup.bind(protyle);
        await ipcRenderer.invoke("vertical-navigation-key", "Down");
        await frame();
        const target = document.getElementById(id);
        assert.ok(target === getSelection().anchorNode || target.contains(getSelection().anchorNode), id);
        assert.equal(keyups, 1);
        assert.equal(protyle.wysiwyg.preventKeyup, false);
        assert.equal(editor.querySelectorAll(".protyle-wysiwyg--navigation").length, atomic ? 1 : 0);
        if (!atomic) { visibleCaret(protyle, target); }
        editor.querySelectorAll(".protyle-wysiwyg--navigation").forEach(element => {
            element.classList.remove("protyle-wysiwyg--navigation");
        });
        assert.equal(editor.innerHTML, html);
        cases++;
    }
    for (const guard of ["altKey", "shiftKey", "ctrlKey", "metaKey", "isComposing", "disabled", "selection", "empty"]) {
        const {protyle, title} = setup(guard === "empty" ? "" : callout);
        if (guard === "disabled") { protyle.disabled = true; }
        if (guard === "selection") { getSelection().getRangeAt(0).setEnd(title.firstChild, 3); }
        const event = new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true, [guard]: true});
        title.dispatchEvent(event);
        await frame();
        assert.ok(title.contains(getSelection().anchorNode), guard);
        assert.equal(protyle.wysiwyg.preventKeyup, undefined);
        cases++;
    }
    assert.equal(window.titleEnterCalls, 0, "arrows must not execute the mutating Enter workflow");
    for (const titleText of ["", "first\nlast"]) {
        const {title} = setup(paragraph);
        title.style.whiteSpace = "pre-wrap";
        title.style.minHeight = "30px";
        title.textContent = titleText;
        select(title);
        const firstDown = new KeyboardEvent("keydown", {key: "ArrowDown", cancelable: true});
        title.dispatchEvent(firstDown);
        if (titleText) {
            assert.equal(firstDown.defaultPrevented, false, "allow native movement inside a multiline title");
            assert.ok(title.contains(getSelection().anchorNode));
            select(title, titleText.length);
            title.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", cancelable: true}));
        }
        await frame();
        assert.ok(document.getElementById("body").contains(getSelection().anchorNode));
        cases++;
    }
    const {title} = setup(paragraph);
    title.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", cancelable: true}));
    assert.equal(window.titleEnterCalls, 1, "Enter keeps its existing workflow");
    return cases;
};

const runElectron = async () => {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 1000, height: 800, webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
        offscreen: true,
    }});
    ipcMain.handle("vertical-navigation-key", async (event, keyCode) => {
        const key = `Arrow${keyCode}`;
        const code = keyCode === "Up" ? 38 : 40;
        await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
            type: "keyDown", key, code: key, windowsVirtualKeyCode: code,
        });
        await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
            type: "keyUp", key, code: key, windowsVirtualKeyCode: code,
        });
    });
    let exitCode = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
        await win.webContents.executeJavaScript(`(() => {
            const sources = ${JSON.stringify(rendererModules())};
            const cache = {};
            const load = name => {
                if (!cache[name]) {
                    if (!sources[name]) { throw new Error("Unexpected module: " + name); }
                    cache[name] = {};
                    const resolve = dependency => load(require("node:path").posix.normalize(
                        require("node:path").posix.dirname(name) + "/" + dependency));
                    new Function("require", "exports", sources[name])(resolve, cache[name]);
                }
                return cache[name];
            };
            window.verticalCaret = load("wysiwyg/verticalCaret");
            window.verticalVisibility = load("wysiwyg/verticalVisibility");
            window.caretScroll = load("wysiwyg/caretScroll");
            window.verticalNavigation = load("wysiwyg/verticalNavigation");
            window.titleKeydown = load("header/titleKeydown");
            window.navigationKeyup = load("wysiwyg/navigationKeyup");
        })()`);
        const cases = await win.webContents.executeJavaScript(`(${runGeometryCases.toString()})()`);
        console.log(`Vertical navigation: ${cases} Electron geometry cases passed`);
        const entryCases = await win.webContents.executeJavaScript(`(${runEntryCases.toString()})()`);
        console.log(`Vertical navigation: ${entryCases} Electron entry cases passed`);
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
    const {it} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    it("keeps vertical caret lines and scroll reachability consistent in Electron", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-navigation-"));
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env,
                windowsHide: true,
                timeout: 40000,
            });
            assert.match(stdout, /Electron geometry cases passed/);
            assert.match(stdout, /Electron entry cases passed/);
        } finally {
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
