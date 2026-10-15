import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, insertionSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const modules: Record<string, {exports: any}> = {};
    const load = (name: string): any => {
        if (modules[name]) {
            return modules[name].exports;
        }
        const module = {exports: {}};
        modules[name] = module;
        new Function("require", "module", "exports", sources[name])((dependency: string) => {
            const parts = name.split("/");
            parts.pop();
            dependency.split("/").forEach(part => {
                if (part === "..") parts.pop();
                else if (part !== ".") parts.push(part);
            });
            return load(parts.join("/"));
        }, module, module.exports);
        return module.exports;
    };
    const elementOf = (node: Node) => node.nodeType === 1 ? node as HTMLElement : node.parentElement;
    const hasClosestBlock = (node: Node) => elementOf(node)?.closest("[data-node-id]");
    const getContenteditableElement = (block: Element) => block.querySelector('[contenteditable="true"]');
    const focusByRange = (range: Range) => {
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    };
    const changes: Array<{oldHTML: string, html: string}> = [];
    const updateTransaction = (_protyle: IProtyle, block: Element, oldHTML: string) => {
        changes.push({oldHTML, html: block.outerHTML});
    };
    const dependencies = {
        hasClosestBlock, getContenteditableElement, focusByRange, updateTransaction,
        prepareInlineElementBoundaryMutation() {}, getBlockRanges: (): never[] => [],
        hasClosestByAttribute: (node: Node, name: string, value: string) => elementOf(node)?.closest(`[${name}="${value}"]`),
        hasClosestByClassName: (node: Node, name: string) => elementOf(node)?.closest(`.${name}`),
        hasClosestByTag: (node: Node, tag: string) => elementOf(node)?.closest(tag),
        isInEmbedBlock: (element: Element) => element.closest('[data-type="NodeBlockQueryEmbed"]'),
        getTextWithoutSemanticMarkers: (element: Element) => element.textContent,
        Constants: {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing", TIMEOUT_LOAD: 1},
        dayjs: () => ({format: () => "20261015000000"}), scrollCenter() {}, highlightRender() {},
        fixAdjacentTags() {},
        input: (protyle: IProtyle, block: Element, range: Range) => {
            updateTransaction(protyle, block, protyle.wysiwyg.lastHTMLs[block.getAttribute("data-node-id")]);
            focusByRange(range);
        },
        focusByWbr: (_block: Element, range: Range) => focusByRange(range),
    };
    const createInsertion = new Function(...Object.keys(dependencies), insertionSource + "return insertHTML;");
    const insertHTML = createInsertion(...Object.values(dependencies));
    modules["protyle/util/insertHTML"] = {exports: {insertHTML}};
    modules["protyle/util/hasClosest"] = {exports: dependencies};
    modules["protyle/wysiwyg/getBlock"] = {exports: {getContenteditableElement}};
    for (const name of ["protyle/render/blockRender", "protyle/util/processCode", "protyle/render/highlightRender",
        "protyle/render/av/render"]) {
        modules[name] = {exports: {blockRender() {}, processRender() {}, highlightRender() {}, avRender() {}}};
    }
    modules["protyle/runtimeCapabilities"] = {exports: {
        getProtyleBlockDOMSanitizer: (protyle: any) => protyle.sanitize,
        getProtyleUnsupportedPasteBlocks: (protyle: any) => protyle.unsupported,
    }};
    const {insertEditorContent} = load("plugin/insertContent") as typeof import("./insertContent");
    const memory = load("protyle/util/editorFocusMemory") as typeof import("../protyle/util/editorFocusMemory");
    const lute = Lute.New();
    lute.SetTextMark(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetSpin(true);
    const fixture = (text = "hello world", time = 1) => {
        const element = document.createElement("div");
        element.className = "protyle";
        const root = document.createElement("div");
        root.className = "protyle-wysiwyg";
        root.contentEditable = "true";
        root.innerHTML = lute.Md2BlockDOM(text);
        element.append(root);
        document.body.append(element);
        const dispose = memory.bindEditorFocusMemory(root);
        const editor = {protyle: {
            element, wysiwyg: {element: root, lastHTMLs: {}}, lute, disabled: false,
            toolbar: {getCurrentType: (): string[] => []}, model: {headElement: {dataset: {activetime: String(time)}}},
        }} as unknown as import("../protyle").Protyle;
        return {editor, root, element, dispose, content: () => root.querySelector('[contenteditable="true"]')};
    };
    const select = (node: Node, start: number, end = start) => {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        focusByRange(range);
        return range;
    };
    const outside = document.createElement("div");
    outside.textContent = "sidebar";
    document.body.append(outside);
    const leaveEditor = () => {
        outside.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        select(outside.firstChild, 0);
    };
    const first = fixture();
    select(first.content().firstChild, 5);
    leaveEditor();
    check.equal(insertEditorContent({data: "**bold**"}, [first.editor]).status, "inserted");
    check.equal(first.content().textContent, "hellobold world");
    check.ok(first.content().querySelector('[data-type="strong"]'));
    const undo = document.createElement("div");
    undo.innerHTML = changes.at(-1).oldHTML;
    check.equal(undo.querySelector('[contenteditable="true"]').textContent, "hello world");
    check.ok(changes.at(-1).html.includes("bold"));
    check.equal(getSelection().getRangeAt(0).collapsed, true);
    const caret = getSelection().getRangeAt(0);
    const prefix = document.createRange();
    prefix.selectNodeContents(first.content());
    prefix.setEnd(caret.startContainer, caret.startOffset);
    check.equal(prefix.toString(), "hellobold");
    const selected = fixture();
    select(selected.content().firstChild, 6, 11);
    leaveEditor();
    check.equal(insertEditorContent({data: "<em>there</em>", dataType: "html"}, [selected.editor]).status, "inserted");
    check.equal(selected.content().textContent, "hello there");
    check.ok(selected.content().querySelector('[data-type="em"]'));

    const older = fixture("older", 1);
    const newer = fixture("newer", 2);
    select(older.content().firstChild, 5);
    leaveEditor();
    select(newer.content().firstChild, 5);
    leaveEditor();
    check.equal(insertEditorContent({data: "!"}, [older.editor, newer.editor]).status, "inserted");
    check.equal(newer.content().textContent, "newer!");
    check.equal(older.content().textContent, "older");
    select(older.content().firstChild, 5);
    check.equal(insertEditorContent({data: "?"}, [older.editor, newer.editor]).status, "inserted");
    check.equal(older.content().textContent, "older?");
    leaveEditor();
    const explicit = select(older.content().firstChild, 0);
    leaveEditor();
    check.equal(insertEditorContent({data: "X", editor: older.editor, range: explicit}, [newer.editor]).status, "inserted");
    check.equal(older.content().textContent, "Xolder?");

    const unchanged = older.root.innerHTML;
    check.equal(insertEditorContent({data: "bad", editor: older.editor, range: select(outside.firstChild, 0)}, []).status,
        "invalid-range");
    older.editor.protyle.disabled = true;
    check.equal(insertEditorContent({data: "bad", editor: older.editor}, []).status, "readonly");
    older.editor.protyle.disabled = false;
    older.element.classList.add("fn__none");
    check.equal(insertEditorContent({data: "bad", editor: older.editor}, []).status, "no-editor");
    older.element.classList.remove("fn__none");
    older.root.classList.add("fn__none");
    check.equal(insertEditorContent({data: "bad", editor: older.editor}, []).status, "no-editor");
    older.root.classList.remove("fn__none");
    check.equal(older.root.innerHTML, unchanged);

    const stale = fixture("stale");
    select(stale.content().firstChild, 2);
    leaveEditor();
    stale.root.innerHTML = lute.Md2BlockDOM("replacement");
    check.equal(insertEditorContent({data: "bad"}, [stale.editor]).status, "invalid-range");
    check.equal(stale.content().textContent, "replacement");
    const changedText = fixture("old text");
    select(changedText.content().firstChild, 3);
    leaveEditor();
    changedText.content().firstChild.nodeValue = "new text";
    check.equal(insertEditorContent({data: "bad"}, [changedText.editor]).status, "invalid-range");
    check.equal(changedText.content().textContent, "new text");
    const fresh = fixture("fresh");
    check.equal(insertEditorContent({data: "bad"}, [fresh.editor]).status, "invalid-range");
    check.equal(insertEditorContent({data: "bad"}, []).status, "no-editor");
    select(fresh.content().firstChild, 0);
    check.equal(insertEditorContent({data: ""}, [fresh.editor]).status, "empty-content");
    check.throws(() => insertEditorContent({data: "bad", dataType: "dom" as "html"}, [fresh.editor]), TypeError);
    const embedded = fixture("embedded");
    embedded.root.firstElementChild.setAttribute("data-type", "NodeBlockQueryEmbed");
    select(embedded.content().firstChild, 0);
    check.equal(insertEditorContent({data: "bad"}, [embedded.editor]).status, "unsupported-range");
    const restricted = fixture("restricted");
    Object.assign(restricted.editor.protyle, {unsupported: () => ["NodeHeading"]});
    select(restricted.content().firstChild, 0);
    check.equal(insertEditorContent({data: "# heading", editor: restricted.editor}, []).status, "unsupported-content");
    check.equal(restricted.content().textContent, "restricted");
    const noneditable = fixture("immutable");
    const immutable = noneditable.content();
    immutable.setAttribute("contenteditable", "false");
    select(immutable.firstChild, 1);
    check.equal(insertEditorContent({data: "bad"}, [noneditable.editor]).status, "unsupported-range");
    check.equal(immutable.textContent, "immutable");

    const crossing = fixture("crossing");
    document.body.append(outside);
    const crossRange = select(crossing.content().firstChild, 0);
    crossRange.setEndAfter(outside);
    check.equal(insertEditorContent({data: "bad", editor: crossing.editor}, []).status, "invalid-range");
    check.equal(crossing.content().textContent, "crossing");

    const focusOnly = fixture("focus only");
    const input = document.createElement("input");
    document.body.append(input);
    focusOnly.root.focus();
    select(focusOnly.content().firstChild, 5);
    await new Promise(resolve => setTimeout(resolve, 0));
    input.focus();
    getSelection().removeAllRanges();
    check.equal(insertEditorContent({data: "X", editor: focusOnly.editor}, []).status, "inserted");
    check.equal(focusOnly.content().textContent, "focusX only");
    input.remove();

    const code = fixture("```\nhello world\n```");
    select(code.content().firstChild, 5);
    leaveEditor();
    check.equal(insertEditorContent({data: "<b>literal</b>", dataType: "html", editor: code.editor}, []).status, "inserted");
    check.ok(code.content().textContent.includes("hello<b>literal</b> world"));
    check.equal(code.content().querySelector("b"), null);

    for (const item of [first, selected, older, newer, stale, changedText, fresh, embedded, restricted,
        noneditable, crossing, focusOnly, code]) {
        item.dispose();
        item.element.remove();
        check.equal(memory.getRememberedEditorFocusRange(item.root), undefined);
    }
    return "Plugin content insertion cases passed";
};

test("plugin insertion uses the document selection across external UI focus changes", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (source: string) => transpileModule(source, {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    const read = (name: string) => readFileSync(path.resolve(__dirname, "..", name + ".ts"), "utf8");
    const sources = Object.fromEntries(["plugin/insertContent", "protyle/util/editorFocus",
        "protyle/util/editorFocusMemory"].map(name => [name, compile(read(name))]));
    const file = createSourceFile("insertHTML.ts", read("protyle/util/insertHTML"), ScriptTarget.Latest, true);
    const declaration = file.statements.filter(isVariableStatement).flatMap(statement =>
        Array.from(statement.declarationList.declarations)).find(item => item.name.getText(file) === "insertHTML");
    const insertionSource = compile(`const insertHTML = ${declaration.initializer.getText(file)};`);
    const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(insertionSource)})`;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-plugin-insertion-test-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(source)}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Plugin content insertion cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-plugin-insertion-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});

test("desktop and mobile insertion resolve document editors and honor an explicit target", () => {
    const source = readFileSync(path.join(__dirname, "API.ts"), "utf8");
    const file = createSourceFile("API.ts", source, ScriptTarget.Latest, true);
    const declaration = file.statements.filter(isVariableStatement).flatMap(statement =>
        Array.from(statement.declarationList.declarations)).find(item => item.name.getText(file) === "insertContent");
    for (const mobile of [false, true]) {
        let keep = true;
        const body = declaration.initializer.getText(file).split("\n").filter(line => {
            if (line.includes("/// #if MOBILE")) keep = mobile;
            else if (line.includes("/// #else")) keep = !mobile;
            else if (line.includes("/// #endif")) keep = true;
            else return keep;
            return false;
        }).join("\n");
        const compiled = transpileModule(`const insertContent = ${body};`, {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText;
        const primary = {};
        const popup = {};
        const auxiliary = {};
        const insert = new Function("getAllModels", "insertEditorContent", "window", compiled + "return insertContent;")(
            () => ({editor: [{editor: primary}], custom: [{editors: [auxiliary]}]}),
            (_options: unknown, editors: unknown[]) => editors,
            {siyuan: {mobile: {editor: primary, popEditor: popup, auxiliary}}},
        );
        assert.deepEqual(insert({data: "text"}), mobile ? [popup, primary] : [primary]);
        assert.deepEqual(insert({data: "text", editor: auxiliary}), []);
    }
});
