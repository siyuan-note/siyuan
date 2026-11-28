import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {receiveFlashcardReviewInWindow, sendFlashcardReviewToWindow} from "./flashcardV2WindowTransfer";
import type {IFlashcardV2SessionTransfer} from "./flashcardV2Session";

const session: IFlashcardV2SessionTransfer = {
    sessionID: "existing", index: 2, queue: [], deferredCardIDs: ["later"], ratings: [["rated", "hard"]],
    initialNewCardIDs: ["rated"],
    answer: {reveals: 1, values: [{value: "unfinished", checked: false}]},
};

test("the destination resumes the same session only after the source gives up ownership", async () => {
    const id = randomUUID();
    const calls: string[] = [];
    let resumed: (state: IFlashcardV2SessionTransfer) => void;
    const received = new Promise<IFlashcardV2SessionTransfer>(resolve => { resumed = resolve; });
    const moved = sendFlashcardReviewToWindow(id, session, () => {
        receiveFlashcardReviewInWindow(id, new AbortController().signal, state => {
            calls.push("resume");
            resumed(state);
        }, () => assert.fail("handoff was rejected"));
    }, () => {
        calls.push("transfer");
        return () => calls.push("close");
    });
    assert.equal(await moved, true);
    assert.deepEqual(await received, session);
    assert.deepEqual(calls, ["transfer", "close", "resume"]);
});

test("closing the original session during a transfer cancels the destination", async () => {
    const id = randomUUID();
    let rejected: () => void;
    const cancelled = new Promise<void>(resolve => { rejected = resolve; });
    assert.equal(await sendFlashcardReviewToWindow(id, session, () => {
        receiveFlashcardReviewInWindow(id, new AbortController().signal,
            () => assert.fail("a closed review must not resume"), rejected);
    }, () => undefined), false);
    await cancelled;
});

test("two independent Electron windows can exchange a flashcard session", async () => {
    const folder = mkdtempSync(join(tmpdir(), "siyuan-flashcard-window-"));
    try {
        const source = transpileModule(readFileSync("src/card/flashcardV2WindowTransfer.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const init = "window.transfers={};new Function('exports'," + JSON.stringify(source) + ")(window.transfers);";
        const id = JSON.stringify(randomUUID());
        const send = `window.outgoing=window.transfers.sendFlashcardReviewToWindow(${id},${JSON.stringify(session)},()=>{},()=>()=>{});true;`;
        const receive = `new Promise((resolve,reject)=>window.transfers.receiveFlashcardReviewInWindow(${id},new AbortController().signal,resolve,()=>reject(new Error('Transfer failed'))));`;
        const script = join(folder, "transfer.cjs");
        writeFileSync(script, "const {app,BrowserWindow}=require('electron'),http=require('node:http');app.setPath('userData'," +
            JSON.stringify(join(folder, "profile")) + ");app.commandLine.appendSwitch('disable-gpu');" +
            "const server=http.createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end('<title>Test</title>');});" +
            "app.whenReady().then(()=>server.listen(0,'127.0.0.1',async()=>{try {" +
            "const url='http://127.0.0.1:'+server.address().port;const source=new BrowserWindow({show:false}),target=new BrowserWindow({show:false});" +
            "await Promise.all([source.loadURL(url),target.loadURL(url)]);await Promise.all([source,target].map(w=>w.webContents.executeJavaScript(" +
            JSON.stringify(init + "true;") + ")));await source.webContents.executeJavaScript(" + JSON.stringify(send) + ");" +
            "const state=await target.webContents.executeJavaScript(" + JSON.stringify(receive) + ");" +
            "const moved=await source.webContents.executeJavaScript('window.outgoing');console.log('WINDOW_RESULT='+JSON.stringify({state,moved}));app.exit(0);" +
            "}catch(error){console.error(error);app.exit(1);}}));", "utf8");
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const {stdout} = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 30000});
        const match = stdout.match(/WINDOW_RESULT=(.*)/);
        assert.ok(match, stdout);
        assert.deepEqual(JSON.parse(match[1]), {state: session, moved: true});
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
});
