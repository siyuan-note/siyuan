import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

// 执行完整粘贴入口及真实 DOM，检查内核存在性结果对复制、剪切和失败中止的影响。
const browserCases = async (sources: Record<string, string>, lutePath: string) => {
    const check = require("node:assert/strict");
    window.siyuan = {config: {editor: {mathDelimiterCompatibility: true}}} as unknown as typeof window.siyuan;
    require(lutePath);
    // 粘贴入口读取编辑器配置来决定 Markdown 语法、公式分隔符与 URL 自动转换。
    Object.assign(window, {siyuan: {languages: {}, config: {editor: {markdown: {},
        mathDelimiterCompatibility: true, pasteURLAutoConvert: false}}}});
    const constants = {Constants: {ZWSP: "\u200b", CUSTOM_RIFF_DECKS: "custom-riff-decks",
        CUSTOM_SY_AV_VISIBLE_VIEWS: "custom-sy-av-visible-views"}};
    const load = (source: string, mocks: Record<string, unknown>) => {
        const api = {};
        new Function("exports", "require", source)(api, (id: string) => mocks[id] || {});
        return api;
    };
    const clear = load(sources.clear, {
        "../../constants": constants,
        "../wysiwyg/blockSelection": {BLOCK_SELECTION_MODE_CLASS: "protyle-wysiwyg--block-select"},
    });
    const pasteSource = load(sources.pasteSource, {});
    const queryEmbedClipboard = load(sources.queryEmbedClipboard, {});
    const tabsCopy = load(sources.tabsCopy, {});
    const viewVisibility = load(sources.viewVisibility, {"../../../constants": constants});
    const originalID = "20261007000000-abcdefg";
    const childID = "20261007000001-abcdefg";
    const html = `<div data-node-id="${originalID}" data-type="NodeBlockquote" class="bq protyle-wysiwyg--select" refcount="2">` +
        `<div data-node-id="${childID}" data-type="NodeParagraph" class="p" refcount="1">` +
        '<div contenteditable="true">Original content</div></div></div>';
    const mirrorHTML = `<div data-node-id="${originalID}" data-type="NodeAttributeView" class="av"
        data-av-id="database" custom-sy-av-visible-views="mirror" custom-sy-av-view="mirror">
        <div class="av__container"><div class="av__header" data-view-ids="main,mirror"><div class="av__views">
        <div class="layout-tab-bar"><div class="item" data-id="main">Main</div>
        <div class="item item--focus" data-id="mirror">Mirror</div></div></div></div></div></div>`;
    const jsSource = "//!js\n// Notes < & >";
    const sqlSource = "SELECT * FROM blocks";
    const embedSources = new Map([["js embed", jsSource], ["js embed with caret", Lute.Caret + jsSource], ["sql embed", sqlSource]]);
    for (const mode of ["copy", "cut", "mixed", "error", "target removed", "view mirror", ...embedSources.keys()]) {
        const source = embedSources.get(mode);
        const clipboardHTML = mode === "view mirror" ? mirrorHTML : source ?
            html.replace('data-type="NodeParagraph" class="p" refcount="1"',
                'data-type="NodeBlockQueryEmbed" class="render-node" data-content="' + Lute.EscapeHTMLStr(source) + '"') : html;
        const editor = document.createElement("div");
        editor.innerHTML = clipboardHTML + '<div data-node-id="20261007000002-abcdefg" data-type="NodeParagraph" class="p">' +
            '<div contenteditable="true">Target</div></div>';
        document.body.append(editor);
        const original = editor.firstElementChild;
        const originalHTML = original.outerHTML;
        const target = editor.lastElementChild as HTMLElement;
        if (mode === "cut" || mode === "mixed") {
            original.remove();
            if (mode === "mixed") {
                target.before(original.querySelector("[data-node-id]").cloneNode(true));
            }
        }
        const range = document.createRange();
        range.selectNodeContents(target.firstElementChild);
        range.collapse(false);
        const requests: {ids: string[]}[] = [];
        const inserted: string[] = [];
        let available = true;
        const mocks: Record<string, unknown> = {
            "../../constants": constants,
            "../../util/pathName": {isEncryptedBox: () => true},
            "./pasteAssets": {preparePasteAssets: async (_box: string, value: string) => value},
            "./pasteSource": pasteSource,
            "./queryEmbedClipboard": queryEmbedClipboard,
            "./clear": clear,
            "./tabsCopy": tabsCopy,
            "../render/listMindmap/model": {remapListMindmapIDs: () => {}},
            "../render/embedRenderState": {resetPastedQueryEmbedRenderState: () => {}},
            "./inlineElementMarker": {normalizeSemanticInlineElements: () => {},
                stripSemanticMarkersFromRangeText: () => ""},
            "../runtimeCapabilities": {getProtyleBlockDOMSanitizer: (): undefined => undefined,
                areProtylePluginExtensionsEnabled: () => false},
            "../upload/insertPosition": {
                createUploadInsertPosition: () => ({range}), captureUploadDocument: () => ({}),
                isUploadInsertPositionAvailable: () => available,
                getAvailableUploadInsertRange: () => available ? range : undefined,
            },
            "./selection": {getEditorRange: () => range},
            "./hasClosest": {hasClosestBlock: (item: Node) =>
                    (item.nodeType === Node.ELEMENT_NODE ? item as Element : item.parentElement)?.closest("[data-node-id]")},
            "./compatibility": {isInHarmony: () => false},
            "./officeMath": {extractOfficeMathHTML: () => ""},
            "./processCode": {processPasteCode: () => "", processRender: () => {}},
            "../ui/hideElements": {hideElements: () => {}},
            "../render/blockRender": {blockRender: () => {}},
            "../render/highlightRender": {highlightRender: () => {}},
            "../render/av/render": {avRender: () => {}},
            "../render/av/viewVisibility": viewVisibility,
            "../../util/highlightById": {scrollCenter: () => {}},
            "dayjs": () => ({format: () => "20261007000003"}),
            "../../util/fetch": {fetchSyncPost: async (url: string, request: {ids: string[]}) => {
                check.equal(url, "/api/block/checkBlocksExist");
                requests.push(request);
                if (mode === "target removed") {
                    available = false;
                }
                return {code: mode === "error" ? -1 : 0, data: {
                    [originalID]: mode === "copy" || mode === "view mirror", [childID]: mode === "copy" || mode === "mixed",
                }};
            }},
            "./insertHTML": {insertHTML: (value: string) => {
                inserted.push(value);
                target.insertAdjacentHTML("beforebegin", value);
            }},
        };
        const api = load(sources.paste, mocks) as typeof import("./paste");
        const protyle = {notebookId: "encrypted-notebook", hint: {enableExtend: false},
            wysiwyg: {element: editor}, toolbar: {getCurrentType: (): string[] => []}, lute: Lute.New()} as unknown as IProtyle;
        await api.paste(protyle, {target, textPlain: "Original content", textHTML: "", siyuanHTML: clipboardHTML});
        check.deepEqual(requests, [{ids: mode === "view mirror" ? [originalID] : [originalID, childID]}]);
        check.equal(original.outerHTML, originalHTML);
        if (mode === "error" || mode === "target removed") {
            check.equal(inserted.length, 0);
        } else {
            check.equal(inserted.length, 1);
            const pasted = target.previousElementSibling;
            const pastedChild = pasted.querySelector("[data-node-id]");
            if (mode === "view mirror") {
                check.notEqual(pasted.getAttribute("data-node-id"), originalID);
                check.equal(pasted.getAttribute("custom-sy-av-visible-views"), "mirror");
                check.deepEqual(Array.from(pasted.querySelectorAll(".layout-tab-bar .item"), tab => tab.getAttribute("data-id")), ["mirror"]);
            } else if (mode === "sql embed") {
                check.equal(pastedChild.getAttribute("data-type"), "NodeBlockQueryEmbed");
                check.equal(Lute.UnEscapeHTMLStr(pastedChild.getAttribute("data-content")), sqlSource);
            } else if (source) {
                check.equal(pastedChild.getAttribute("data-type"), "NodeCodeBlock");
                check.equal(pastedChild.querySelector('[contenteditable="true"]').textContent, source);
            } else if (mode === "copy") {
                check.notEqual(pasted.getAttribute("data-node-id"), originalID);
                check.notEqual(pastedChild.getAttribute("data-node-id"), childID);
                check.equal(new Set(Array.from(editor.querySelectorAll("[data-node-id]"), item =>
                    item.getAttribute("data-node-id"))).size, 5);
                check.equal(pasted.hasAttribute("refcount"), false);
                pastedChild.querySelector("[contenteditable]").textContent = "Edited copy";
                check.equal(original.textContent, "Original content");
            } else {
                check.equal(pasted.getAttribute("data-node-id"), originalID);
                check.equal(pasted.getAttribute("refcount"), "2");
                check.equal(pastedChild.getAttribute("data-node-id") === childID, mode === "cut");
                const ids = Array.from(editor.querySelectorAll("[data-node-id]"), item => item.getAttribute("data-node-id"));
                check.equal(new Set(ids).size, ids.length);
            }
        }
        editor.remove();
    }
    return "paste-identity-ok";
};

test("internal block paste preserves identity, mirror visibility, and inert JavaScript source", {timeout: 30000}, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-paste-identity-"));
    const sources = Object.fromEntries(["paste", "clear", "pasteSource", "tabsCopy", "queryEmbedClipboard"].map(name => [name,
        transpileModule(readFileSync(`src/protyle/util/${name}.ts`, "utf8"), {
            compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.CommonJS},
        }).outputText]));
    sources.viewVisibility = transpileModule(readFileSync("src/protyle/render/av/viewVisibility.ts", "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.CommonJS},
    }).outputText;
    const execute = transpileModule(`const __name = (value) => value; (${browserCases.toString()})(${JSON.stringify(sources)},
        ${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))})`, {
        compilerOptions: {target: ScriptTarget.ES2022},
    }).outputText;
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(execute)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`);
    try {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron") as unknown as string, [script, "--no-sandbox"],
            {env, timeout: 25000});
        assert.match(result.stdout, /paste-identity-ok/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
