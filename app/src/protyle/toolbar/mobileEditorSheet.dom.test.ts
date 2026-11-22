import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {createSourceFile, isClassDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css + ".fixture-sheet {display:flex;flex-direction:column;width:320px;height:250px}" +
        ".fixture-sheet>.b3-dialog__body {display:flex;flex:1;flex-direction:column;min-height:0}";
    document.head.append(style);
    document.body.innerHTML = '<div id="editor"><div data-node-id="p"><div contenteditable="true">selected text</div></div></div>';
    const editor = document.getElementById("editor");
    const block = editor.querySelector<HTMLElement>("[data-node-id]");
    const editable = editor.querySelector<HTMLElement>("[contenteditable]");
    const dialogs: DialogFixture[] = [];
    const languages = new Proxy({}, {get: (_target, key) => String(key)});
    Object.assign(window, {siyuan: {dialogs, languages, config: {editor: {}}, menus: {menu: {remove() {}}}}});
    let drag: () => Promise<boolean>;
    let keyboard = 0;
    const messages: string[] = [];
    class DialogFixture {
        element = document.createElement("div");
        constructor(private options: {content: string; beforeClose?: () => boolean; destroyCallback?: () => void}) {
            this.element.innerHTML = '<div class="fixture-sheet"><div class="b3-dialog__body">' + options.content + "</div></div>";
            document.body.append(this.element);
            dialogs.push(this);
        }
        destroy() {
            if (this.options.beforeClose?.() === false || this.element.dataset.dialogClosing) return;
            this.element.dataset.dialogClosing = "true";
            this.element.remove();
            this.options.destroyCallback?.();
            dialogs.splice(dialogs.indexOf(this), 1);
        }
    }
    const closestBlock = (node: Node) =>
        (node instanceof Element ? node : node.parentElement)?.closest("[data-node-id]") || false;
    const focusByRange = (range: Range) => {
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    };
    const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
    const notify = (message: string) => messages.push(message);
    const modules: Record<string, object> = {
        "./index": {Dialog: DialogFixture},
        "../util/functions": {isMobile: () => true},
        "../mobile/util/bindBottomSheetDialog": {
            bindBottomSheetDialog: (_dialog: DialogFixture, close: () => Promise<boolean>, _resize: () => void, ready: () => void) => {
                drag = close;
                queueMicrotask(ready);
                return Object.assign(() => {}, {freeze() {}});
            },
        },
        "../mobile/util/mobileAppUtil": {callMobileAppShowKeyboard: () => keyboard++},
        "../mobile/util/visibleViewport": {scrollInputIntoView() {}},
        "../protyle/util/compatibility": {isNotCtrl: () => true},
        "./message": {showMessage: notify},
        "../../dialog/message": {showMessage: notify},
        "../protyle/util/hasClosest": {hasClosestBlock: closestBlock},
        "../util/selectionOffsets": {focusByRange},
        "../../util/escape": {escapeAttr: escape, escapeHtmlTextAndAttr: escape},
        "./ToolbarItem": {ToolbarItem: class {}},
        "../util/inlineMemo": {encodeInlineMemoContent: escape},
    };
    const load = (name: string) => {
        const exports = {};
        new Function("exports", "require", sources[name])(exports, (id: string) => modules[id] || {});
        return exports;
    };
    modules["../../dialog/adaptiveDialog"] = load("adaptive");
    modules["../../util/newFileSelection"] = load("range");
    const sheet = load("sheet") as typeof import("./mobileEditorSheet");
    const {setFontStyle} = load("font") as typeof import("./Font");
    const newFormula = document.createElement("span");
    setFontStyle(newFormula, {type: "inline-math"}, "&lt;");
    check.equal(newFormula.getAttribute("data-content"), "&amp;lt;");
    const requests: {url: string; key: string; reply: (value: unknown) => void}[] = [];
    const commits: unknown[][] = [];
    const previews: string[] = [];
    const env = {
        ...sheet, ...modules["../../util/newFileSelection"], ...load("navigation"),
        Constants: {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing", ALIAS_CODE_LANGUAGES: ["javascript", "rust"]},
        isMobile: () => true, dayjs: () => ({format: () => "20261122171500"}),
        hasClosestBlock: closestBlock, hasClosestByClassName: (node: Element, name: string) => node.closest("." + name),
        getHostCapabilities: () => ({}), hideElements() {}, isEncryptedBox: () => false,
        getConfiguredEntryVisibility: () => true, genHintItemHTML: (item: {id: string}) => item.id,
        escapeAttr: escape, escapeHtml: escape, escapeHtmlTextAndAttr: escape,
        encodeInlineMemoContent: (value: string) => escape(value),
        decodeInlineMemoContent: (value: string) => value.replaceAll("&amp;", "&"),
        areProtylePluginExtensionsEnabled: () => false, processRender() {}, focusByRange, focusByWbr() {},
        matchHotKey: () => false, electronUndo: () => false, focusBlock: () => {},
        getEditorRange: () => getSelection().getRangeAt(0),
        updateTransaction: () => commits.push(["update"]),
        searchRef: ({k}: {k: string}) => new Promise(resolve => requests.push({url: "reference", key: k, reply: resolve})),
        fetchPost: (url: string, {k}: {k: string}, reply: (value: unknown) => void) => requests.push({url, key: k, reply}),
        hintRenderWidget: (value: string, protyle: IProtyle) => commits.push(["widget", value, protyle.toolbar.range.toString()]),
        hintRenderTemplate: (path: string, protyle: IProtyle, _node: Element, token: string) =>
            commits.push(["template", path, protyle.toolbar.range.toString(), token]),
        previewTemplate: (path: string, host: HTMLElement) => { previews.push(path); host.textContent = path; },
        clearTemplatePreview: (host: HTMLElement) => { host.textContent = ""; },
        takeTemplateHTTPConfirmation: (_host: Element, value: string) => "token-" + value,
        Lute: {UnEscapeHTMLStr: (value: string) => value},
    };
    const make = (source: string) => new Function(...Object.keys(env), source)(...Object.values(env));
    const Toolbar = make(sources.toolbar);
    const Hint = make(sources.hint);
    const toolbar = new Toolbar();
    const hint = new Hint();
    Object.assign(toolbar, {
        element: document.createElement("div"), subElement: document.createElement("div"),
        setInlineMark: (_protyle: IProtyle, type: string, _mode: string, option: {color: string}) =>
            commits.push([type, option.color, toolbar.range.toString()]),
        updateLanguage: (_elements: HTMLElement[], _protyle: IProtyle, language: string) => commits.push(["language", language]),
    });
    let requestID = 0;
    hint.prepareCreateTarget = () => {
        const id = ++requestID;
        return {isCurrent: () => id === requestID, promise: Promise.resolve(false)};
    };
    hint.fill = (value: string, _protyle: IProtyle, _update: boolean, staticAnchor: boolean) =>
        commits.push(["reference", value, toolbar.range.toString(), staticAnchor]);
    const protyle = {toolbar, hint, path: "/test.sy", notebookId: "test", block: {rootID: "root", parentID: "root"},
        wysiwyg: {element: editor}, element: editor} as unknown as IProtyle;
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const current = () => dialogs.at(-1) as unknown as import("../../dialog/adaptiveDialog").AdaptiveDialog;
    const selectText = () => {
        const range = document.createRange();
        range.setStart(editable.firstChild, 0);
        range.setEnd(editable.firstChild, 8);
        focusByRange(range);
        toolbar.range = range;
        return range;
    };
    for (const [type, reason] of [["inline-memo", "drag"], ["inline-math", "back"]] as const) {
        selectText();
        toolbar.openNewInlineRenderSheet(protyle, type, "original");
        const field = current().element.querySelector("textarea");
        check.equal(field.value, "original");
        field.value = type === "inline-math" ? "x\n+y" : "draft";
        check.equal(commits.length, 0);
        await tick();
        check.equal(document.activeElement, field);
        if (reason === "drag") await drag();
        else await current().requestClose("back");
        check.deepEqual(commits.pop(), [type, type === "inline-math" ? "x+y" : "draft", "selected"]);
    }
    selectText();
    toolbar.openNewInlineRenderSheet(protyle, "inline-memo", "");
    current().element.querySelector("textarea").value = "discard";
    current().element.querySelector<HTMLButtonElement>('[data-action="cancel"]').click();
    check.equal(commits.length, 0);
    check.equal(getSelection().toString(), "selected");
    selectText();
    toolbar.openNewInlineRenderSheet(protyle, "inline-memo", "");
    const invalid = current();
    invalid.element.querySelector("textarea").value = "retain";
    protyle.path = "/different.sy";
    check.equal(await invalid.requestClose("back"), false);
    check.equal(invalid.element.querySelector("textarea").value, "retain");
    check.equal(messages.pop(), "settingsPendingSaveError");
    sheet.invalidateMobileEditorSheet(protyle);
    protyle.path = "/test.sy";

    for (const [type, attribute] of [["inline-memo", "data-inline-memo-content"], ["inline-math", "data-content"]]) {
        const mark = document.createElement("span");
        mark.dataset.type = type;
        if (type === "inline-math") mark.dataset.subtype = "math";
        mark.setAttribute(attribute, "old");
        editable.append(mark);
        selectText();
        toolbar.showRender(protyle, mark);
        const field = current().element.querySelector("textarea");
        check.equal(field.value, "old");
        field.value = type === "inline-math" ? "x\n+y" : "a&b";
        check.equal(mark.getAttribute(attribute), "old");
        check.equal(await current().requestClose("back"), true);
        check.equal(mark.getAttribute(attribute), type === "inline-math" ? "x+y" : "a&amp;b");
        check.deepEqual(commits.pop(), ["update"]);
        mark.remove();
    }

    const render = document.createElement("div");
    render.className = "render-node";
    render.dataset.type = "NodeMathBlock";
    render.dataset.subtype = "math";
    render.dataset.content = "old";
    block.append(render);
    selectText();
    toolbar.showRender(protyle, render);
    current().element.querySelector("textarea").value = "discard";
    await current().requestClose("cancel");
    check.equal(render.dataset.content, "old");
    selectText();
    toolbar.showRender(protyle, render);
    current().element.querySelector("textarea").value = "new source";
    await drag();
    check.equal(render.dataset.content, "new source");
    check.deepEqual(commits.pop(), ["update"]);
    selectText();
    toolbar.showRender(protyle, render);
    current().element.querySelector("textarea").value = "keep draft";
    render.dataset.content = "another change";
    check.equal(await current().requestClose("back"), false);
    check.equal(render.dataset.content, "another change");
    check.equal(current().element.querySelector("textarea").value, "keep draft");
    check.equal(messages.pop(), "settingsPendingSaveError");
    await current().requestClose("cancel");
    render.remove();

    selectText();
    hint.openMobileToolbarRefSearch(protyle, "selected");
    const firstRequest = requests.shift();
    const input = current().element.querySelector("input");
    check.equal(input.value, "selected");
    check.equal(firstRequest.key, "selected");
    input.value = "new query";
    input.dispatchEvent(new InputEvent("input"));
    requests.shift().reply({blocks: [{id: "target"}]});
    await tick();
    firstRequest.reply({blocks: [{id: "obsolete"}]});
    await tick();
    current().element.querySelector<HTMLButtonElement>("[data-value]").click();
    const reference = commits.pop();
    check.match(reference[1] as string, /data-id="target".*>selected<\/span>/);
    check.deepEqual(reference.slice(2), ["selected", true]);

    const language = document.createElement("span");
    language.textContent = "javascript";
    block.append(language);
    selectText();
    toolbar.showCodeLanguage(protyle, [language]);
    const languageInput = current().element.querySelector("input");
    languageInput.value = "rust";
    languageInput.dispatchEvent(new InputEvent("input"));
    current().element.querySelector<HTMLElement>('[data-id="rust"]').click();
    check.deepEqual(commits.pop(), ["language", "rust"]);
    language.remove();

    toolbar.showWidget(protyle, block, selectText());
    const widgetRequest = requests.shift();
    check.equal(widgetRequest.url, "/api/search/searchWidget");
    widgetRequest.reply({data: {widgets: Array.from({length: 30}, (_, index) =>
        ({path: "widget/" + index, name: "Widget", content: "widget-" + index}))}});
    const widgetList = current().element.querySelector<HTMLElement>(".editor-tool-sheet__list");
    check.ok(widgetList.scrollHeight > widgetList.clientHeight, "候选过多时列表在抽屉内滚动");
    widgetList.querySelector<HTMLElement>("[data-content]").click();
    check.deepEqual(commits.pop(), ["widget", "widget-0", "selected"]);

    toolbar.showTpl(protyle, block, selectText());
    const templateRequest = requests.shift();
    check.equal(templateRequest.url, "/api/search/searchTemplate");
    templateRequest.reply({data: {templates: [{path: "first", relativePath: "first.md", content: "First"},
        {path: "second", relativePath: "second.md", content: "Second"}]}});
    const template = current().element;
    template.querySelector<HTMLButtonElement>('[data-value="second"]').click();
    check.deepEqual(previews, ["first", "second"]);
    check.equal(commits.length, 0);
    template.querySelector<HTMLButtonElement>('[data-action="insert"]').click();
    check.deepEqual(commits.pop(), ["template", "second", "selected", "token-second"]);
    check.ok(keyboard >= 2, "输入抽屉在打开后请求软键盘");
    check.equal(dialogs.length, 0);
    return "Mobile editor sheets passed";
};

const transpile = (source: string) => transpileModule(source, {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const loadMethods = (path: string, className: string, names: string[], fields = "") => {
    const file = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.Latest, true);
    const declaration = file.statements.find(item => isClassDeclaration(item) && item.name?.text === className);
    assert.ok(declaration && isClassDeclaration(declaration));
    const methods = names.map(name => {
        const method = declaration.members.find(member => member.name?.getText(file) === name);
        assert.ok(method, name);
        return method.getText(file);
    });
    return transpile("return class " + className + " {" + fields + methods.join("\n") + "}");
};

test("mobile editor drawers save, cancel, search and restore their source selection", {
    timeout: 45000,
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
}, async () => {
    const files = {adaptive: "src/dialog/adaptiveDialog.ts", sheet: "src/protyle/toolbar/mobileEditorSheet.ts",
        range: "src/util/newFileSelection.ts", navigation: "src/util/upDownHint.ts", font: "src/protyle/toolbar/Font.ts"};
    const sources = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, transpile(readFileSync(file, "utf8"))]));
    sources.toolbar = loadMethods("src/protyle/toolbar/index.ts", "Toolbar",
        ["openNewInlineRenderSheet", "showRender", "showCodeLanguage", "showTpl", "showMobileTemplateSheet", "showWidget"],
        "private clearSubElement() {} private inlineRenderDraft?: string;");
    sources.hint = loadMethods("src/protyle/hint/index.ts", "Hint", ["openMobileToolbarRefSearch", "genSearchHTML"]);
    const css = compile("src/assets/scss/mobile.scss").css;
    const directory = mkdtempSync(join(tmpdir(), "siyuan-mobile-editor-sheet-"));
    const script = join(directory, "run.cjs");
    try {
        const browserSource = "const __name = value => value; (" + browserCases.toString() + ")(" +
            JSON.stringify(sources) + "," + JSON.stringify(css) + ")";
        writeFileSync(script, [
            'const {app, BrowserWindow} = require("electron");',
            'app.setPath("userData", ' + JSON.stringify(join(directory, "profile")) + ");",
            "app.disableHardwareAcceleration();",
            "app.whenReady().then(async () => {",
            "  const win = new BrowserWindow({show:false,width:360,height:640,",
            "    webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});",
            '  try { await win.loadURL("about:blank");',
            "    console.log(await win.webContents.executeJavaScript(" + JSON.stringify(browserSource) + "));",
            "    win.destroy(); app.exit(0);",
            "  } catch (error) { console.error(error); win.destroy(); app.exit(1); }",
            "});",
        ].join("\n"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron"), [script], {env, timeout: 32000, windowsHide: true});
        assert.match(result.stdout, /Mobile editor sheets passed/);
    } finally {
        assert.ok(directory.startsWith(join(tmpdir(), "siyuan-mobile-editor-sheet-")));
        rmSync(directory, {recursive: true, force: true});
    }
});
