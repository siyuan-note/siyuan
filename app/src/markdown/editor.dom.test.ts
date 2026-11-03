import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {pathToFileURL} from "node:url";
import {ScriptTarget, transpileModule} from "typescript";
import {isExternalMarkdownLink, isMarkdownDisplayResource, isRelativeMarkdownResource} from "./resourcePolicy";

test("Markdown resource policy accepts only relative inputs and same-session display resources", () => {
    for (const reference of ["assets/image.png", "../images/a b.png", "image.png?version=2"]) assert.ok(isRelativeMarkdownResource(reference));
    for (const reference of ["https://example.com/a.png", "//example.com/a", "file:///tmp/a", "/absolute/a", "C:\\a", "a\n.png", "data:image/png,a"]) {
        assert.equal(isRelativeMarkdownResource(reference), false);
    }
    const page = "siyuan-markdown://session-a/index.html";
    assert.ok(isMarkdownDisplayResource("siyuan-markdown://session-a/resource/token", page));
    assert.equal(isMarkdownDisplayResource("siyuan-markdown://session-b/resource/token", page), false);
    assert.equal(isMarkdownDisplayResource("siyuan-markdown://session-a/other/token", page), false);
    assert.equal(isMarkdownDisplayResource("https://session-a/resource/token", page), false);
    assert.equal(isExternalMarkdownLink("javascript:alert(1)"), false);
    assert.ok(isExternalMarkdownLink("https://example.com"));
});

const browserCases = async (cdn: string, lutePath: string, imagesOrigin: string) => {
    const check: typeof assert = require("node:assert/strict");
    const api = (window as unknown as {MarkdownEditorTest: typeof import("./editor") & typeof import("./resourcePolicy")}).MarkdownEditorTest;
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    for (const mobile of [false, true]) {
        const element = document.createElement("div");
        document.body.append(element);
        const content = "Language<Alt+Enter>\n";
        const editor = await api.createMarkdownEditor({element, initialValue: content, mode: "wysiwyg", cdn, lutePath,
            mobile, onEdit: () => { throw new Error("Popover label updates must not edit the document"); }});
        const panel = element.querySelector<HTMLElement>(".vditor-wysiwyg > .vditor-panel");
        const wrapper = document.createElement("span");
        wrapper.setAttribute("aria-label", "语言<Alt+Enter>");
        const input = document.createElement("input");
        input.placeholder = "语言<Alt+Enter>";
        input.value = "text<Alt+Enter>";
        wrapper.append(input);
        panel.append(wrapper);
        const documentLabel = element.querySelector<HTMLElement>(".vditor-wysiwyg pre");
        documentLabel.setAttribute("aria-label", "Document<Alt+Enter>");
        await tick();
        check.equal(input.placeholder, mobile ? "语言" : "语言<Alt+Enter>");
        check.equal(wrapper.getAttribute("aria-label"), mobile ? "语言" : "语言<Alt+Enter>");
        check.equal(input.value, "text<Alt+Enter>");
        check.equal(documentLabel.getAttribute("aria-label"), "Document<Alt+Enter>");
        check.equal(editor.flush().content, content);
        input.placeholder = "ID<⌥Enter>";
        await tick();
        check.equal(input.placeholder, mobile ? "ID" : "ID<⌥Enter>", "dynamic attribute updates are normalized");
        let hotkeyReceived = false;
        input.addEventListener("keydown", event => { hotkeyReceived = event.altKey && event.key === "Enter"; });
        const hotkey = new KeyboardEvent("keydown", {key: "Enter", altKey: true, bubbles: true, cancelable: true});
        input.dispatchEvent(hotkey);
        check.equal(hotkeyReceived, true);
        check.equal(hotkey.defaultPrevented, false, "hint suppression does not disable external keyboards");
        editor.destroy();
        input.placeholder = "Language<Alt+Enter>";
        await tick();
        check.equal(input.placeholder, "Language<Alt+Enter>", "destroy disconnects the observer");
        element.remove();
    }
    const source = '[Text][ref]\n\n[ref]: https://example.com "Title"\n\n![Local](assets/photo.png)\n\n' +
        `![Remote badge](${imagesOrigin}/badge.svg)\n\n![Redirected image](${imagesOrigin}/redirect)\n\n![HTTPS](https://invalid.example/track.png)\n\n` +
        '<iframe src="https://invalid.example/preserved"></iframe>\n\n<script>window.markdownExecuted = true</script>\n\n' +
        '```echarts\n{"title":{"text":"static diagram"}}\n```\n\n:doge: 🐶 👨‍👩‍👧‍👦\n\nEnd\n';
    const imageURL = URL.createObjectURL(new Blob([new Uint8Array([137, 80, 78, 71])], {type: "image/png"}));
    const links: string[] = [];
    for (const mode of ["ir", "wysiwyg", "sv"] as const) {
        const element = document.createElement("div");
        element.style.height = "600px";
        document.body.append(element);
        const edits: Array<{content: string; edited: boolean; composing: boolean}> = [];
        const pending: boolean[] = [];
        const modes: string[] = [];
        const history: Array<{canUndo: boolean; canRedo: boolean}> = [];
        const editor = await api.createMarkdownEditor({element, initialValue: source, mode, cdn, lutePath, lang: "en-US",
            resolveResource: reference => reference === "assets/photo.png" ? imageURL : undefined,
            onEdit: snapshot => edits.push(snapshot), onEditPending: value => pending.push(value),
            onModeChange: value => modes.push(value), onLink: url => links.push(url), onHistoryChange: state => history.push(state)});
        check.equal(element.querySelector<HTMLElement>(".vditor-toolbar").hidden, true);
        if (mode === "sv") check.ok(element.querySelector(".vditor-preview .vditor-reset").textContent.includes("End"), "initial source preview is ready before revealing the editor");
        check.deepEqual(editor.flush(), {content: source, edited: false, composing: false});
        check.equal(edits.length, 0);
        await tick();
        const localImages = Array.from(element.querySelectorAll("img")).filter(image => image.src === imageURL);
        if (mode !== "sv") check.ok(localImages.length > 0, `relative image in ${mode}`);
        check.ok(element.querySelector('img[src="https://invalid.example/track.png"]'), "HTTPS image addresses are hydrated");
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !Array.from(element.querySelectorAll<HTMLImageElement>(`img[src^="${imagesOrigin}"]`)).every(image => image.complete && image.naturalWidth > 0)) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        const remoteImages = Array.from(element.querySelectorAll<HTMLImageElement>(`img[src^="${imagesOrigin}"]`));
        check.ok(remoteImages.length >= 2, `remote image elements exist in ${mode}`);
        check.ok(remoteImages.every(image => image.complete && image.naturalWidth > 0), `HTTP SVG badges and redirected PNG images display in ${mode}`);
        check.equal((window as unknown as {imageScriptExecuted?: boolean}).imageScriptExecuted, undefined, "SVG image scripts do not execute");
        check.deepEqual(editor.flush(), {content: source, edited: false, composing: false}, "loading remote images never edits or rewrites the document");
        editor.focus();
        const surface = mode === "sv" ? element.querySelector<HTMLTextAreaElement>("textarea.vditor-sv") :
            element.querySelector<HTMLElement>(`.vditor-${mode} pre[contenteditable="true"]`);
        check.ok(surface, mode);
        if (mode === "sv") {
            const textarea = surface as HTMLTextAreaElement;
            textarea.value += "\nEdited now\n";
            textarea.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "Edited now"}));
        } else {
            const range = document.createRange();
            range.selectNodeContents(surface);
            range.collapse(false);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            document.execCommand("insertText", false, "Edited now");
        }
        check.equal(pending.at(-1), true, `input is pending before delayed serialization in ${mode}`);
        const immediate = editor.flush();
        check.equal(immediate.edited, true, `immediate input ${mode}`);
        check.ok(immediate.content.includes("Edited now"));
        check.ok(immediate.content.includes('https://example.com "Title"'), mode);
        check.ok(immediate.content.includes("assets/photo.png"), mode);
        check.ok(immediate.content.includes("https://invalid.example/track.png"), mode);
        check.ok(immediate.content.includes(`${imagesOrigin}/redirect`), "saving preserves the original URL rather than its redirect destination");
        check.ok(immediate.content.includes('<iframe src="https://invalid.example/preserved"></iframe>'), mode);
        check.ok(immediate.content.includes("<script>window.markdownExecuted = true</script>"), mode);
        check.ok(immediate.content.includes("```echarts"), mode);
        check.ok(immediate.content.includes(":doge:"), `existing image emoji shortcode survives edits in ${mode}`);
        check.ok(immediate.content.includes("🐶 👨‍👩‍👧‍👦"), `Unicode emoji survive edits in ${mode}`);
        check.equal((window as unknown as {markdownExecuted?: boolean}).markdownExecuted, undefined);
        check.equal(immediate.content.includes("blob:"), false);
        await new Promise(resolve => setTimeout(resolve, 350));
        check.equal(history.at(-1).canUndo, true, `history becomes available in ${mode}`);
        editor.undo(); await tick();
        check.equal(editor.flush().content.includes("Edited now"), false, `undo in ${mode}`);
        check.equal(history.at(-1).canRedo, true);
        editor.redo(); await tick();
        check.ok(editor.flush().content.includes("Edited now"), `redo in ${mode}`);
        await new Promise(resolve => setTimeout(resolve, 350));
        check.ok(edits.length > 0);
        check.equal(pending.at(-1), false);
        const count = edits.length;
        for (const next of ["sv", "wysiwyg", "ir"] as const) editor.setMode(next);
        await tick();
        check.equal(edits.length, count, `mode changes ${mode}`);
        check.equal(editor.flush().content, immediate.content);
        check.ok(modes.length > 0);

        editor.setMode(mode);
        editor.setValue("Image insertion\n");
        editor.focus();
        check.equal(editor.insertImage("https://invalid.example/image.png"), false);
        check.equal(editor.insertImage("assets/inserted%20image.png"), true);
        check.ok(editor.flush().content.includes("assets/inserted%20image.png"), `image insertion ${mode}`);
        check.equal(editor.flush().edited, true);
        editor.setValue(immediate.content);

        editor.setMode("sv");
        const textarea = element.querySelector<HTMLTextAreaElement>("textarea.vditor-sv");
        textarea.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true, data: ""}));
        textarea.value += "composition";
        textarea.dispatchEvent(new InputEvent("input", {bubbles: true, isComposing: true, inputType: "insertCompositionText"}));
        check.equal(editor.flush().composing, true);
        check.equal(editor.flush().content, immediate.content);
        const composingValue = textarea.value;
        editor.undo(); editor.redo();
        check.equal(textarea.value, composingValue, "history controls cannot interrupt composition");
        textarea.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "composition"}));
        await tick();
        check.equal(editor.flush().composing, false);
        check.ok(editor.flush().content.includes("composition"));
        editor.setValue("Reloaded\n");
        const afterReload = edits.length;
        await new Promise(resolve => setTimeout(resolve, 850));
        check.deepEqual(editor.flush(), {content: "Reloaded\n", edited: false, composing: false});
        check.equal(edits.length, afterReload);
        if (mode !== "sv") {
            editor.setMode(mode);
            editor.setValue("");
            editor.focus();
            document.execCommand("insertText", false, ":do");
            await new Promise(resolve => setTimeout(resolve, 350));
            const hint = Array.from(element.querySelectorAll<HTMLElement>(".vditor-hint")).find(candidate => candidate.checkVisibility());
            check.ok(hint && hint.style.display !== "none", `emoji completion is visible in ${mode}`);
            check.ok(hint.textContent.includes("dog"), `Unicode dog remains suggested in ${mode}`);
            check.equal(hint.querySelector("img"), null, `image emoji are not suggested in ${mode}`);
            check.equal(hint.textContent.includes("doge"), false, `nonportable shortcode is not suggested in ${mode}`);
        }
        editor.destroy();
        element.remove();
    }

    const element = document.createElement("div");
    document.body.append(element);
    const hostile = '<iframe src="https://invalid.example/frame"></iframe>\n\n<script>window.markdownExecuted = true</script>\n\n' +
        "```echarts\n(()=>{window.markdownExecuted=true})()\n```\n\n```plantuml\nAlice -> Bob\n```\n";
    const editor = await api.createMarkdownEditor({element, initialValue: hostile, mode: "sv", cdn, lutePath,
        onEdit: () => { throw new Error("programmatic preview became an edit"); }});
    await new Promise(resolve => setTimeout(resolve, 300));
    check.equal(element.querySelector("iframe,script,object,embed"), null);
    check.equal((window as unknown as {markdownExecuted?: boolean}).markdownExecuted, undefined);
    check.equal(element.querySelector(".language-echarts,.language-plantuml"), null);
    check.equal(editor.flush().content, hostile);
    editor.destroy();
    element.remove();

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = query => query === "(pointer: coarse)" ?
        Object.create(originalMatchMedia.call(window, query), {matches: {value: true}}) : originalMatchMedia.call(window, query);
    Object.defineProperty(window, "localStorage", {value: null, configurable: true});
    const touchElement = document.createElement("div");
    document.body.append(touchElement);
    let oversizedPastes = 0;
    const touchEditor = await api.createMarkdownEditor({element: touchElement, initialValue: source, mode: "ir", cdn, lutePath,
        onContentTooLarge: () => oversizedPastes++,
        onEdit: () => { throw new Error("touch mode switching became an edit"); }});
    check.equal(window.localStorage, undefined);
    check.equal(touchElement.querySelector<HTMLElement>(".vditor-toolbar").hidden, true);
    for (const mode of ["sv", "wysiwyg", "ir"] as const) {
        touchEditor.setMode(mode);
        check.equal(touchEditor.flush().content, source, `touch ${mode}`);
    }
    touchEditor.setMode("sv");
    const touchSource = touchElement.querySelector<HTMLTextAreaElement>("textarea.vditor-sv");
    touchSource.focus();
    touchSource.setSelectionRange(touchSource.value.length, touchSource.value.length);
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "x".repeat(8 * 1024 * 1024));
    const paste = new ClipboardEvent("paste", {clipboardData: clipboard, bubbles: true, cancelable: true});
    touchSource.dispatchEvent(paste);
    check.equal(paste.defaultPrevented, true);
    check.equal(oversizedPastes, 1);
    check.equal(touchEditor.flush().content, source);
    touchEditor.destroy();
    touchElement.remove();
    window.matchMedia = originalMatchMedia;

    const recoveryElement = document.createElement("div");
    document.body.append(recoveryElement);
    const oversizedDraft = ("# Large source\n\n| A | B |\n| - | - |\n| a | b |\n\n").repeat(22000);
    let recoveryMode = "";
    const recoveryEditor = await api.createMarkdownEditor({element: recoveryElement, initialValue: oversizedDraft, mode: "ir", cdn, lutePath,
        onEdit: () => {}, onModeChange: value => { recoveryMode = value; }});
    check.equal(recoveryMode, "sv");
    check.equal(recoveryEditor.flush().content, oversizedDraft);
    check.equal(recoveryElement.querySelector<HTMLElement>(".vditor-preview").style.display, "none",
        "large source opens without rendering its table-heavy preview");
    recoveryEditor.setValue("# Reloaded\n" + oversizedDraft);
    check.equal(recoveryEditor.flush().content, "# Reloaded\n" + oversizedDraft);
    recoveryEditor.setValue("# Small preview pending\n");
    recoveryEditor.setValue(oversizedDraft);
    await new Promise(resolve => setTimeout(resolve, 220));
    check.ok(recoveryElement.querySelector(".vditor-preview").textContent.length < 1000,
        "an old small-document preview timer cannot parse the large replacement");
    recoveryEditor.setMode("ir");
    check.equal(recoveryMode, "sv", "oversized recovery must not enter a rich rendering mode");
    const recoverySource = recoveryElement.querySelector<HTMLTextAreaElement>("textarea.vditor-sv");
    recoverySource.value += "\nLarge edit\n";
    recoverySource.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "Large edit"}));
    check.ok(recoveryEditor.flush().content.endsWith("Large edit\n"));
    check.equal(recoveryElement.querySelector<HTMLElement>(".vditor-preview").style.display, "none");
    for (const key of ["7", "8"]) {
        const shortcut = new KeyboardEvent("keydown", {key, code: `Digit${key}`, ctrlKey: true, altKey: true,
            bubbles: true, cancelable: true});
        recoverySource.dispatchEvent(shortcut);
        check.equal(shortcut.defaultPrevented, true, "mode shortcuts must preserve source-only recovery");
        check.equal(recoveryMode, "sv");
    }
    const nativeModeButton = recoveryElement.querySelector<HTMLButtonElement>('button[data-mode="ir"]');
    const modeClick = new MouseEvent("click", {bubbles: true, cancelable: true});
    nativeModeButton.dispatchEvent(modeClick);
    check.equal(modeClick.defaultPrevented, true);
    check.equal(recoveryMode, "sv");
    recoverySource.value = "# Reduced draft\n";
    recoverySource.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "deleteContentBackward"}));
    check.equal(recoveryEditor.flush().content, "# Reduced draft\n");
    recoveryEditor.setMode("ir");
    check.equal(recoveryMode, "ir");
    const bigPaste = new DataTransfer();
    bigPaste.setData("text/plain", oversizedDraft);
    const pasteRich = new ClipboardEvent("paste", {clipboardData: bigPaste, bubbles: true, cancelable: true});
    recoveryElement.querySelector(".vditor-ir pre").dispatchEvent(pasteRich);
    check.equal(pasteRich.defaultPrevented, true, "large rich paste is handled through the source insertion path");
    check.equal(recoveryMode, "sv");
    const pasted = recoveryEditor.flush().content;
    check.ok(pasted.includes(oversizedDraft.trimEnd()), JSON.stringify({length: pasted.length, expected: oversizedDraft.length, start: pasted.slice(0, 100), end: pasted.slice(-100)}));
    check.ok(recoveryEditor.flush().content.includes("Reduced draft"));
    check.equal(recoveryElement.querySelector<HTMLElement>(".vditor-preview").style.display, "none");
    recoveryEditor.setMode("ir");
    check.equal(recoveryMode, "sv");
    recoveryEditor.destroy();
    recoveryElement.remove();
    URL.revokeObjectURL(imageURL);
    return "Markdown editor DOM cases passed";
};

test("Vditor 4.0.1 adapter preserves content and isolates programmatic, input, composition and preview events", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-markdown-editor-test-"));
    const compile = (name: string) => transpileModule(readFileSync(path.join(__dirname, name), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "")
        .replace('require("vditor")', "globalThis.Vditor"), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const bundle = compile("identity.ts") + "\n" + compile("limits.ts") + "\n" + compile("resourcePolicy.ts") + "\n" + compile("editor.ts") +
        "\nwindow.MarkdownEditorTest = {createMarkdownEditor, createMarkdownResourcePolicy};";
    const html = path.join(temporary, "index.html");
    writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" ' +
        'content="default-src \'none\'; script-src file:; style-src file: \'unsafe-inline\'; img-src blob: http: https:; font-src file:; ' +
        'connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'"></head><body></body></html>', "utf8");
    const script = path.join(temporary, "run.cjs");
    const cdn = pathToFileURL(path.resolve(__dirname, "../../node_modules/vditor")).href;
    const lutePath = pathToFileURL(path.resolve(__dirname, "../../stage/protyle/js/lute/lute.min.js")).href;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const imageRequests = [];
    const server = require("node:http").createServer((request,response) => {
        imageRequests.push(request.url);
        if (request.url === "/redirect") {response.writeHead(302,{Location:"/photo.png"});response.end();return;}
        if (request.url === "/badge.svg") {
            response.setHeader("Content-Type","image/svg+xml");
            response.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><rect width="80" height="20" fill="green"/><script>parent.imageScriptExecuted=true</script></svg>');return;
        }
        response.setHeader("Content-Type","image/png");
        response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64"));
    });
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const imagesOrigin = "http://127.0.0.1:"+server.address().port;
    const win = new BrowserWindow({show:false, width:1000, height:720, webPreferences:{nodeIntegration:true, contextIsolation:false, offscreen:true}});
    const external = [];
    win.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]}, (details, callback) => {
        if (details.resourceType !== "image") external.push(details.url);
        callback({cancel: !details.url.startsWith(imagesOrigin+"/")});
    });
    try {
        await win.loadFile(${JSON.stringify(html)});
        await win.webContents.executeJavaScript(${JSON.stringify("globalThis.Vditor = require(" + JSON.stringify(path.resolve(__dirname, "../../node_modules/vditor")) + "); void 0;")});
        await win.webContents.executeJavaScript(${JSON.stringify(bundle + "\nvoid 0;")});
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(cdn)},${JSON.stringify(lutePath)},`)} + JSON.stringify(imagesOrigin) + ")"));
        if (external.length) throw new Error("Unexpected external requests: " + external.join(","));
        if (!imageRequests.includes("/badge.svg") || !imageRequests.includes("/photo.png")) throw new Error("Remote image endpoints were not reached");
        win.destroy(); server.close(); app.exit(0);
    } catch (error) {console.error(error); win.destroy(); server.close(); app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Markdown editor DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-markdown-editor-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
