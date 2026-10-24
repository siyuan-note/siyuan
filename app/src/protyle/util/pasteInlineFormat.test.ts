import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

// 执行实际粘贴、格式处理和输入方法，检查引用与行内格式在事务快照和重新解析后保持一致。
const browserCases = async (sources: Record<string, string>, snippets: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const modules: Record<string, {exports: any}> = {};
    const mocks: Record<string, any> = {};
    const load = (name: string): any => {
        if (mocks[name]) {
            return mocks[name];
        }
        if (modules[name]) {
            return modules[name].exports;
        }
        const module = {exports: {}};
        modules[name] = module;
        new Function("require", "module", "exports", sources[name] || "")((dependency: string) => {
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
    const marker: typeof import("./inlineElementMarker") = load("protyle/util/inlineElementMarker");
    const boundary: typeof import("./inlineElementBoundary") = load("protyle/util/inlineElementBoundary");
    const inlineRange: typeof import("../toolbar/inlineRangeBoundary") = load("protyle/toolbar/inlineRangeBoundary");
    const Constants = {ZWSP: "\u200b", WORD_JOINER: "\u2060", ATTRIBUTE_EDITING: "data-editing"};
    let mobile = false;
    const mobileToolbar = document.createElement("div");
    mobileToolbar.id = "keyboardToolbar";
    mobileToolbar.innerHTML = '<div class="keyboard__dynamic">' + ["code", "strong", "kbd"].map(type =>
        `<button data-type="${type}"></button>`).join("") + "</div>";
    document.body.append(mobileToolbar);
    const deps: Record<string, any> = {Constants, ...marker, ...boundary, ...inlineRange,
        ...load("protyle/util/hasClosest"), ...load("protyle/toolbar/inlineFormat"),
        ...load("protyle/toolbar/fontFamilyCore"), ...load("protyle/toolbar/inlineDirectionStyle"),
        dayjs: () => ({format: () => "20261023120000"}), isMobile: () => mobile,
        fixTableRange() {},
        focusByRange: (range: Range) => {getSelection().removeAllRanges(); getSelection().addRange(range);},
        transaction: (protyle: any, doOperations: IOperation[], undoOperations: IOperation[]) =>
            protyle.transactions.push({doOperations, undoOperations}),
        cleanListMindmapHTML: (html: string) => html, cleanHeadingNumberHTML: (html: string) => html,
        cleanTableCellRichHTML: (html: string) => html, cleanBlockSelectionModeHTML: (html: string) => html,
    };
    const evaluate = (source: string, names: string[]) => new Function(...Object.keys(deps), source +
        `\nreturn {${names.join(",")}};`)(...Object.values(deps));
    Object.assign(deps, evaluate(snippets.block, ["getContenteditableElement", "hasNextSibling", "hasPreviousSibling"]));
    Object.assign(deps, evaluate(snippets.style, ["setFontStyle", "hasSameTextStyle", "mergeSameInlineElement"]));
    Object.assign(deps, evaluate(snippets.transaction, ["updateTransaction"]));
    const {ReviewToolbar} = evaluate(snippets.toolbar, ["ReviewToolbar"]);
    const lute = boundary.protectLuteInlineElementBoundaries(Lute.New());
    ["SetTextMark", "SetHTMLTag2TextMark", "SetBlockRef", "SetSpin", "SetProtyleWYSIWYG", "SetKramdownIAL"]
        .forEach(method => (lute as any)[method](true));
    const referenceID = "20261023090001-abcdefg";
    const paragraph = (html: string) => '<div data-node-id="20261023090000-abcdefg" data-type="NodeParagraph" class="p">' +
        `<div contenteditable="true">${html}</div><div class="protyle-attr" contenteditable="false"></div></div>`;
    const setup = (html: string) => {
        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        editor.innerHTML = paragraph(html);
        document.body.append(editor);
        const toolbar = Object.create(ReviewToolbar.prototype);
        toolbar.element = document.createElement("div");
        mobileToolbar.querySelectorAll("button").forEach(button => button.className = "");
        const protyle = {toolbar, lute, notebookId: "notebook", options: {}, transactions: [] as Array<{
            doOperations: IOperation[], undoOperations: IOperation[]}>, wysiwyg: {element: editor, lastHTMLs: {}},
            hint: {enableExtend: false, render() {}}};
        return {editor, toolbar, protyle, editable: editor.firstElementChild.firstElementChild as HTMLElement};
    };
    const select = (fixture: ReturnType<typeof setup>, element: Element, mode: string) => {
        const range = document.createRange();
        if (mode === "contents") {
            range.selectNodeContents(element);
        } else if (mode === "node") {
            range.selectNode(element);
        } else {
            range.setStart(element.firstChild, mode === "partial" ? 2 : 0);
            range.setEnd(element.firstChild, mode === "partial" ? 8 : element.firstChild.textContent.length);
        }
        fixture.toolbar.range = range;
        deps.focusByRange(range);
        return range;
    };
    const assertRef = (html: string, type: string, expectedText: string, subtype = "s") => {
        const holder = document.createElement("div");
        holder.innerHTML = lute.SpinBlockDOM(html);
        const matches = Array.from(holder.querySelectorAll<HTMLElement>('[data-type~="block-ref"]')).filter(element =>
            element.dataset.type.split(" ").includes(type));
        check.equal(matches.length, 1, html);
        check.equal(marker.getSemanticInlineVisibleText(matches[0]), expectedText);
        check.equal(matches[0].dataset.id, referenceID);
        check.equal(matches[0].dataset.subtype, subtype);
        check.equal(matches[0].querySelector("span"), null);
        return holder.innerHTML;
    };
    for (const platform of ["desktop", "mobile"]) {
        mobile = platform === "mobile";
        for (const subtype of ["s", "d"]) {
            for (const mode of ["contents", "text", "node", "partial"]) {
                for (const type of ["code", "strong", "kbd"]) {
                    const fixture = setup(`before <span data-type="block-ref" data-id="${referenceID}" data-subtype="${subtype}">inline-code</span> after`);
                    select(fixture, fixture.editable.querySelector("span"), mode);
                    fixture.toolbar.setInlineMark(fixture.protyle, type, mobile ? "toolbar" : "range");
                    const expected = mode === "partial" ? "line-c" : "inline-code";
                    let reopened = assertRef(fixture.editor.innerHTML, type, expected, subtype);
                    reopened = assertRef(reopened, type, expected, subtype);
                    const operation = fixture.protyle.transactions[0];
                    assertRef(operation.doOperations[0].data as string, type, expected, subtype);
                    check.doesNotMatch(operation.undoOperations[0].data as string, new RegExp(`block-ref ${type}`));
                    fixture.editor.innerHTML = operation.undoOperations[0].data as string;
                    check.equal(fixture.editor.querySelector(`[data-type~="${type}"]`), null);
                    fixture.editor.innerHTML = operation.doOperations[0].data as string;
                    assertRef(reopened, type, expected, subtype);
                    const styled = fixture.editor.querySelector(`[data-type~="${type}"]`);
                    select(fixture, styled, "contents");
                    fixture.toolbar.setInlineMark(fixture.protyle, type, mobile ? "toolbar" : "range");
                    check.equal(fixture.editor.querySelector(`[data-type~="${type}"]`), null);
                    check.equal(marker.getTextWithoutSemanticMarkers(fixture.editor).replace(/\u200b/g, ""), "before inline-code after");
                    fixture.editor.remove();
                }
            }
        }
    }
    mobile = false;
    Object.assign(mocks, {
        "constants": {Constants},
        "protyle/runtimeCapabilities": {getProtyleBlockDOMSanitizer: (): undefined => undefined,
            areProtylePluginExtensionsEnabled: () => false},
        "util/pathName": {isEncryptedBox: () => false},
        "protyle/upload/insertPosition": {captureUploadDocument: () => ({}), createUploadInsertPosition: (range: Range) => ({range}),
            isUploadInsertPositionAvailable: () => true, getAvailableUploadInsertRange: (_editor: Element, position: {range: Range}) => position.range},
        "protyle/util/selection": {getEditorRange: () => getSelection().getRangeAt(0)},
        "protyle/util/processCode": {processPasteCode: () => "", processRender() {}},
        "protyle/util/compatibility": {isInHarmony: () => false,
            getTextSiyuanFromTextHTML: (html: string) => ({textHtml: html, textSiyuan: ""})},
        "protyle/util/officeMath": {extractOfficeMathHTML: () => ""},
        "protyle/util/officeList": {convertOfficeLists: (html: string) => ({html, convertedCount: 0})},
        "protyle/ui/hideElements": {hideElements() {}},
        "protyle/toolbar/util": {resolveLinkDest: (): undefined => undefined},
        "editor/pdfAssetLink": {getPdfAnnotationReference: (): undefined => undefined},
        "util/functions": evaluate(snippets.ref, ["isDynamicRef"]),
        "protyle/util/pictureImages": {normalizePictureImages() {}},
        "protyle/upload/htmlLocalAssets": {getHTMLAssetSourceURL: (): undefined => undefined, resolveHTMLAssetURLs() {}},
        "protyle/render/blockRender": {blockRender() {}}, "protyle/render/highlightRender": {highlightRender() {}},
        "protyle/render/av/render": {avRender() {}}, "util/highlightById": {scrollCenter() {}},
    });
    let inserted: string[] = [];
    mocks["protyle/util/insertHTML"] = {insertHTML: (html: string) => inserted.push(html)};
    const paste: typeof import("./paste").paste = load("protyle/util/paste").paste;
    Object.assign(deps, {fixAdjacentTags() {}, focusByWbr: (root: Element) => root.querySelectorAll("wbr").forEach(wbr => wbr.remove()),
        turnIntoTaskList: () => false, headingTurnIntoList: () => false, getBlockquoteContext: (): undefined => undefined,
        hideElements() {}, mathRender() {}, isProtyleListItemFirstParagraph: () => false});
    const {inputBlock} = evaluate(snippets.input, ["inputBlock"]);
    window.siyuan = {config: {editor: {pasteURLAutoConvert: false, markdown: {}}}, languages: {}} as any;
    const rawReference = `((${referenceID} 'Source'))`;
    const internalReference = `<span data-type="block-ref" data-id="${referenceID}" data-subtype="d">Source</span>`;
    for (const payload of ["internal", "dynamic", "static"]) {
        for (const codeFirst of [false, true]) {
            for (const mode of ["contents", "text", "node", "partial"]) {
                const fixture = setup(`before <span data-type="${codeFirst ? "code" : "text"}">inline-code</span> after`);
                const element = fixture.editable.querySelector("span");
                if (codeFirst) {
                    marker.normalizeSemanticInlineElements(fixture.editor);
                }
                const range = select(fixture, element, mode);
                if (codeFirst && (mode === "text" || mode === "partial")) {
                    range.setStart(element.firstChild, (mode === "partial" ? 2 : 0) + 1);
                    range.setEnd(element.firstChild, (mode === "partial" ? 8 : 11) + 1);
                }
                inserted = [];
                // 静态纯文本引用用于验证代码选区的新分支，普通选区继续覆盖原有动态引用入口。
                if (!codeFirst && payload === "static") {
                    fixture.editor.remove();
                    continue;
                }
                await paste(fixture.protyle as unknown as IProtyle, {target: fixture.editable, textHTML: "",
                    textPlain: payload === "static" ? `((${referenceID} "Source"))` : rawReference,
                    siyuanHTML: payload === "internal" ? internalReference : ""});
                check.deepEqual(inserted, []);
                if (!codeFirst) {
                    fixture.toolbar.setInlineMark(fixture.protyle, "code", "range");
                }
                const expected = mode === "partial" ? "line-c" : "inline-code";
                assertRef(fixture.editor.innerHTML, "code", expected);
                fixture.editable.lastChild.textContent += " ";
                const inputRange = document.createRange();
                inputRange.setStart(fixture.editable.lastChild, fixture.editable.lastChild.textContent.length);
                inputRange.collapse(true);
                await inputBlock(fixture.protyle, fixture.editor.firstElementChild, inputRange, true, {data: " ", inputType: "insertText"});
                assertRef(fixture.editor.innerHTML, "code", expected);
                fixture.editor.remove();
            }
        }
    }
    for (const label of ["vector<T> & value", "测试 <T> 与代码"]) {
        const fixture = setup('before <span data-type="code strong"></span> after');
        const code = fixture.editable.querySelector("span");
        code.textContent = label;
        marker.normalizeSemanticInlineElements(fixture.editor);
        select(fixture, code, "contents");
        inserted = [];
        await paste(fixture.protyle as unknown as IProtyle, {target: fixture.editable, textHTML: "",
            textPlain: rawReference, siyuanHTML: internalReference});
        check.deepEqual(inserted, []);
        const html = assertRef(fixture.editor.innerHTML, "code", label);
        assertRef(html, "strong", label);
        fixture.editor.remove();
    }
    const clipboardSource: typeof import("./pasteSource") = load("protyle/util/pasteSource");
    for (const [html, text] of [["", "ordinary text"], ["", "((invalid 'Source'))"],
        ["", rawReference + " " + rawReference], [internalReference + internalReference, rawReference],
        [paragraph(internalReference) + paragraph("other"), rawReference], ["<span data-type=\"a\" data-href=\"https://example.com\">link</span>", rawReference]]) {
        check.equal(clipboardSource.getSinglePastedBlockRefID(lute, html, text), undefined, JSON.stringify({html, text}));
    }
    for (const mode of ["caret", "mixed", "cross-block", "code-block", "ordinary", "invalid", "multiple", "url"]) {
        const fixture = setup('before <span data-type="code">inline-code</span> after');
        const code = fixture.editable.querySelector("span");
        const range = select(fixture, code, "text");
        if (mode === "caret") {
            range.collapse(false);
        } else if (mode === "mixed") {
            range.setEnd(fixture.editable.lastChild, 2);
        } else if (mode === "cross-block") {
            fixture.editor.insertAdjacentHTML("beforeend", paragraph("other"));
            range.setEnd(fixture.editor.lastElementChild.firstElementChild.firstChild, 2);
        } else if (mode === "code-block") {
            fixture.editor.firstElementChild.setAttribute("data-type", "NodeCodeBlock");
            fixture.editor.firstElementChild.classList.add("code-block");
        }
        const plain = mode === "ordinary" ? "plain code" : mode === "invalid" ? "((invalid 'Source'))" :
            mode === "multiple" ? rawReference + " " + rawReference : mode === "url" ? "https://example.com" : rawReference;
        inserted = [];
        await paste(fixture.protyle as unknown as IProtyle, {target: fixture.editable, textHTML: "",
            textPlain: plain, siyuanHTML: ""});
        check.deepEqual(inserted, [plain]);
        check.equal(fixture.editor.querySelector('[data-type~="block-ref"]'), null);
        fixture.editor.remove();
    }
    mobileToolbar.remove();
    return "paste-inline-format-ok";
};

test("block references and inline formatting survive paste order, input and transaction serialization", {timeout: 45000}, async () => {
    const compile = (source: string) => transpileModule(source, {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    const read = (name: string) => readFileSync(path.join(__dirname, "../..", name + ".ts"), "utf8");
    const extract = (file: string, names: string[]) => {
        const parsed = createSourceFile(file, read(file), ScriptTarget.Latest, true);
        return compile(names.map(name => {
            const declaration = parsed.statements.filter(isVariableStatement).flatMap(statement =>
                Array.from(statement.declarationList.declarations)).find(item => item.name.getText(parsed) === name);
            assert.ok(declaration, `${file}/${name}`);
            return `const ${name} = ${declaration.initializer.getText(parsed)};`;
        }).join("\n"));
    };
    const parsed = createSourceFile("toolbar", read("protyle/toolbar/index"), ScriptTarget.Latest, true);
    const toolbar = parsed.statements.find(isClassDeclaration);
    const methods = ["setInlineMark", "setInlineMarkInBlock", "getCurrentType", "mergeNode"].map(name =>
        toolbar.members.find(member => member.name?.getText(parsed) === name).getText(parsed)).join("\n");
    const sources = Object.fromEntries(["protyle/wysiwyg/compositionInput", "protyle/util/longTextWrap",
        "protyle/util/inlineElementBoundary", "protyle/util/inlineElementMarker", "protyle/toolbar/inlineRangeBoundary",
        "protyle/toolbar/inlineFormat", "protyle/toolbar/fontFamilyCore", "protyle/toolbar/inlineDirectionStyle",
        "protyle/util/hasClosest", "protyle/util/paste", "protyle/util/pasteSource", "protyle/util/normalizeText"].map(name => [name, compile(read(name))]));
    const snippets = {
        toolbar: compile(`class ReviewToolbar {${methods}}`),
        block: extract("protyle/wysiwyg/getBlock", ["getContenteditableElement", "hasNextSibling", "hasPreviousSibling"]),
        style: extract("protyle/toolbar/Font", ["setFontStyle", "hasSameTextStyle"]) +
            extract("protyle/toolbar/util", ["mergeSameInlineElement"]) + extract("util/functions", ["isArrayEqual"]),
        transaction: extract("protyle/wysiwyg/transaction", ["updateTransaction"]),
        ref: extract("util/functions", ["isDynamicRef"]),
        input: extract("protyle/wysiwyg/input", ["inputBlock", "normalizeInlineFontFamilyStyles", "updateInput", "updateGutterAfterInput"]),
    };
    const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(snippets)})`;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-paste-inline-format-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(source)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /paste-inline-format-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-paste-inline-format-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
