import * as assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve, dirname} from "node:path";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {compile} from "sass";

const cases = async (sources: Record<string, string>, styles: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const modules: Record<string, any> = {};
    const dependencies = {escapeHtml: (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
        escapeHtmlTextAndAttr: (value: string) => dependencies.escapeHtml(value), escapeAttr: (value: string) => dependencies.escapeHtml(value),
        sanitizeKernelHTML: (html: string) => html, restoreInlineElementBoundaries() {},
        Constants: {CUSTOM_SY_CODE_TAB_SPACES: "custom-sy-code-tab-spaces"}, CODE_TAB_SPACE_VALUES: [2, 4, 8],
        getAgentLute: () => {
            const lute = Lute.New();
            lute.SetTextMark(true);
            lute.SetProtyleWYSIWYG(true);
            lute.SetHTMLTag2TextMark(true);
            lute.SetKramdownIAL(true);
            lute.SetSpin(true);
            lute.SetBlockRef(true);
            return lute;
        },
        getAVBlockRefSubtype: (value: IAVCellValue) => value.block?.refSubtype || "d",
        hasAVRenderTemplateResult: (value: IAVCellValue) => Boolean(value.hasRenderTemplate),
        cloneAVCellValueSnapshot: (value: IAVCellValue) => JSON.parse(JSON.stringify(value)),
        renderAVBlockIcon: (_value: IAVCellValue, show: boolean) => show ? '<span class="b3-menu__avemoji"><svg><use href="#iconFile"></use></svg></span>' : "",
        getAVTemplateHTML: (html: string) => html, getHostCapabilities: () => ({remoteKernel: false}),
        usesAVRollupCellRenderer: () => false, isAVTextType: () => false, isAVDateType: () => false, isAVTimestampType: () => false};
    const load = (name: string) => {
        const exports = {};
        new Function("exports", "require", sources[name])(exports, (path: string) => modules[path.split("/").at(-1)] || dependencies);
        modules[name] = exports;
        return exports as any;
    };
    (window as any).siyuan = {languages: {empty: "Empty", untitled: "Untitled", openBy: "Open", bind: "Bind", rebind: "Rebind", more: "More", block: "Block", documentTitleInlineOnly: "Inline only"}, config: {editor: {}}};
    load("richTextValue");
    load("richText");
    const textImage = modules.richText.getAVRichTextBlockDOM("Before ![photo](assets/photo.png) after");
    const savedText = modules.richText.serializeAVRichTextBlockDOM(textImage);
    check.match(savedText.markdown, /!\[photo\]\(assets\/photo\.png\)/);
    const textPreview = document.createElement("template");
    textPreview.innerHTML = modules.richText.getAVRichTextPreviewHTML(savedText.markdown);
    check.equal(textPreview.content.querySelector("img")?.getAttribute("src"), "assets/photo.png");
    const primary = load("primaryRich");
    const position = load("insertPosition");
    const runtime = load("runtimeCapabilities");
    const pasteMocks = {
        "../../constants": {Constants: {ZWSP: "\u200b"}},
        "../runtimeCapabilities": {...runtime, getProtyleBlockDOMSanitizer: () => (html: string) => html,
            getProtylePasteTransform: (): undefined => undefined, isProtyleRichHTMLPasteEnabled: () => true,
            isProtyleUploadDisabled: () => false, areProtylePluginExtensionsEnabled: () => false,
            getProtyleUnsupportedPasteBlocks: () => modules.richText.getAVRichTextUnsupportedPasteBlocks},
        "../upload/insertPosition": position,
        "./selection": {getEditorRange: () => getSelection().getRangeAt(0)},
        "./hasClosest": {hasClosestBlock: (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest("[data-node-id]"),
            hasClosestByAttribute: (): undefined => undefined},
        "./compatibility": {isInHarmony: () => false},
        "./wpsPresentation": {extractWPSPresentationClipboard: (): undefined => undefined},
        "./mathPaste": {markdownMathPaste: (lute: Lute, text: string) => lute.Md2BlockDOM(text)},
        "./tableCellRichContext": {getTableCellRichContext: (): undefined => undefined},
        "./officeMath": {extractOfficeMathHTML: () => ""},
        "../ui/hideElements": {hideElements() {}},
        "./pictureImages": {normalizePictureImages() {}},
        "../upload/htmlLocalAssets": {getHTMLAssetSourceURL: (): undefined => undefined, resolveHTMLAssetURLs() {}},
        "./pasteSource": {extractCrossBlockPasteContext: (html: string) => ({html, nestedList: false})},
        "./queryEmbedClipboard": load("queryEmbedClipboard"),
        "./inlineElementMarker": {stripSemanticMarkersFromRangeText: (range: Range) => range.toString()},
        "./normalizeText": {removeZWJ: (text: string) => text},
        "./insertHTML": {insertHTML: (html: string, protyle: IProtyle) => {
            pasted.push(html);
            const range = protyle.toolbar.range;
            range.insertNode(range.createContextualFragment(html));
        }},
    };
    const pasted: string[] = [];
    const pasteExports: Record<string, any> = {};
    new Function("exports", "require", sources.paste)(pasteExports, (id: string) => pasteMocks[id as keyof typeof pasteMocks] || {});
    const pasteHost = document.createElement("div");
    pasteHost.innerHTML = primary.getAVPrimaryInitialDOM({type: "block", isDetached: true, block: {content: ""}});
    document.body.append(pasteHost);
    const pasteEditable = pasteHost.querySelector<HTMLElement>("[contenteditable]");
    const pasteRange = document.createRange();
    pasteRange.selectNodeContents(pasteEditable);
    pasteRange.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(pasteRange);
    await pasteExports.paste({wysiwyg: {element: pasteHost}, lute: Lute.New(), toolbar: {getCurrentType: (): string[] => []}, hint: {}}, {
        target: pasteEditable, preventDefault() {}, stopPropagation() {},
        clipboardData: {files: [], types: ["text/plain"], getData: (type: string) => type === "text/plain" ? "hello" : ""},
    });
    check.deepEqual(pasted, ["hello"]);
    check.equal(pasteEditable.textContent, "hello");
    pasteHost.remove();
    const attribute = load("attributeValue");
    Object.assign(dependencies, attribute);
    const {getStoredCellValueByElement} = load("cellValue");
    modules.cellValue = {...dependencies, getStoredCellValueByElement};
    const cell = load("cell");
    load("luteMarkdownSyntax");
    const parser = load("richTextEditorLute");
    const dom = (html: string) => `<div data-type="NodeParagraph" data-node-id="${Lute.NewNodeID()}"><div contenteditable="true">${html}</div></div>`;
    const source: IAVCellValue = {type: "block", id: "value", blockID: "row", isDetached: true,
        block: {content: "Summary", rich: {spec: 1, format: "inline-ast", content: "full source"}, richBlockDOM: dom(
            '<span data-type="strong em">Styled</span><span data-type="inline-math" data-subtype="math" data-content="x^2" contenteditable="false"></span><span class="img" data-type="img" contenteditable="false"><img src="assets/a.png" alt="Image"></span><span data-type="block-ref" data-id="target" data-subtype="d">Ref</span>')}};
    for (const detached of [true, false]) {
        const value = {...source, isDetached: detached, block: {...source.block, id: detached ? "" : "bound"}};
        for (const view of ["table", "gallery", "kanban", "list", "calendar"]) {
            const host = document.createElement("div");
            host.innerHTML = cell.renderCell(value, 0, false, view);
            const preview = host.querySelector<HTMLElement>(".av__celltext");
            check.equal(preview.localName, "div");
            check.equal(preview.querySelector('[data-type~="strong"]').textContent, "Styled");
            check.equal(preview.querySelector("img").getAttribute("alt"), "Image");
            check.equal(preview.querySelector('[data-type="inline-math"]').getAttribute("data-content"), "x^2");
            check.equal(preview.querySelector("[contenteditable]"), null);
            check.equal(cell.getCellText(host), "Summary");
            check.equal(cell.getCellValueText(value), "Summary");
            check.equal(detached ? preview.hasAttribute("data-id") : preview.dataset.id === "bound", !detached);
        }
        for (const html of [attribute.genAVValueHTML(value), attribute.genAVRelationHTML(value, "row", false),
            cell.renderCell({type: "rollup", rollup: {contents: [value]}}, 0, false)]) {
            const host = document.createElement("div"); host.innerHTML = html;
            check.equal(host.querySelector('[data-type~="strong"]').textContent, "Styled");
            check.equal(host.querySelector("[contenteditable]"), null);
        }
    }
    for (const detached of [false, true]) {
        const value = {...source, isDetached: detached, block: {...source.block, id: detached ? "" : "document",
            richBlockDOM: dom('<span data-type="strong">First</span><br>Second\nThird')}};
        templateLineBreaks(value);
    }
    function templateLineBreaks(value: IAVCellValue) {
        const host = document.createElement("div");
        host.innerHTML = primary.getAVPrimaryInitialDOM(value);
        check.ok(host.querySelector("br"), "bound and detached primary fields retain soft breaks on open");
        check.match(host.textContent, /Second\nThird/);
        const updated = primary.createAVPrimaryEditValue(host.innerHTML, value);
        host.innerHTML = updated.block.richBlockDOM;
        check.ok(host.querySelector("br") || host.textContent.includes("\n"), "primary edits preserve line breaks in the rich source");
        check.match(host.textContent, /Second\nThird/);
        check.equal(updated.isDetached, value.isDetached);
        check.equal(updated.block.id, value.block.id);
    }
    const plain: IAVCellValue = {type: "block", isDetached: true, block: {content: "**literal** <tag> &"}};
    const initial = primary.getAVPrimaryInitialDOM(plain);
    const template = document.createElement("template"); template.innerHTML = initial;
    check.equal(template.content.querySelector('[data-type="strong"]'), null);
    check.equal(template.content.querySelector("[contenteditable]").textContent, plain.block.content);
    const edit = primary.createAVPrimaryEditValue(dom('<span data-type="strong">Changed</span>'), source);
    check.equal(edit.block.content, "Changed");
    check.equal(edit.block.rich, null);
    check.equal(edit.isDetached, source.isDetached);
    check.equal(source.block.content, "Summary");
    for (const detached of [false, true]) {
        const host = document.createElement("div");
        host.innerHTML = dom('<span data-type="strong">Bold</span> <span data-type="a" data-href="https://example.com">Link</span> <span data-type="code">Code</span> tail');
        document.body.append(host);
        const editable = host.querySelector<HTMLElement>("[contenteditable]");
        editable.focus();
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        document.execCommand("insertLineBreak");
        document.execCommand("insertText", false, "Next");
        const updated = primary.createAVPrimaryEditValue(host.innerHTML, {...source, isDetached: detached});
        template.innerHTML = updated.block.richBlockDOM;
        check.equal(template.content.querySelectorAll('[data-type="NodeParagraph"]').length, 1);
        for (const type of ["strong", "a", "code"]) {
            check.ok(template.content.querySelector(`[data-type="${type}"]`), `${type} survives a primary soft line break`);
        }
        check.ok(template.content.querySelector("br") || template.content.textContent.includes("\n"), "primary soft line break remains in the save payload");
        check.match(updated.block.content, /Next/);
        host.remove();
    }
    const multiple = primary.createAVPrimaryEditValue(dom("a") + dom("b"), source);
    template.innerHTML = multiple.block.richBlockDOM;
    check.equal(template.content.querySelectorAll('[data-type="NodeParagraph"]').length, 2);
    check.equal(multiple.block.content, "a\nb");
    const blockValue = {...source, block: {...source.block, rich: {spec: 1, format: "kramdown", content: "first\n\n![image](assets/a.png)\n\n- second"}}};
    template.innerHTML = primary.getAVPrimaryPreviewHTML(blockValue);
    check.match(template.content.textContent, /first/);
    check.match(template.content.textContent, /second/);
    check.equal(template.content.querySelector("img").getAttribute("src"), "assets/a.png");
    check.equal(template.content.querySelector("[contenteditable]"), null);
    const style = document.createElement("style");
    document.head.append(style);
    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = 480;
    imageCanvas.height = 640;
    const imageSource = imageCanvas.toDataURL();
    const textWithImage = {type: "text", text: {content: "First\nSecond\nThird",
        rich: {spec: 1, format: "kramdown", content: "First\n\nSecond ![photo](assets/photo.png) after\n\nThird"}}};
    for (const [entry, css] of Object.entries(styles)) {
        style.textContent = css;
        for (const refSubtype of ["d", "s"] as const) {
            const value: IAVCellValue = {type: "block", block: {id: "bound", refSubtype,
                content: "A long plain primary key that needs an ellipsis in a narrow column"}};
            const host = document.createElement("div");
            host.className = "protyle-wysiwyg";
            host.innerHTML = '<div class="av" data-type="NodeAttributeView" data-node-id="database" data-av-type="table"><div class="av__row"><div class="av__cell" data-dtype="block" data-wrap="false" style="width:160px"></div></div></div>';
            document.body.append(host);
            const cellElement = host.querySelector(".av__cell");
            cellElement.innerHTML = cell.renderCell(value, 0, false, "table");
            const preview = cellElement.querySelector<HTMLElement>('.av__celltext[data-id="bound"]');
            check.ok(preview.matches('span[data-type="block-ref"]'), `${entry}: plain primary targets inline reference styles`);
            check.equal(preview.dataset.subtype, refSubtype);
            check.equal(preview.textContent, value.block.content);
            check.equal(getComputedStyle(preview).cursor, "pointer");
            check.equal(getComputedStyle(preview).textOverflow, "ellipsis");
            check.ok(preview.scrollWidth > preview.clientWidth);

            cellElement.innerHTML = attribute.genAVRelationHTML(value, "row", false);
            const relation = cellElement.querySelector<HTMLElement>('.av__cell--relation .av__celltext[data-id="bound"]');
            check.ok(relation.matches('span[data-type="block-ref"]'), `${entry}: plain relation targets inline reference styles`);
            check.equal(relation.dataset.subtype, refSubtype);
            check.equal(getComputedStyle(relation).cursor, "pointer");

            cellElement.innerHTML = attribute.genAVRelationHTML({...value, hasRenderTemplate: true,
                renderedContent: "<div>Rendered primary</div>"}, "row", false);
            check.ok(cellElement.querySelector("div.av__celltext--template > div"));
            host.remove();
        }
        for (const view of ["table", "calendar"] as const) {
            for (const fontSize of [16, 24]) {
                const host = document.createElement("div");
                host.className = "protyle-wysiwyg";
                host.style.fontSize = `${fontSize}px`;
                host.innerHTML = `<div class="av" data-av-type="${view}"><div class="av__row"><div class="${view === "calendar" ? "av__calendar-field" : "av__cell"}" data-dtype="text" data-wrap="false" style="width:200px">${cell.renderCell(textWithImage, 0, false, view, undefined, "", undefined, false)}</div></div></div>`;
                document.body.append(host);
                const preview = host.querySelector<HTMLElement>(".av__celltext--rich");
                const image = preview.querySelector("img");
                image.src = imageSource;
                await image.decode();
                const line = document.createRange();
                line.selectNodeContents(preview.firstElementChild);
                const bounds = preview.getBoundingClientRect();
                check.ok(line.getBoundingClientRect().bottom <= bounds.bottom,
                    `${entry}/${view}/${fontSize}: the image must leave the first line visible with wrapping off`);
                check.ok(image.getBoundingClientRect().height <= bounds.height,
                    `${entry}/${view}/${fontSize}: the image fits the single-line preview`);
                preview.parentElement.dataset.wrap = "true";
                check.ok(image.getBoundingClientRect().height > bounds.height,
                    `${entry}/${view}/${fontSize}: wrapping allows the image to grow`);
                host.remove();
            }
        }
        const emptyHost = document.createElement("div");
        emptyHost.className = "protyle-wysiwyg";
        emptyHost.contentEditable = "true";
        emptyHost.innerHTML = primary.getAVPrimaryInitialDOM({type: "block", isDetached: true, block: {content: ""}});
        document.body.append(emptyHost);
        const emptyEditable = emptyHost.querySelector<HTMLElement>('[contenteditable="true"]');
        check.ok(emptyEditable.getBoundingClientRect().height > 0, "empty primary editor provides a visible caret and paste target");
        emptyHost.remove();
        (window as any).siyuan.config.editor.markdown = {inlineAsterisk: true, inlineUnderscore: true,
            inlineSup: true, inlineSub: true, inlineTag: true, inlineMath: true, inlineStrikethrough: true,
            inlineFullWidthStrikethrough: true, inlineMark: true};
        const lute = parser.configureAVRichTextEditorLute(Lute.New());
        lute.SetTextMark(true);
        lute.SetProtyleWYSIWYG(true);
        for (const detached of [false, true]) {
            const host = document.createElement("div");
            host.className = "av__richtext-host";
            host.innerHTML = '<div class="protyle-wysiwyg"></div>';
            document.body.append(host);
            const wysiwyg = host.firstElementChild as HTMLElement;
            let value = {...plain, isDetached: detached};
            for (const fontSize of [16, 24, 32]) {
                host.style.setProperty("--b3-font-size-editor", `${fontSize}px`);
                for (let opening = 0; opening < 2; opening++) {
                    wysiwyg.innerHTML = primary.getAVPrimaryInitialDOM(value);
                    for (const parseInput of [false, true]) {
                        if (parseInput) {
                            wysiwyg.querySelector("[contenteditable]").append(" input");
                            wysiwyg.innerHTML = lute.SpinBlockDOM(wysiwyg.innerHTML);
                        }
                        const editable = wysiwyg.querySelector<HTMLElement>("[contenteditable]");
                        const actual = getComputedStyle(editable);
                        check.equal(actual.fontSize, `${fontSize}px`,
                            `primary font remains ${fontSize}px on opening ${opening}, input=${parseInput}, detached=${detached}`);
                        check.equal(actual.fontWeight, getComputedStyle(wysiwyg).fontWeight);
                        check.equal(editable.classList.contains("protyle-title__input"), false);
                    }
                    value = primary.createAVPrimaryEditValue(wysiwyg.innerHTML, value);
                }
            }
            host.remove();
        }
        for (const fontSize of [16, 24]) {
            document.body.style.fontSize = `${fontSize}px`;
            for (const width of [120, 200, 700]) {
                for (const wrap of [false, true]) {
                    for (const detached of [false, true]) {
                        for (const view of ["table", "list", "gallery", "kanban", "calendar"] as TAVView[]) {
                            const value = {...source, isDetached: detached, block: {...source.block,
                                id: detached ? "" : "bound", richBlockDOM: dom('<span data-type="strong">Primary title with long content</span>')}};
                            const host = document.createElement("div");
                            host.className = "protyle-wysiwyg";
                            host.innerHTML = `<div class="av" data-av-type="${view}"><div class="av__row"><div class="${view === "calendar" ? "av__calendar-field" : "av__cell"}" data-dtype="block" data-wrap="${wrap}" style="width:${width}px">${cell.renderCell(value, 0, true, view)}</div></div></div>`;
                            document.body.append(host);
                            const icon = host.querySelector(".b3-menu__avemoji").getBoundingClientRect();
                            const preview = host.querySelector(".av__celltext").getBoundingClientRect();
                            check.ok(preview.top < icon.bottom && icon.top < preview.bottom,
                                `${view} primary icon and rich text share the first line at ${width}px/${fontSize}px wrap=${wrap}`);
                            check.ok(icon.right <= preview.left + 1, "primary icon does not overlap text");
                            check.ok(preview.right <= host.querySelector("[data-dtype]").getBoundingClientRect().right + 1,
                                "primary preview fits the column");
                            if (!wrap) check.ok(preview.height < fontSize * 2, "unwrapped primary stays on one line");
                            host.remove();
                        }
                    }
                }
            }
        }
    }
    style.remove();
};

test("database rich text renders primary and text previews and preserves legacy primary styles, editing and paste", async () => {
    const profile = mkdtempSync(join(tmpdir(), "siyuan-primary-rich-"));
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    try {
        const sources = Object.fromEntries([
            ["primaryRich", "src/protyle/render/av/primaryRich.ts"], ["richText", "src/protyle/render/av/richText.ts"],
            ["cell", "src/protyle/render/av/cell.ts"], ["cellValue", "src/protyle/render/av/cellValue.ts"], ["attributeValue", "src/protyle/render/av/attributeValue.ts"],
            ["richTextValue", "src/protyle/render/av/richTextValue.ts"],
            ["luteMarkdownSyntax", "src/protyle/render/luteMarkdownSyntax.ts"],
            ["richTextEditorLute", "src/protyle/render/av/richTextEditorLute.ts"],
            ["paste", "src/protyle/util/paste.ts"],
            ["queryEmbedClipboard", "src/protyle/util/queryEmbedClipboard.ts"],
            ["insertPosition", "src/protyle/upload/insertPosition.ts"],
            ["runtimeCapabilities", "src/protyle/runtimeCapabilities.ts"],
        ].map(([name, path]) => [name, transpileModule(readFileSync(path, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText]));
        const styles = Object.fromEntries(["base", "mobile"].map(name => [name,
            compile(`src/assets/scss/${name}.scss`, {style: "compressed", silenceDeprecations: ["legacy-js-api"]}).css]));
        const runner = join(profile, "run.cjs");
        writeFileSync(runner, `const {app,BrowserWindow}=require("electron");app.setPath("userData",${JSON.stringify(join(profile,"data"))});
app.whenReady().then(async()=>{let win;try{win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});
await win.loadURL("about:blank");
await win.webContents.executeJavaScript(${JSON.stringify(readFileSync("stage/protyle/js/protyle-html.js", "utf8").split("\n").slice(0, 2).join("\n"))});
await win.webContents.executeJavaScript('require('+${JSON.stringify(JSON.stringify(resolve("stage/protyle/js/lute/lute.min.js")))}+');void 0;');
const result=await win.webContents.executeJavaScript('(async()=>{const __name=value=>value;try{await ('+${JSON.stringify(cases.toString())}+')('+${JSON.stringify(JSON.stringify(sources))}+','+${JSON.stringify(JSON.stringify(styles))}+');return "ok";}catch(error){return String(error.stack);}})()');
if(result!=="ok")throw new Error(result);
win.destroy();app.exit(0);}catch(error){console.error(error);win?.destroy();app.exit(1);}});`);
        await promisify(execFile)(require("electron"), [runner], {env, windowsHide: true, timeout: 45000});
    } finally {
        assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
        rmSync(profile, {recursive: true, force: true, maxRetries: 5});
    }
});
