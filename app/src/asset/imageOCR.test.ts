import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, actionsSource: string, statusSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const copied: string[] = [];
    const saved: {path: string, text: string}[] = [];
    let dialog: {element: HTMLElement, destroy: () => void};
    let receive: (response: {data: {text: string}}) => void;
    Object.assign(window, {siyuan: {languages: {copy: "Copy", save: "Save", cancel: "Cancel", ocrResult: "OCR",
        copied: "Copied", doubleClick: "Double click"}}});
    let text = "recognized";
    let requests = 0;
    let pending: () => void;
    const invalidated: string[] = [];
    const status: typeof import("./imageOCRStatus") = new Function("fetchSyncPost", statusSource +
        "\nreturn {getImageOCRStatus, invalidateImageOCRStatus};")(() => {
        requests++;
        return new Promise(resolve => {
            pending = () => resolve({code: 0, data: {text}});
        });
    });
    const dependencies = {
        Dialog: class {
            element: HTMLElement;
            constructor(options: {content: string, disableClose: boolean}) {
                check.equal(options.disableClose, true);
                this.element = document.createElement("div");
                this.element.innerHTML = options.content;
                document.body.append(this.element);
                dialog = {element: this.element, destroy: () => this.element.remove()};
            }
            destroy() { this.element.remove(); }
        },
        fetchPost: (_url: string, _body: {path: string}, callback: typeof receive) => { receive = callback; },
        fetchSyncPost: async (_url: string, body: {path: string, text: string}) => {
            saved.push(body);
            return {code: 0};
        },
        writeText: (text: string) => copied.push(text), showMessage: () => {},
        invalidateImageOCRStatus: (path: string) => { invalidated.push(path); status.invalidateImageOCRStatus(path); },
    };
    const api = new Function(...Object.keys(dependencies), source + "\nreturn {openImageOCR, copyImageOCRText};")(...Object.values(dependencies));
    api.openImageOCR("assets/first.png");
    let textarea = dialog.element.querySelector("textarea");
    check.equal(textarea.disabled, true);
    receive({data: {text: "recognized"}});
    textarea.value = "corrected";
    (dialog.element.querySelector('[data-action="copy"]') as HTMLElement).click();
    check.deepEqual(copied, ["corrected"]);
    (dialog.element.querySelector('[data-action="cancel"]') as HTMLElement).click();
    check.equal(saved.length, 0);
    api.openImageOCR("assets/second.png");
    textarea = dialog.element.querySelector("textarea");
    receive({data: {text: "original"}});
    textarea.value = "updated";
    (dialog.element.querySelector('[data-action="save"]') as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));
    check.deepEqual(saved, [{path: "assets/second.png", text: "updated"}]);
    check.deepEqual(invalidated, ["assets/second.png"]);
    check.equal(dialog.element.isConnected, false);
    let opens = 0;
    let copies = 0;
    let visible = true;
    const render = new Function("Constants", "copyImageOCRText", "openImageOCR", "isEncryptedBox", "isEntryVisible", "getImageOCRStatus", actionsSource +
        "\nreturn renderImageActions;")({TIMEOUT_DBLCLICK: 20}, () => copies++, () => opens++, () => false,
        () => visible, status.getImageOCRStatus);
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.innerHTML = '<span class="img"><span></span><span><span class="protyle-icons"><span class="protyle-icon--only"></span></span><img data-src="assets/image.png"></span></span>';
    document.body.append(root);
    render(root);
    render(root);
    check.equal(requests, 0, "rendering does not query every image");
    const hover = async () => {
        const count = requests;
        root.querySelector("img").parentElement.dispatchEvent(new MouseEvent("mouseenter"));
        if (requests !== count) {
            pending();
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    };
    await hover();
    await hover();
    root.querySelector("img").parentElement.dispatchEvent(new Event("focusin"));
    root.querySelector("img").parentElement.dispatchEvent(new Event("pointerdown"));
    check.equal(requests, 1, "hover, focus, and pointer interactions reuse the status");
    check.equal(root.querySelectorAll(".protyle-action__ocr").length, 1);
    let action = root.querySelector<HTMLElement>(".protyle-action__ocr");
    action.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    check.equal(copies, 1);
    action.click();
    action.click();
    action.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    await new Promise(resolve => setTimeout(resolve, 30));
    check.equal(copies, 1);
    check.equal(opens, 1);
    root.setAttribute("data-readonly", "true");
    action.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check.equal(opens, 1);
    const snapshot = root.innerHTML;
    root.innerHTML = snapshot;
    render(root);
    await hover();
    check.equal(requests, 1, "restored content reuses the resource cache");
    action = root.querySelector<HTMLElement>(".protyle-action__ocr");
    action.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    check.equal(copies, 2, "restored image actions still copy OCR text");
    text = " \n ";
    status.invalidateImageOCRStatus("assets/image.png");
    await hover();
    check.equal(root.querySelector(".protyle-action__ocr"), null, "empty OCR text hides the action");
    await hover();
    check.equal(requests, 2, "empty text is cached too");
    text = "recognized again";
    status.invalidateImageOCRStatus("assets/image.png");
    await hover();
    check.ok(root.querySelector(".protyle-action__ocr"));
    visible = false;
    window.dispatchEvent(new CustomEvent("siyuan-entry-visibility"));
    check.equal(root.querySelector(".protyle-action__ocr"), null, "profile changes hide existing actions");
    visible = true;
    render(root);
    status.invalidateImageOCRStatus("assets/image.png");
    root.querySelector("img").parentElement.dispatchEvent(new MouseEvent("mouseenter"));
    root.querySelector("img").setAttribute("data-src", "assets/changed.png");
    pending();
    await new Promise(resolve => setTimeout(resolve, 0));
    check.equal(root.querySelector(".protyle-action__ocr"), null, "stale responses cannot add actions");
    root.querySelector("img").setAttribute("data-src", "https://example.com/image.png");
    render(root);
    check.equal(root.querySelector(".protyle-action__ocr"), null);
    return "Image OCR cases passed";
};

test("image OCR copying, explicit saving and double-click editing", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (file: string) => transpileModule(readFileSync(path.resolve(__dirname, file), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-image-ocr-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" +
        JSON.stringify(compile("imageOCR.ts")) + "," + JSON.stringify(compile("../protyle/render/imageActions.ts")) +
        "," + JSON.stringify(compile("imageOCRStatus.ts")) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Image OCR cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-image-ocr-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
