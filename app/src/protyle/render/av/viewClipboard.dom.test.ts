import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

test("mobile view mirror copy reaches the editor from an external menu focus", async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-view-mirror-"));
    try {
        const clipboardSource = compile("src/protyle/util/blockClipboard.ts");
        const viewSource = compile("src/protyle/render/av/view.ts");
        const browserCase = `(async () => {
            document.body.innerHTML='<textarea>Outside menu</textarea><div class="protyle-wysiwyg" contenteditable="true"><div class="av" data-type="NodeAttributeView" custom-sy-av-view="original" custom-sy-av-visible-views="original,other"><div class="av__title" contenteditable="true" style="display:none">Database</div><div class="av__cursor" contenteditable="true">&#8203;</div></div></div>';
            const block=document.querySelector('.av');
            const editor=document.querySelector('.protyle-wysiwyg');
            const outside=document.querySelector('textarea');
            const constants={CUSTOM_SY_AV_VIEW:'custom-sy-av-view',CUSTOM_SY_AV_VISIBLE_VIEWS:'custom-sy-av-visible-views'};
            const helper={};
            new Function('exports','require',${JSON.stringify(clipboardSource)})(helper,()=>({isIOSPlatform:()=>true}));
            const exports={};
            new Function('exports','require',${JSON.stringify(viewSource + "\nexports.copyViewMirror = copyViewMirror;")})(exports,()=>({
                Constants:constants,copyBlockSelection:helper.copyBlockSelection,isNotEditBlock:()=>true,focusBlock:()=>false,
            }));
            let copied=0;
            editor.addEventListener('copy',event=>{
                if(getSelection().isCollapsed || !block.querySelector('.av__cursor').contains(getSelection().anchorNode)){
                    throw new Error('copy did not select the database cursor');
                }
                copied++;
                event.clipboardData.setData('text/plain',JSON.stringify({view:block.getAttribute(constants.CUSTOM_SY_AV_VIEW),visible:block.getAttribute(constants.CUSTOM_SY_AV_VISIBLE_VIEWS)}));
                event.preventDefault();
            });
            for(let index=0;index<2;index++){
                outside.focus();outside.select();
                exports.copyViewMirror(block,'selected');
            }
            return {copied,view:block.getAttribute(constants.CUSTOM_SY_AV_VIEW),visible:block.getAttribute(constants.CUSTOM_SY_AV_VISIBLE_VIEWS)};
        })()`;
        const script = path.join(temporary, "main.cjs");
        writeFileSync(script, `
            const {app,BrowserWindow,clipboard}=require('electron');
            app.setPath('userData',${JSON.stringify(path.join(temporary, "profile"))});
            app.disableHardwareAcceleration();
            app.whenReady().then(async()=>{
                const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
                await window.loadURL('about:blank');
                const result=await window.webContents.executeJavaScript(${JSON.stringify(browserCase)},true);
                result.clipboard=await clipboard.readText();
                process.stdout.write(JSON.stringify(result)+'\\n');app.exit(0);
            }).catch(error=>{process.stderr.write(error.stack);app.exit(1);});
        `);
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron"), [script], {env, timeout: 20000, windowsHide: true});
        assert.deepEqual(JSON.parse(result.stdout.trim().split("\n").at(-1)), {
            copied: 2, view: "original", visible: "original,other",
            clipboard: JSON.stringify({view: "selected", visible: "selected"}),
        });
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
