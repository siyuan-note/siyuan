import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (sources: Record<string, string>, tagSource: string, focusSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const modules: Record<string, {exports: any}> = {};
    const load = (name: string) => {
        if (modules[name]) {
            return modules[name].exports;
        }
        const module = {exports: {}};
        modules[name] = module;
        new Function("require", "module", "exports", sources[name])((dependency: string) => {
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
        }, module, module.exports);
        return module.exports;
    };
    const marker: typeof import("../protyle/util/inlineElementMarker") = load("protyle/util/inlineElementMarker");
    const boundary: typeof import("../protyle/util/inlineElementBoundary") = load("protyle/util/inlineElementBoundary");
    const Constants = {WORD_JOINER: "\u2060", ZWSP: "\u200b", MENU_INLINE_TAG: "tag", ATTRIBUTE_MENU_KEYMAP: "data-keymap"};
    const focusByRange = (range: Range) => {
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    };
    const focusByWbr = new Function("Constants", "getSemanticMarkerPrefixLengthForNode", "hasPreviousSibling",
        "focusByRange", focusSource + "\nreturn focusByWbr;")(Constants, marker.getSemanticMarkerPrefixLengthForNode,
        (element: Element) => element.previousSibling, focusByRange);
    const lute = boundary.protectLuteInlineElementBoundaries(Lute.New());
    lute.SetTextMark(true);
    lute.SetTag(true);
    lute.SetKramdownIAL(true);
    lute.SetSpin(true);
    lute.SetProtyleWYSIWYG(true);
    const paragraph = (html: string) => '<div data-type="NodeParagraph" data-node-id="20261002180000-abcdefg" class="p">' +
        `<div contenteditable="true">${html}</div><div class="protyle-attr" contenteditable="false"></div></div>`;

    for (const operation of ["clear", "remove"]) {
        for (const surrounding of ["", "before\u2060", '<span data-type="code">neighbor</span>']) {
            const menuElement = document.createElement("div");
            document.body.append(menuElement);
            const options = new Map<string, IMenu>();
            const menu = {element: menuElement, removeCB: undefined as (() => void), remove() {},
                append: (element: Element) => menuElement.append(element), fullscreen() {}, popup() {}};
            Object.assign(window, {siyuan: {menus: {menu}, languages: {tag: "Tag"}}});
            class MenuItem {
                element: HTMLElement;
                constructor(option: IMenu) {
                    options.set(option.id, option);
                    this.element = document.createElement("div");
                    this.element.innerHTML = option.label || "";
                    option.bind?.(this.element);
                }
            }
            const editor = document.createElement("div");
            editor.contentEditable = "true";
            editor.innerHTML = paragraph('<span data-type="tag">example</span>' + surrounding);
            document.body.append(editor);
            const block = editor.firstElementChild;
            const content = block.firstElementChild;
            marker.normalizeSemanticInlineElements(content);
            const tag = content.querySelector<HTMLElement>('[data-type="tag"]');
            check.ok(tag.hasAttribute("data-inline-boundary"));
            let transaction = "";
            const dependencies = {
                Constants, MenuItem, focusByWbr, focusByRange,
                ...marker,
                hasClosestBlock: (element: Element) => element.closest('[data-type="NodeParagraph"]'),
                hideElements() {}, dayjs: () => ({format: () => "20261002180000"}),
                updateTransaction(_protyle: IProtyle, element: Element) {
                    transaction = boundary.restoreInlineElementBoundaryHTML(element.outerHTML);
                },
                emitOpenMenu() {}, hasTopClosestByClassName: (): null => null,
            };
            const tagMenu = new Function(...Object.keys(dependencies), tagSource + "\nreturn tagMenu;")(
                ...Object.values(dependencies));
            const range = document.createRange();
            range.selectNodeContents(tag);
            tagMenu({element: editor, toolbar: {range}}, tag);
            if (operation === "clear") {
                menuElement.querySelector("input").value = "";
                menu.removeCB();
            } else {
                options.get("remove").click(undefined, undefined);
            }
            check.equal(content.querySelector('[data-type="tag"]'), null);
            check.equal(range.collapsed, true);
            check.ok(content.contains(range.startContainer));
            const template = document.createElement("template");
            template.innerHTML = lute.SpinBlockDOM(transaction);
            const savedContent = template.content.querySelector('[contenteditable="true"]');
            if (surrounding === "") {
                check.equal(content.textContent, "", operation);
                check.equal(savedContent.textContent, "", operation);
                for (const [input, type] of [["- item", "NodeList"], ["> quote", "NodeBlockquote"]]) {
                    check.ok(lute.SpinBlockDOM(paragraph(savedContent.textContent + input)).includes(`data-type="${type}"`));
                }
            } else if (surrounding.startsWith("before")) {
                check.equal(content.textContent, "before\u2060");
                check.equal(savedContent.textContent, "before\u2060");
            } else {
                check.equal(marker.getSemanticInlineVisibleText(content.querySelector("span")), "neighbor");
                check.equal(savedContent.querySelector("span").getAttribute("data-type"), "code");
                check.equal(savedContent.textContent.replace(/[\u200b\u2060]/g, ""), "neighbor");
            }
            editor.remove();
            menuElement.remove();
        }
    }
    return "Tag deletion cases passed";
};

test("tag menu deletion removes structural boundaries and preserves surrounding content", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (text: string) => transpileModule(text, {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    const read = (name: string) => readFileSync(path.join(__dirname, "..", name + ".ts"), "utf8");
    const extract = (file: string, name: string) => {
        const source = createSourceFile(file, read(file), ScriptTarget.Latest, true);
        const declaration = source.statements.filter(isVariableStatement).flatMap(statement =>
            Array.from(statement.declarationList.declarations)).find(item => item.name.getText(source) === name);
        return compile(`const ${name} = ${declaration.initializer.getText(source)};`);
    };
    const sources = Object.fromEntries(["protyle/wysiwyg/compositionInput", "protyle/util/longTextWrap",
        "protyle/util/inlineElementBoundary", "protyle/util/inlineElementMarker"].map(name => [name, compile(read(name))]));
    const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ` +
        `${JSON.stringify(extract("menus/protyle", "tagMenu"))}, ${JSON.stringify(extract("protyle/util/selection", "focusByWbr"))})`;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-tag-menu-test-"));
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
        assert.match(result.stdout, /Tag deletion cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-tag-menu-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
