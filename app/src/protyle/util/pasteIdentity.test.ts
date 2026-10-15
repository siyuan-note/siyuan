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
    require(lutePath);
    const constants = {Constants: {ZWSP: "\u200b", CUSTOM_RIFF_DECKS: "custom-riff-decks"}};
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
    const tabsCopy = load(sources.tabsCopy, {});
    const originalID = "20261007000000-abcdefg";
    const childID = "20261007000001-abcdefg";
    const html = `<div data-node-id="${originalID}" data-type="NodeBlockquote" class="bq protyle-wysiwyg--select" refcount="2">` +
        `<div data-node-id="${childID}" data-type="NodeParagraph" class="p" refcount="1">` +
        '<div contenteditable="true">Original content</div></div></div>';
    for (const mode of ["copy", "cut", "mixed", "error", "target removed"]) {
        const editor = document.createElement("div");
        editor.innerHTML = html + '<div data-node-id="20261007000002-abcdefg" data-type="NodeParagraph" class="p">' +
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
            "../../util/highlightById": {scrollCenter: () => {}},
            "dayjs": () => ({format: () => "20261007000003"}),
            "../../util/fetch": {fetchSyncPost: async (url: string, request: {ids: string[]}) => {
                check.equal(url, "/api/block/checkBlocksExist");
                requests.push(request);
                if (mode === "target removed") {
                    available = false;
                }
                return {code: mode === "error" ? -1 : 0, data: {
                    [originalID]: mode === "copy", [childID]: mode === "copy" || mode === "mixed",
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
        await api.paste(protyle, {target, textPlain: "Original content", textHTML: "", siyuanHTML: html});
        check.deepEqual(requests, [{ids: [originalID, childID]}]);
        check.equal(original.outerHTML, originalHTML);
        if (mode === "error" || mode === "target removed") {
            check.equal(inserted.length, 0);
        } else {
            check.equal(inserted.length, 1);
            const pasted = target.previousElementSibling;
            const pastedChild = pasted.querySelector("[data-node-id]");
            if (mode === "copy") {
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

test("internal block paste keeps copied IDs independent and preserves cut IDs in the real DOM", {timeout: 30000}, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-paste-identity-"));
    const sources = Object.fromEntries(["paste", "clear", "pasteSource", "tabsCopy"].map(name => [name,
        transpileModule(readFileSync(`src/protyle/util/${name}.ts`, "utf8"), {
            compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.CommonJS},
        }).outputText]));
    const execute = transpileModule(`const __name = (value) => value; (${browserCases.toString()})(${JSON.stringify(sources)},
        ${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))})`, {
        compilerOptions: {target: ScriptTarget.ES2022},
    }).outputText;
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
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
