import * as assert from "node:assert/strict";
import {test} from "node:test";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("read-only template dialog preserves declarations and unknown fields without execution", async () => {
    const directory = mkdtempSync(join(tmpdir(), "siyuan-template-ui-"));
    const source = transpileModule(readFileSync("src/card/flashcardV2Template.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const formSource = transpileModule(readFileSync("src/card/flashcardV2Form.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const expression = `(async()=>{
        const assert=(value,message)=>{if(!value)throw new Error(message)};
        const dialogs=[],pending=[],calls=[];let plugins=0;
        window.siyuan={languages:new Proxy({},{get:(_target,key)=>String(key)}),ws:{app:{plugins:[{render:()=>plugins++}]}}};
        class Dialog{constructor(options){this.options=options;this.element=document.createElement('section');this.element.innerHTML=options.content;document.body.append(this.element);dialogs.push(this)}destroy(){if(this.element.isConnected){this.element.remove();this.options.destroyCallback?.()}}}
        const modules={'../dialog':{Dialog},'../util/functions':{isMobile:()=>false},
            '../util/fetch':{fetchPost:(url,data,cb,_headers,fail,signal,timeout)=>{calls.push(url);return new Promise(resolve=>pending.push({url,data,cb,fail,signal,timeout,resolve}))}}};
        modules['./flashcardV2Form']={};
        new Function('require','exports',${JSON.stringify(formSource)})(()=>({}),modules['./flashcardV2Form']);
        const exports={};new Function('require','exports',${JSON.stringify(source)})(name=>{assert(!!modules[name],'unexpected module '+name);return modules[name]},exports);
        const {describeFlashcardTemplate:describe,openFlashcardV2Template:open}=exports;
        const payload=()=>({card:{id:'card',sourceID:'source',templateID:'template'},
            source:{id:'source',schemaID:'schema',sourceType:'plugin:sample:custom',pluginNamespace:'sample',pluginData:{secret:'DO_NOT_SHOW'},disabledTemplateIDs:['template']},
            schema:{id:'schema',name:'Schema',builtinType:'unverified-declaration'},
            template:{id:'template',schemaID:'schema',name:'<img src="https://invalid.example/img" onerror="window.executed=true">',enabled:true,answerMode:'<script>window.executed=true</script>',
                frontSpec:{html:'<script>window.executed=true</script>'},backSpec:{text:'back'},generationRule:{mode:'static'},contextPolicy:{sensitive:'literal'},
                style:'@import url(https://invalid.example/style);body{display:none}',futureUnknown:{nested:['preserved',0,false]}},
            references:[{entityID:'DO_NOT_SHOW'}],reviewState:{secret:'DO_NOT_SHOW'}});
        const model=payload();const description=describe(model,'card');
        assert(description.enabled&&description.sourceDisabled,'enabled and source disabled conflated');
        assert(JSON.parse(description.declarations).pluginNamespace==='sample','consistent namespace missing');
        assert(JSON.parse(description.configuration).futureUnknown.nested[0]==='preserved','unknown field lost');
        const mismatch=payload();mismatch.source.pluginNamespace='different';assert(JSON.parse(describe(mismatch,'card').declarations).pluginNamespace===null,'inconsistent namespace presented');
        const plain=payload();plain.source.sourceType='ordered';assert(JSON.parse(describe(plain,'card').declarations).pluginNamespace===null,'nonplugin ownership invented');
        const invalid=payload();invalid.template.schemaID='other';assert(describe(invalid,'card')===undefined,'mixed identities accepted');
        const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
        const finish=async(request,response)=>{if(response.code===0)request.cb(response);else request.fail?.(response);request.resolve();await tick()};
        open('card');const first=dialogs.at(-1);const initial=pending.shift();assert(initial.timeout===30000,'missing timeout');
        await finish(initial,{code:-1});assert(!first.element.querySelector('[data-action="refresh"]').disabled,'failure retry disabled');
        first.element.querySelector('[data-action="refresh"]').click();await finish(pending.shift(),{code:0,data:model});
        assert(first.element.querySelectorAll('input:checked').length===2,'separate readonly state checkboxes missing');
        assert([...first.element.querySelectorAll('input')].every(input=>input.disabled),'editable state exposed');
        const sections=[...first.element.querySelectorAll('details.card__v2-disclosure')];
        assert(sections.length===2&&sections.every(section=>!section.open&&section.querySelector('summary use').getAttribute('xlink:href')==='#iconRight'),'shared disclosure icons missing');
        const configs=[...first.element.querySelectorAll('pre')].map(pre=>pre.textContent);
        assert(JSON.parse(configs[1]).futureUnknown.nested[0]==='preserved','display lost unknown fields');
        assert(!first.element.textContent.includes('DO_NOT_SHOW'),'unrelated source or state leaked');
        assert(!first.element.querySelector('img,script,style,iframe'),'template content mounted');
        assert(!window.executed&&plugins===0,'template executed');
        first.element.querySelector('[data-action="close"]').click();
        open('card');const late=dialogs.at(-1);const lateRequest=pending.shift();late.element.querySelector('[data-action="close"]').click();
        assert(lateRequest.signal.aborted,'close did not abort');await finish(lateRequest,{code:0,data:model});
        assert(!late.element.isConnected&&late.element.querySelector('[data-role="details"]').childNodes.length===0,'late response resurrected details');
        assert(calls.length===3&&calls.every(url=>url==='/api/flashcard/getRenderModel'),'write or extra API called');
        return {passed:true,plugins,calls:calls.length};
    })()`;
    const script = join(directory, "test.cjs");
    writeFileSync(script, `const {app,BrowserWindow,session}=require('electron');
        app.setPath('userData',${JSON.stringify(join(directory, "profile"))});app.commandLine.appendSwitch('disable-gpu');
        app.whenReady().then(async()=>{let requests=0;
            session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{requests++;callback({cancel:true})});
            const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
            try{await win.loadURL('data:text/html,<html><body></body></html>');const result=await win.webContents.executeJavaScript(${JSON.stringify(expression)});
                await new Promise(resolve=>setTimeout(resolve,100));console.log('TEMPLATE_RESULT='+JSON.stringify({...result,requests}));app.exit(0)
            }catch(error){console.error(error);app.exit(1)}});`, "utf8");
    try {
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        const {stdout} = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 30000});
        const match = stdout.match(/TEMPLATE_RESULT=(.*)/);
        assert.ok(match, stdout);
        assert.deepEqual(JSON.parse(match[1]), {passed: true, plugins: 0, calls: 3, requests: 0});
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
