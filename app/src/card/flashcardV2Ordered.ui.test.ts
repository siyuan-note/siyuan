import * as assert from "node:assert/strict";
import {test} from "node:test";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("synthetic ordered dialog preserves retry input, focus and safe close/load boundaries", async () => {
    const directory = mkdtempSync(join(tmpdir(), "siyuan-ordered-ui-"));
    const sources: Record<string, string> = {};
    for (const name of ["flashcardV2Ordered", "flashcardV2OrderedState", "flashcardV2OrderedSummary", "flashcardV2Form"]) {
        sources[`./${name}`] = transpileModule(readFileSync(`src/card/${name}.ts`, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
    }
    const expression = `(async () => {
        const assert=(value,message)=>{if(!value)throw new Error(message)};
        const dialogs=[], pending=[], confirmations=[]; let reloads=0, sequence=0;
        const languages=new Proxy({}, {get:(_target,key)=>String(key)});
        window.siyuan={languages};
        class Dialog {
            constructor(options){this.options=options;this.element=document.createElement('section');this.element.innerHTML=options.content;document.body.append(this.element);dialogs.push(this)}
            destroy(){if(this.options.beforeClose&&!this.options.beforeClose())return;this.forceClose()}
            forceClose(){if(!this.element.isConnected)return;this.element.remove();this.options.destroyCallback?.()}
        }
        const modules={
            '../dialog':{Dialog}, '../dialog/confirmDialog':{confirmDialog: ({confirm}) => confirmations.push(confirm)},
            '../util/fetch':{fetchPost:(url,data,cb,_headers,fail,signal,timeout)=>new Promise(resolve=>pending.push({url,data:JSON.parse(JSON.stringify(data)),cb,fail,resolve,signal,timeout}))},
            '../util/genID':{genUUID:()=> 'operation-'+(++sequence)}, '../util/functions':{isMobile:()=>false},
            '../dialog/message':{},
            './flashcardV2Contract':{isFlashcardV2Object:value=>value!==null&&typeof value==='object'&&!Array.isArray(value)},
        };
        const sources=${JSON.stringify(sources)};
        const require=name=>{if(modules[name])return modules[name];const exports={};modules[name]=exports;new Function('require','exports',sources[name])(require,exports);return exports};
        const {openFlashcardV2Ordered}=require('./flashcardV2Ordered');
        const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
        const finish=async(request,response)=>{if(response.code===0)request.cb?.(response);else request.fail?.(response);request.resolve();await tick()};
        const details=()=>({sourceRevision:{revisionID:'revision',entityID:'source',payload:{id:'source',sourceType:'ordered',generationConfig:{steps:[{id:'a',displayOrder:0,occlusionIDs:['oa']},{id:'b',displayOrder:1,occlusionIDs:['ob']}]}}},
            references:[{sourceID:'source',entityType:'block',entityID:'ba',role:'occlusion:oa'},{sourceID:'source',entityType:'block',entityID:'bb',role:'occlusion:ob'}],
            doms:{ba:'<div>Alpha &lt;b&gt;safe&lt;/b&gt;</div>',bb:'<div>Beta</div>'},contentFingerprint:'f'.repeat(64)});
        const open=()=>{openFlashcardV2Ordered('source',()=>reloads++,()=>true);return dialogs.at(-1)};
        const button=(dialog,action)=>dialog.element.querySelector('[data-action="'+action+'"]');
        const first=open();const initial=pending.shift();
        assert(initial.timeout===30000,'load lacks timeout');assert(button(first,'save').disabled,'loading save enabled');
        await finish(initial,{code:0,data:details()});
        assert(first.element.querySelector('summary').textContent==='Alpha <b>safe</b>','summary changed');assert(!first.element.querySelector('summary b'),'summary injected markup');
        assert(first.element.querySelector('details.card__v2-disclosure summary use')?.getAttribute('xlink:href')==='#iconRight','shared disclosure icon missing');
        assert(button(first,'up').disabled,'top up enabled');first.element.querySelector('details').open=true;button(first,'down').click();
        assert(first.element.querySelector('[data-step-id="a"] details').open,'expanded content lost after move');
        assert(document.activeElement.closest('li').dataset.stepId==='a','focus did not follow moved identity');
        button(first,'refresh').click();assert(confirmations.length===1,'dirty refresh unconfirmed');
        confirmations.pop();assert(pending.length===0,'cancelled refresh fetched');
        button(first,'save').click();const save=pending.shift();assert(save.timeout===30000,'save lacks timeout');
        assert(button(first,'cancel').disabled,'saving cancel enabled');
        await finish(save,{code:-1});assert(!button(first,'save').disabled,'failed save cannot retry');
        button(first,'save').click();const retry=pending.shift();
        assert(JSON.stringify(retry.data)===JSON.stringify(save.data),'retry payload identity changed');
        await finish(retry,{code:0});assert(!first.element.isConnected&&reloads===1,'success did not close/reload once');

        const late=open();const lateRequest=pending.shift();button(late,'cancel').click();
        assert(lateRequest.signal.aborted,'load not aborted on close');await finish(lateRequest,{code:0,data:details()});
        assert(!late.element.isConnected&&late.element.querySelectorAll('li').length===0,'late load revived dialog');

        const unreadable=open();const unreadableRequest=pending.shift();const blank=details();blank.doms.ba='<img src="https://invalid.example/no-alt">';
        await finish(unreadableRequest,{code:0,data:blank});assert(button(unreadable,'save').disabled,'unreadable initial source sortable');button(unreadable,'cancel').click();

        const refreshFailure=open();await finish(pending.shift(),{code:0,data:details()});button(refreshFailure,'down').click();button(refreshFailure,'refresh').click();confirmations.pop()();
        await finish(pending.shift(),{code:0,data:blank});assert(button(refreshFailure,'save').disabled,'unreadable refresh re-enabled old save');
        assert([...refreshFailure.element.querySelectorAll('[data-action="up"],[data-action="down"]')].every(element=>element.disabled),'unreadable refresh re-enabled moves');
        button(refreshFailure,'cancel').click();
        const forced=open();await finish(pending.shift(),{code:0,data:details()});button(forced,'down').click();button(forced,'save').click();
        const forcedRequest=pending.shift();forced.forceClose();assert(reloads===2,'unknown result close did not refresh');
        await finish(forcedRequest,{code:0});assert(!forced.element.isConnected&&reloads===2,'late save revived or refreshed twice');
        return {passed:true,reloads};
    })()`;
    const script = join(directory, "test.cjs");
    writeFileSync(script, `const {app,BrowserWindow,session}=require('electron');
        app.setPath('userData',${JSON.stringify(join(directory, "profile"))});
        app.commandLine.appendSwitch('disable-gpu');
        app.whenReady().then(async()=>{
            let requests=0;
            session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{requests++;callback({cancel:true});});
            const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
            try {await win.loadURL('data:text/html,<html><body></body></html>');
                const result=await win.webContents.executeJavaScript(${JSON.stringify(expression)});
                console.log('ORDERED_UI_RESULT='+JSON.stringify({...result,requests}));app.exit(0);
            }catch(error){console.error(error);app.exit(1)}
        });`, "utf8");
    try {
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        const {stdout} = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 30000});
        const match = stdout.match(/ORDERED_UI_RESULT=(.*)/);
        assert.ok(match, stdout);
        assert.deepEqual(JSON.parse(match[1]), {passed: true, reloads: 2, requests: 0});
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
