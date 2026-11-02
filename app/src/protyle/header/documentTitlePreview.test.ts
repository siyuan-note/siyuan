import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, tabSource: string, styles: Record<string, string>, themes: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const requests: Array<{data: {id: string, notebook: string}, reply: (value: unknown) => void}> = [];
    let renders = 0;
    const exports: {renderDocumentTitlePreview?: (element: HTMLElement, id: string, notebook: string,
        isCurrent: () => boolean, value?: any) => void,
        copyDocumentTitlePreview?: (source: HTMLElement, target: HTMLElement) => void} = {};
    new Function("exports", "require", source)(exports, (name: string) => {
        if (name === "../../util/fetch") return {fetchPost: (_url: string, data: {id: string, notebook: string},
            reply: (value: unknown) => void) => requests.push({data, reply})};
        if (name === "../../util/hostCapabilities") return {sanitizeKernelHTML: (html: string) => html};
        if (name === "../render/mathRender") return {mathRender: () => { renders++; }};
        if (name === "../../util/pathName") return {getDocDisplayName: (text: string, empty: boolean) => empty ? "Untitled" : text};
        throw new Error(name);
    });
    const render = exports.renderDocumentTitlePreview;
    const target = document.createElement("span");
    document.body.append(target);
    const result = (content: string, overrides = {}) => ({code: 0, data: {
        id: "document", notebook: "encrypted-box", format: "inline-ast", text: "Summary", empty: false,
        blockDOM: `<div data-type="NodeParagraph"><div contenteditable="true">${content}</div></div>`, ...overrides,
    }});
    const request = (isCurrent = () => true) => {
        render(target, "document", "encrypted-box", isCurrent);
        const pending = requests.shift();
        check.deepEqual(pending.data, {id: "document", notebook: "encrypted-box"});
        return pending;
    };
    const content = '<span data-type="strong em u s mark sup sub kbd code" style="color:red">Styles</span>' +
        '<span data-type="a" data-href="https://example.com">Link</span><span data-type="tag">Tag</span>' +
        '<span data-type="block-ref" data-id="target" data-subtype="d">Reference</span>' +
        '<span data-type="inline-memo" data-inline-memo-content="Memo">Note</span>' +
        '<span data-type="file-annotation-ref" data-id="assets/a.pdf/annotation">Annotation</span>' +
        '<span data-type="inline-math" data-subtype="math" data-content="x^2" contenteditable="false"></span>' +
        '<span class="img" contenteditable="false"><img src="assets/p.png" alt="Picture" title="Image title"></span>';
    request().reply(result(content));
    check.equal(target.querySelector('[data-type~="strong"]').getAttribute("style"), "color:red");
    check.equal(target.querySelector('[data-type="block-ref"]').getAttribute("data-id"), "target");
    check.equal(target.querySelector('[data-type="inline-memo"]').getAttribute("data-inline-memo-content"), "Memo");
    check.equal(target.querySelector('[data-type="file-annotation-ref"]').getAttribute("data-id"), "assets/a.pdf/annotation");
    check.equal(target.querySelector('[data-type="inline-math"]').getAttribute("data-content"), "x^2");
    check.equal(target.querySelector("img").getAttribute("src"), "assets/p.png");
    check.equal(target.querySelectorAll("[contenteditable], [spellcheck]").length, 0);
    check.equal(target.dataset.protyleLiteRender, "safe");
    check.equal(target.dataset.documentTitleId, "document");
    check.equal(renders, 1);
    const menuLabel = document.createElement("span");
    menuLabel.className = "b3-menu__label";
    document.body.append(menuLabel);
    exports.copyDocumentTitlePreview(target, menuLabel);
    check.equal(menuLabel.innerHTML, target.innerHTML, "tab dropdowns preserve all inline title elements");
    check.notEqual(menuLabel.firstChild, target.firstChild, "menu rendering keeps the tab's original DOM intact");
    check.equal(menuLabel.dataset.protyleLiteRender, "safe");
    check.equal(requests.length, 0, "menu previews reuse the loaded source without another request");
    const literal = document.createElement("span");
    literal.textContent = "**literal** <tag>";
    menuLabel.textContent = literal.textContent;
    menuLabel.className = "b3-menu__label";
    exports.copyDocumentTitlePreview(literal, menuLabel);
    check.equal(menuLabel.textContent, literal.textContent);
    check.equal(menuLabel.classList.contains("document-title-preview"), false, "ordinary dropdown labels stay plain");
    menuLabel.remove();
    const previous = target.innerHTML;
    const pending = request();
    check.equal(target.innerHTML, previous, "refreshing does not flash the rich label back to plain text");
    pending.reply(result("Changed"));
    check.equal(target.textContent, "Changed");
    const older = request();
    request().reply(result("Latest"));
    older.reply(result("Stale same-document response"));
    check.equal(target.textContent, "Latest", "same-document refreshes cannot overwrite a newer preview");
    request().reply(result("Wrong document", {id: "other"}));
    request().reply(result("Wrong notebook", {notebook: "other-box"}));
    request(() => false).reply(result("Switched"));
    check.equal(target.textContent, "Latest");
    const detached = request();
    target.remove();
    detached.reply(result("Locked secret"));
    check.equal(target.textContent, "Latest", "late responses cannot restore detached or locked title content");
    document.body.append(target);
    request().reply({code: -1, data: null});
    check.equal(target.textContent, "Latest", "a failed read retains the existing display");
    request().reply(result("", {format: "plain", text: "**literal** <tag> & slash/title"}));
    check.equal(target.textContent, "**literal** <tag> & slash/title");
    check.equal(target.querySelector("tag"), null);
    check.equal(target.classList.contains("document-title-preview"), false, "plain titles leave the rich rendering path");
    check.equal(target.dataset.protyleLiteRender, undefined);
    request().reply(result('<span class="img"><img src="assets/only.png" alt=""></span>', {text: "", empty: true}));
    check.equal(target.querySelector("img").getAttribute("src"), "assets/only.png", "empty summaries do not hide image-only titles");
    request().reply(result("", {text: "", empty: true}));
    check.equal(target.textContent, "Untitled");
    const tabExports: any = {};
    new Function("exports", "require", tabSource)(tabExports, (name: string) =>
        name === "../protyle/header/documentTitlePreview" ? exports : {});
    const header = document.createElement("li");
    header.innerHTML = '<span class="item__text"></span>';
    document.body.append(header);
    const label = header.querySelector<HTMLElement>(".item__text");
    const protyle = {block: {rootID: "document"}, notebookId: "encrypted-box"};
    const tab = Object.assign(Object.create(tabExports.Tab.prototype), {headElement: header, model: {editor: {protyle}}});
    render(label, "document", "encrypted-box", () => true, result('<span data-type="strong">Styled tab</span>').data);
    check.equal(requests.length, 0, "already loaded title sources do not cause a second request");
    tab.updateTitle("New summary");
    await Promise.resolve();
    check.equal(tab.title, "New summary", "persisted and window titles remain plain summaries");
    check.equal(label.querySelector('[data-type="strong"]').textContent, "Styled tab", "tab refreshes preserve rich content while pending");
    requests.shift().reply(result('<span data-type="em">New style</span>'));
    check.ok(label.querySelector('[data-type="em"]'));
    tab.updateTitle("Pending");
    await Promise.resolve();
    const previousTabRequest = requests.shift();
    protyle.block.rootID = "another";
    tab.updateTitle("**literal** <tag>");
    previousTabRequest.reply(result('<span data-type="strong">Old document</span>'));
    check.equal(label.textContent, "**literal** <tag>", "tab reuse rejects the previous document's response");
    check.equal(label.classList.contains("document-title-preview"), false);
    check.equal(requests.length, 0, "plain tab updates do not request rich rendering");
    protyle.block.rootID = "document";
    render(label, "document", "encrypted-box", () => true, result('<span data-type="strong">Current</span>').data);
    tab.updateTitle("Current source");
    render(label, "document", "encrypted-box", () => true, result('<span data-type="em">Already loaded</span>').data);
    await Promise.resolve();
    check.equal(requests.length, 0, "the editor's source update cancels redundant tab reads in the same turn");
    const center = (bounds: DOMRect) => bounds.top + bounds.height / 2;
    const textBoundsTop = (element: Element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().top;
    };
    const textOffset = (label: HTMLElement) => {
        const range = document.createRange();
        range.selectNodeContents(label.firstChild);
        return center(range.getBoundingClientRect()) - center(label.parentElement.getBoundingClientRect());
    };
    for (const [entry, css] of Object.entries(styles)) {
        document.head.innerHTML = `<style>${css}</style>`;
        document.body.innerHTML = "";
        for (const [fontSize, rowHeight] of [[14, 28], [20, 40]]) {
            document.body.style.cssText = `font: ${fontSize}px Arial;--b3-font-size:${fontSize}px;--b3-font-size-editor:72px;` +
                `--b3-ui-list-height:${rowHeight}px;--b3-ui-tab-min-height:${rowHeight}px`;
            const containers = [
                ["b3-list", "b3-list-item", "b3-list-item__text"],
                entry === "base" ? ["layout-tab-bar", "item", "item__text"] :
                    ["mobile-tabs", "mobile-tabs__item", "mobile-tabs__item-title"],
            ];
            for (const [containerClass, rowClass, labelClass] of containers) {
                const container = document.createElement("div");
                container.className = containerClass;
                container.style.width = "300px";
                const rows = `<div class="${rowClass}"><span class="${labelClass}"><span>Aligned</span></span></div>` +
                    `<div class="${rowClass}"><span class="${labelClass}"></span></div>`;
                container.innerHTML = containerClass === "mobile-tabs" ? `<div class="mobile-tabs__list">${rows}</div>` : rows;
                document.body.append(container);
                const list = containerClass === "mobile-tabs" ? container.firstElementChild : container;
                const plain = list.firstElementChild.firstElementChild as HTMLElement;
                const rich = list.lastElementChild.firstElementChild as HTMLElement;
                for (const content of ["<span>Aligned</span>", '<span data-type="strong em">Aligned</span> <span data-type="code">Code</span>']) {
                    render(rich, "document", "encrypted-box", () => true, result(content).data);
                    check.equal(getComputedStyle(rich).fontSize, getComputedStyle(plain).fontSize,
                        `${entry} ${labelClass} at ${fontSize}px uses the same default font size for rich and plain titles`);
                    check.ok(Math.abs(textOffset(rich) - textOffset(plain)) <= 1,
                        `${entry} ${labelClass} at ${fontSize}px keeps rich and plain text vertically aligned: ` +
                        JSON.stringify({rich: textOffset(rich), plain: textOffset(plain)}));
                    check.ok(Math.abs(rich.parentElement.getBoundingClientRect().height - plain.parentElement.getBoundingClientRect().height) <= 1,
                        `${entry} ${labelClass} at ${fontSize}px preserves row height: ` +
                        JSON.stringify({rich: rich.parentElement.getBoundingClientRect().height,
                            plain: plain.parentElement.getBoundingClientRect().height}));
                }
                container.remove();
            }
        }
        document.body.style.cssText = "font:14px Arial;--b3-font-size:14px;--b3-font-size-editor:32px";
        const sample = '<span data-type="strong">粗体</span> <span data-type="em">斜体</span> ' +
            '<span data-type="code">代码块</span> <span data-type="mark">高亮</span> ' +
            '<span data-type="s">删除线</span> <span data-type="u">下划线</span> H<span data-type="sub">2</span>O ' +
            'x<span data-type="sup">2</span> <span data-type="kbd">Ctrl</span> <span data-type="a" data-href="https://example.com">链接</span>';
        const surfaces = [
            ["b3-list", "b3-list-item", "b3-list-item__text"],
            ["layout-tab-bar", "item", "item__text"],
            ["b3-menu", "b3-menu__item", "b3-menu__label"],
            ...(entry === "mobile" ? [["mobile-tabs", "mobile-tabs__item", "mobile-tabs__item-title"],
                ["toolbar mobile-topbar", "toolbar__title toolbar__title--readonly", ""]] : []),
        ];
        for (const [containerClass, rowClass, labelClass] of surfaces) {
            const container = document.createElement("div");
            container.className = containerClass;
            container.innerHTML = `<div class="${rowClass}"><span class="${labelClass}"></span></div>`;
            document.body.append(container);
            const preview = container.firstElementChild.firstElementChild as HTMLElement;
            render(preview, "document", "encrypted-box", () => true, result(sample).data);
            const plain = document.createElement("span");
            plain.className = labelClass;
            plain.textContent = "Plain title";
            container.firstElementChild.append(plain);
            const themeStyle = document.createElement("style");
            const snippet = document.createElement("style");
            document.head.append(themeStyle, snippet);
            for (const [theme, themeCSS] of Object.entries(themes)) {
                themeStyle.textContent = themeCSS;
                for (const outline of labelClass === "b3-list-item__text" ? [false, true] : [false]) {
                    preview.classList.toggle("outline-document-title", outline);
                    const defaultFontSize = getComputedStyle(plain).fontSize;
                    for (const fontSize of ["", "15.5px", "20px", ""]) {
                        snippet.textContent = labelClass && fontSize ? `.${labelClass} {font-size: ${fontSize}}` : "";
                        const expected = getComputedStyle(plain).fontSize;
                        if (labelClass === "b3-list-item__text") {
                            check.equal(expected, fontSize || defaultFontSize,
                                `${entry} ${theme} tree labels apply single-class font overrides`);
                        }
                        check.equal(getComputedStyle(preview).fontSize, expected,
                            `${entry} ${theme} ${labelClass} outline=${outline} respects single-class font overrides and disabling snippets`);
                        check.equal(getComputedStyle(preview.querySelector('[data-type="strong"]')).fontSize, expected);
                        for (const type of ["sub", "sup"]) {
                            check.ok(Math.abs(parseFloat(getComputedStyle(preview.querySelector(`[data-type="${type}"]`)).fontSize) -
                                parseFloat(expected) * 0.75) < 0.01, "inline scripts retain their relative font sizes");
                        }
                        check.equal(getComputedStyle(preview.querySelector('[data-type="strong"]')).fontWeight, "700");
                    }
                }
            }
            preview.classList.remove("outline-document-title");
            themeStyle.remove();
            snippet.remove();
            plain.remove();
            const html = preview.innerHTML;
            for (const width of [900, 120, 80, 280, 900]) {
                container.style.width = `${width}px`;
                const code = preview.querySelector('[data-type="code"]');
                const mark = preview.querySelector('[data-type="mark"]');
                const first = preview.querySelector('[data-type="strong"]');
                check.equal(code.getClientRects().length, 1, `${entry} ${containerClass} at ${width}px keeps inline code on one line`);
                check.ok(Math.abs(textBoundsTop(mark) - textBoundsTop(first)) <= 1,
                    `${entry} ${containerClass} at ${width}px keeps text after code on the same line`);
                check.equal(preview.innerHTML, html, "resizing never drops title content or styles");
            }
            container.remove();
        }
        const body = document.createElement("div");
        body.className = "b3-typography";
        body.style.width = "80px";
        body.innerHTML = '<p><span data-type="code">body code with spaces that needs to wrap across several lines</span></p>';
        document.body.append(body);
        check.ok(body.querySelector("span").getClientRects().length > 1, "ordinary body inline code retains wrapping");
        body.remove();
    }
    return "Outline document title cases passed";
};

test("document title previews preserve custom font sizes, vertical alignment, inline content and notebook-bound request lifetimes", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "documentTitlePreview.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const tabSource = transpileModule(readFileSync(path.join(__dirname, "../../layout/Tab.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const css = (file: string) => compile(path.join(__dirname, file), {logger: {warn() {}, debug() {}}}).css;
    const styles = {base: css("../../assets/scss/base.scss"), mobile: css("../../assets/scss/mobile.scss")};
    const themes = {
        daylight: readFileSync(path.join(__dirname, "../../../appearance/themes/daylight/theme.css"), "utf8"),
        midnight: readFileSync(path.join(__dirname, "../../../appearance/themes/midnight/theme.css"), "utf8"),
    };
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-outline-title-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(source) + "," + JSON.stringify(tabSource) + "," + JSON.stringify(styles) + "," + JSON.stringify(themes) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Outline document title cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-outline-title-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
