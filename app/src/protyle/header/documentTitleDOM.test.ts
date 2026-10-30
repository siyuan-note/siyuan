import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";
import {compile} from "sass";

const browserCases = (sources: string[], lutePath: string, styles: string[]) => {
    const check: typeof assert = require("node:assert/strict");
    Object.assign(window, {siyuan: {languages: {block: "Block", documentTitleInlineOnly: "Inline only",
        _kernel: {16: "Untitled document"}}}});
    const unwrap = new Function(sources[0] + "\nreturn unwrapLongTextRuns;")();
    const restore = new Function("unwrapLongTextRuns", sources[1] + "\nreturn restoreInlineElementBoundaries;")(unwrap);
    const {prepareDocumentTitleBlockDOM: prepare, prepareDocumentTitleInitialDOM: initial, getDocumentTitleUnsupportedPasteBlocks: unsupported,
        getDocumentTitleDOMFingerprint: fingerprint, getDocumentTitleLute: wrap} =
        new Function("restoreInlineElementBoundaries", sources[2] +
            "\nreturn {prepareDocumentTitleBlockDOM, prepareDocumentTitleInitialDOM, getDocumentTitleUnsupportedPasteBlocks, getDocumentTitleDOMFingerprint, getDocumentTitleLute};")(restore);
    const paragraph = (content: string, id = "20260101000000-abcdefg") =>
        `<div data-type="NodeParagraph" data-node-id="${id}" class="p"><div contenteditable="true" spellcheck="false">${content}</div></div>`;
    const source = paragraph(`<span data-type="strong em" style="color: red" data-custom="retained">Styled</span>
<span data-type="block-ref" data-id="20260101000001-abcdefg" data-subtype="d">Dynamic</span>
<span data-type="block-ref" data-id="20260101000002-abcdefg" data-subtype="s">Static</span>
<span data-type="a" data-href="https://example.org" data-title="Link title">Link</span>
<span data-type="tag">Tag</span><span data-type="inline-memo" data-inline-memo-content="memo &amp; text">Memo</span>
<span data-type="file-annotation-ref" data-id="assets/a.pdf/annotation">Annotation</span>
<span class="render-node" data-type="inline-math" data-subtype="math" data-content="x^2" contenteditable="false"></span>
<span class="img" contenteditable="false"><span><img src="assets/p.png" alt="Picture" style="width: 42px" title="Image title"></span></span>
<span data-type="kbd">Ctrl</span><span data-type="code">code</span><span data-type="u s mark sup sub">More styles</span>`);
    const rendered = prepare(source, "20260101000003-abcdefg");
    check.equal(unsupported(rendered).length, 0);
    const template = document.createElement("template");
    template.innerHTML = rendered;
    check.equal(template.content.firstElementChild.getAttribute("data-node-id"), "20260101000003-abcdefg");
    check.equal(template.content.querySelector('[data-custom="retained"]').textContent, "Styled");
    check.equal(template.content.querySelector("img").getAttribute("src"), "assets/p.png");
    check.equal(template.content.querySelector("img").style.width, "42px");
    check.equal(template.content.querySelector('[data-type="inline-memo"]').getAttribute("data-inline-memo-content"), "memo & text");
    check.equal(template.content.querySelector('[data-type="file-annotation-ref"]').getAttribute("data-id"), "assets/a.pdf/annotation");
    for (const invalid of [source + paragraph("Another"), '<div data-type="NodeHeading"><div contenteditable="true">Heading</div></div>',
        `<div data-type="NodeList">${source}</div>`, '<div data-type="NodeTable"></div>']) {
        check.equal(unsupported(invalid).length, 1);
        check.throws(() => prepare(invalid), /Inline only/);
    }
    const originalFingerprint = fingerprint(source);
    const math = template.content.querySelector('[data-type="inline-math"]');
    math.setAttribute("data-render", "true");
    math.innerHTML = '<span class="katex"><span>Rendered equation</span></span>';
    template.content.querySelector('[contenteditable="true"]').classList.add("protyle-title__input");
    template.content.querySelectorAll("[contenteditable]").forEach(item => item.setAttribute("contenteditable", "false"));
    template.content.querySelector(".img").classList.add("img--select");
    template.content.querySelector(".img").insertAdjacentHTML("beforeend", '<span class="img__alt">Picture</span>');
    check.equal(fingerprint(template.innerHTML), originalFingerprint, "render caches and readonly switching do not save source");
    template.content.querySelector<HTMLElement>('[data-custom="retained"]').style.color = "blue";
    check.notEqual(fingerprint(template.innerHTML), originalFingerprint, "format-only changes are source edits");
    check.notEqual(fingerprint(paragraph('<span data-type="block-ref" data-id="other" data-subtype="d">Dynamic</span>')),
        fingerprint(paragraph('<span data-type="block-ref" data-id="original" data-subtype="d">Dynamic</span>')),
        "reference identity remains significant");

    require(lutePath);
    const lute = wrap(Lute.New());
    lute.SetTextMark(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetTag(true);
    lute.SetInlineMath(true);
    lute.SetKramdownIAL(true);
    for (const text of ["# Heading", "- List", "1. Ordered", "> Quote", "```code", "---", "first\nsecond", "line\n\nline"]) {
        const spun = lute.SpinBlockDOM(paragraph(text));
        template.innerHTML = spun;
        check.equal(template.content.querySelectorAll('[data-type^="Node"]').length, 1, text);
        check.equal(template.content.firstElementChild.getAttribute("data-type"), "NodeParagraph", text);
        check.equal(template.content.querySelector("[contenteditable]").textContent, text, text);
    }
    template.innerHTML = lute.SpinBlockDOM(paragraph("**Bold** and `code`"));
    check.equal(template.content.querySelector('[data-type~="strong"]').textContent, "Bold");
    check.equal(template.content.querySelector('[data-type~="code"]').textContent.replaceAll("\u2060", ""), "code");
    const legacyText = "**literal** [link](https://example.org) $x$ #tag# ((20260101000000-abcdefg)) \\path";
    template.innerHTML = initial(paragraph(legacyText), "20260101000000-abcdefg");
    template.content.querySelector("[contenteditable]").append(document.createTextNode(" and **new bold**"));
    template.innerHTML = lute.SpinBlockDOM(template.innerHTML);
    check.equal(template.content.querySelector("[contenteditable]").textContent, legacyText + " and new bold");
    check.equal(template.content.querySelectorAll('[data-type~="strong"]').length, 1);
    check.equal(template.content.querySelector('[data-type~="strong"]').textContent, "new bold");
    check.equal(template.content.querySelectorAll('[data-type~="a"], [data-type~="tag"], [data-type~="inline-math"], [data-type~="block-ref"]').length, 0,
        "ordinary edits must not reinterpret legacy literal syntax");
    template.innerHTML = lute.SpinBlockDOM(paragraph('<span data-type="strong" style="color: red">**literal** [link](url) $x$</span> and **new**'));
    check.equal(template.content.querySelectorAll('[data-type~="strong"]').length, 2);
    check.equal(template.content.querySelector('[data-type~="strong"]').textContent, "**literal** [link](url) $x$");
    check.equal(template.content.querySelector('[data-type~="strong"]').getAttribute("style"), "color: red");
    const liveTitle = document.createElement("div");
    liveTitle.innerHTML = paragraph('<span data-type="inline-math" data-subtype="math" data-content="x^2" ' +
        'data-render="true" class="render-node"><span class="katex">Rendered equation</span></span>');
    const stableLute = wrap(lute, () => liveTitle);
    const formula = '<span data-type="inline-math" data-subtype="math" data-content="x^2" ' +
        'contenteditable="false" class="render-node"></span>';
    template.innerHTML = stableLute.SpinBlockDOM(paragraph(formula + "123"));
    check.equal(template.content.querySelector(".katex").textContent, "Rendered equation");
    check.equal(template.content.querySelector('[data-type="inline-math"]').getAttribute("data-render"), "true");
    check.equal(template.content.querySelector("[contenteditable]").classList.contains("protyle-title__input"), true);
    template.innerHTML = stableLute.SpinBlockDOM(paragraph(formula.replace("x^2", "x^3")));
    check.equal(template.content.querySelector(".katex"), null, "changed formula must render its new source");
    liveTitle.replaceChildren();
    template.innerHTML = stableLute.SpinBlockDOM(paragraph(formula.replace("</span>",
        '<span class="katex">Untrusted cache</span></span>')));
    check.equal(template.content.querySelector(".katex"), null, "input HTML cannot supply trusted render caches");

    const Editor = new Function(sources[3] + "\nreturn DocumentTitleEditor;")();
    const container = document.createElement("div");
    container.className = "protyle-title";
    container.innerHTML = '<div class="protyle-title__rich"><div class="protyle-wysiwyg"></div></div>';
    document.body.appendChild(container);
    const wysiwyg = container.querySelector<HTMLElement>(".protyle-wysiwyg");
    const editor = Object.assign(Object.create(Editor.prototype), {fragment: {wysiwyg}, onEditable: () => {}});
    const style = document.createElement("style");
    document.head.appendChild(style);
    for (const css of styles) {
        style.textContent = css;
        // Loading, clearing and restoring a title all replace its temporary paragraph.
        for (const content of ["", "Named title", "", "image", ""]) {
            wysiwyg.innerHTML = lute.SpinBlockDOM(content === "image" ? lute.Md2BlockDOM("![](assets/p.png)") : paragraph(content));
            if (content === "image") check.ok(wysiwyg.querySelector("img"), "the native empty-alt image remains in the title");
            const savedFingerprint = fingerprint(wysiwyg.innerHTML);
            editor.updateEditable();
            const editable = editor.editable as HTMLElement;
            check.equal(editable.dataset.tip, "Untitled document");
            const placeholder = getComputedStyle(editable, "::after").content;
            if (content === "") {
                check.equal(placeholder, '"Untitled document"', "empty titles retain the localized placeholder");
                editable.contentEditable = "false";
                check.equal(getComputedStyle(editable, "::after").content, placeholder, "readonly titles retain the placeholder");
            } else {
                check.ok(placeholder === "none" || placeholder === "normal",
                    `text and empty-alt images are not empty titles: ${JSON.stringify({content, placeholder, html: editable.innerHTML})}`);
            }
            check.equal(fingerprint(wysiwyg.innerHTML), savedFingerprint, "placeholder decoration cannot dirty the title source");
            check.ok(!prepare(wysiwyg.innerHTML).includes("data-tip"), "placeholder text is not serialized into title content");
            const observer = new MutationObserver(() => {});
            observer.observe(editable, {attributes: true});
            editor.updateEditable();
            check.equal(observer.takeRecords().length, 0, "repeated decoration cannot create an observer feedback loop");
            observer.disconnect();
        }
    }
    container.remove();
    style.remove();
    return "Document title DOM cases passed";
};

test("native document title DOM preserves inline content, format edits, paragraph-only parsing and empty placeholders", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const sources = ["../util/longTextWrap.ts", "../util/inlineElementBoundary.ts", "documentTitleDOM.ts", "documentTitleEditor.ts"].map(file =>
        transpileModule(readFileSync(path.join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-title-dom-test-"));
    const script = path.join(temporary, "run.cjs");
    const styles = ["base", "mobile"].map(entry => compile(path.resolve(__dirname,
        "../../assets/scss", `${entry}.scss`), {logger: {warn() {}, debug() {}}}).css);
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(sources) + "," +
        JSON.stringify(path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js")) + "," + JSON.stringify(styles) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    win.webContents.on("console-message", event => console.error(event.message));
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
        assert.match(result.stdout, /Document title DOM cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-title-dom-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
