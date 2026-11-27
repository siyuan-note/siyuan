import * as assert from "node:assert/strict";
import {test} from "node:test";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("synthetic inert DOM summaries extract text without mounting or requesting resources", async () => {
    const directory = mkdtempSync(join(tmpdir(), "siyuan-ordered-summary-"));
    const source = transpileModule(readFileSync("src/card/flashcardV2OrderedSummary.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const expression = `(() => {
        const exports = {}; ${source}
        const read = exports.readOrderedSummaryBlock;
        const result = read('<div><p>First</p><p>Second</p><span data-type="mark" data-occlusion-id="a">Al<b>ph</b><span data-type="mark" data-occlusion-id="a">a</span></span><span data-type="mark" data-occlusion-id="a">Beta</span><script>window.summaryExecuted=true</script><img src="https://invalid.example/image" alt="Image label"><iframe src="https://invalid.example/frame"></iframe></div>');
        const formula = read('<div data-type="NodeMathBlock"><span data-content="x^2"></span><span>render noise</span></div>');
        const inline = read('<span data-type="inline-math" data-content="y+1">render noise</span>');
        const subtype = read('<span data-subtype="math" data-content="z=3"></span>');
        const unknown = read('<img src="https://invalid.example/unknown">');
        return {text: result.text, mark: result.marks.get('a'), formula: formula.text, inline: inline.text,
            subtype: subtype.text, unknown: unknown.text, mounted: document.body.childNodes.length,
            executed: window.summaryExecuted === true};
    })()`;
    const script = join(directory, "test.cjs");
    writeFileSync(script, `const {app,BrowserWindow,session}=require('electron');
        app.setPath('userData',${JSON.stringify(join(directory, "profile"))});
        app.commandLine.appendSwitch('disable-gpu');
        app.whenReady().then(async()=>{
            let requests=0;
            session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{requests++;callback({cancel:true});});
            const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
            try {
                await win.loadURL('data:text/html,<html><body></body></html>');
                const result=await win.webContents.executeJavaScript(${JSON.stringify(expression)});
                await new Promise(resolve=>setTimeout(resolve,100));
                console.log('SUMMARY_RESULT='+JSON.stringify({...result,requests}));app.exit(0);
            } catch(error){console.error(error);app.exit(1);}
        });`, "utf8");
    try {
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        const {stdout} = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 30000});
        const match = stdout.match(/SUMMARY_RESULT=(.*)/);
        assert.ok(match, stdout);
        const result = JSON.parse(match[1]);
        assert.deepEqual(result, {text: "First Second AlphaBetaImage label", mark: "AlphaBeta", formula: "x^2", inline: "y+1",
            subtype: "z=3", unknown: "", mounted: 0, executed: false, requests: 0});
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
