import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check = require("node:assert/strict");
    const menuElement = document.createElement("div");
    menuElement.classList.add("fn__none");
    const menu = {element: menuElement, data: undefined as Element,
        remove: () => menuElement.classList.add("fn__none")};
    window.siyuan = {menus: {menu}, config: {editor: {}}, languages: {_kernel: {16: "Untitled"}}} as any;
    let finish: () => void;
    let pending = Promise.resolve();
    const requests: {id: string; notebook?: string}[] = [];
    const api = new Function("window", "document", "waitForPendingTransactions", "fetchPost", "isEncryptedBox",
        "getEditorRange", source + ";return {Breadcrumb, prepareDocumentTitleInitialDOM};")(
        window, document, () => pending,
        (_url: string, data: {id: string; notebook?: string}) => requests.push(data),
        (notebook: string) => notebook === "encrypted",
        () => document.getSelection().getRangeAt(0));
    for (const notebook of ["ordinary", "encrypted"]) {
        const editor = document.createElement("div");
        const title = document.createElement("div");
        title.className = "protyle-title__rich protyle-lite-fragment";
        const titleBody = document.createElement("div");
        titleBody.className = "protyle-wysiwyg";
        titleBody.innerHTML = api.prepareDocumentTitleInitialDOM(
            '<div data-type="NodeParagraph" class="p"><div contenteditable="true">Untitled</div></div>',
            "20261115000000-temp001");
        title.append(titleBody);
        const body = document.createElement("div");
        body.className = "protyle-wysiwyg";
        body.innerHTML = '<div data-type="NodeParagraph" data-node-id="20261115000000-body001"><div contenteditable="true"></div></div>';
        const button = document.createElement("button");
        editor.append(title, body, button);
        document.body.append(editor);
        const protyle = {element: editor, notebookId: notebook,
            block: {rootID: "20261115000000-doc0001", id: "20261115000000-doc0001", showAll: false}};
        const breadcrumb = Object.create(api.Breadcrumb.prototype);
        breadcrumb.menuRequestID = 0;
        const select = (element: Element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            document.getSelection().removeAllRanges();
            document.getSelection().addRange(range);
        };
        const open = () => breadcrumb.showMenu(protyle, {target: button});
        const reset = () => {
            menu.data = undefined;
            menu.remove();
            requests.length = 0;
            pending = Promise.resolve();
        };
        const defer = () => { pending = new Promise<void>(resolve => finish = resolve); };
        select(titleBody.querySelector("[contenteditable]"));
        for (let attempt = 0; attempt < 3; attempt++) {
            reset();
            await open();
            check.equal(requests.length, 1, "the first and repeated opens query immediately");
            check.equal(requests[0].id, protyle.block.rootID, "title fragment IDs never reach the kernel");
            check.equal(requests[0].notebook, notebook === "encrypted" ? notebook : undefined);
        }
        reset();
        defer();
        const redraw = open();
        check.equal(requests.length, 0);
        const titleParagraph = titleBody.firstElementChild;
        titleBody.replaceChildren(titleParagraph.cloneNode(true));
        finish();
        await redraw;
        check.equal(requests[0]?.id, protyle.block.rootID, "title redraws do not cancel the document request");

        reset();
        select(body.querySelector("[contenteditable]"));
        defer();
        const bodyRequest = open();
        check.equal(requests.length, 0, "persisted body selection still waits for pending writes");
        finish();
        await bodyRequest;
        check.equal(requests[0]?.id, "20261115000000-body001");

        for (const interrupt of ["cancel", "switch", "detach"]) {
            reset();
            select(titleBody.querySelector("[contenteditable]"));
            defer();
            const interrupted = open();
            if (interrupt === "cancel") await open();
            if (interrupt === "switch") protyle.block.rootID = "20261115000000-other01";
            if (interrupt === "detach") editor.remove();
            finish();
            await interrupted;
            check.equal(requests.length, 0, interrupt);
            protyle.block.rootID = "20261115000000-doc0001";
            document.body.append(editor);
        }
        reset();
        select(titleBody.querySelector("[contenteditable]"));
        defer();
        const first = open();
        await open();
        const latest = open();
        finish();
        await Promise.all([first, latest]);
        check.equal(requests.length, 1, "repeated clicks only query the current menu session");
        check.equal(requests[0].id, protyle.block.rootID);
        editor.remove();
    }
    return "More menu title identity passed";
};

test("More menu queries persisted document identity from title selections on desktop and mobile", {timeout: 60000}, async () => {
    for (const mobile of [false, true]) {
        const source = ["../../menus/menuToggle.ts", "../util/hasClosest.ts", "../util/liteFragment.ts",
            "../util/longTextWrap.ts", "../util/inlineElementBoundary.ts",
            "../header/documentTitleDOM.ts", "index.ts"].map(file =>
            transpileModule(require("ifdef-loader/preprocessor").parse(readFileSync(path.join(__dirname, file), "utf8"),
                {BROWSER: true, MOBILE: mobile}, false, true).replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
            {compilerOptions: {target: ScriptTarget.ES2021}}).outputText).join("\n");
        const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-more-menu-21463-"));
        const script = path.join(temporary, "run.cjs");
        const browserSource = transpileModule(`(${browserCases.toString()})`, {compilerOptions: {target: ScriptTarget.ES2021}})
            .outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/, "");
        writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,nodeIntegration:true,contextIsolation:false}});
try{await win.loadURL("data:text/html,<html><body></body></html>");
console.log(await win.webContents.executeJavaScript(${JSON.stringify(`const __name=value=>value;(${browserSource})(${JSON.stringify(source)})`)}));
win.destroy();app.exit(0);}catch(error){console.error(error);win.destroy();app.exit(1);}});`, "utf8");
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const result = await promisify(execFile)(require("electron") as unknown as string, [script],
                {env, timeout: 25000, windowsHide: true});
            assert.match(result.stdout, /More menu title identity passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
