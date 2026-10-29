const assert = require("node:assert/strict");
const {readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, writeFileSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const run = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    const ts = require("typescript");
    const compile = file => ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText;
    const source = compile("sync/checkoutProgress.ts");
    const escape = compile("util/escape.ts");
    const progressContent = compile("dialog/progress.ts");
    const languageDirectory = path.join(__dirname, "../appearance/langs");
    const exitLabels = readdirSync(languageDirectory).filter(name => name.endsWith(".json"))
        .map(name => [name, JSON.parse(readFileSync(path.join(languageDirectory, name), "utf8")).skipExitSync]);
    const sass = require("sass");
    const css = ["component/_dialog.scss", "component/_button.scss", "component/_sync-checkout.scss", "util/_function.scss"]
        .map(file => sass.compile(path.join(__dirname, "../src/assets/scss", file)).css).join("\n");
    try {
        for (const [width, height, font, dark] of [[1100, 720, 16, false], [1100, 720, 24, true], [360, 640, 14, false], [360, 640, 24, false], [640, 360, 24, true]]) {
            win.setContentSize(width, height);
            await win.loadURL("data:text/html,<html><body><input id='editor' value='original'></body></html>");
            await win.webContents.insertCSS(css + `
                :root {--b3-theme-primary:#357;--b3-mask-background:#0008;--b3-theme-background:${dark ? "#222" : "#fff"};
                    --b3-theme-on-surface:${dark ? "#9aa0a6" : "#5f6368"};--b3-theme-secondary:${dark ? "#f3a92f" : "#ff9200"};
                    --b3-theme-surface:#888;--b3-border-radius:4px;--b3-border-radius-b:8px;}
                body,button {font-size:${font}px;}
                #editor {position:fixed;left:8px;top:8px;}`);
            const themeOverride = await win.webContents.insertCSS(".b3-button {background-color:rgb(90,100,110);}");
            const result = await win.webContents.executeJavaScript(`(async () => {
                const assert = require("node:assert/strict");
                window.siyuan = {zIndex:100,languages:{sync:"Sync",expand:"Expand",collapseSyncDetails:"Hide details",cancel:"Cancel",_kernel:{436:"Applying synchronized changes"}}};
                const escapeExports = {};
                new Function("exports", ${JSON.stringify(escape)})(escapeExports);
                const progressExports = {};
                new Function("exports", ${JSON.stringify(progressContent)})(progressExports);
                progressExports.progressLoading({code:0,msg:"<img src=x>",data:{current:1,total:10}},"standard-progress");
                const standard = document.getElementById("standard-progress");
                assert.equal(standard.querySelector(".b3-dialog__progress-label").textContent,"1/10");
                assert.equal(standard.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"),"10");
                assert.equal(standard.querySelector('[data-type="message"]').textContent,"<img src=x>");
                assert.equal(standard.querySelector("img"),null);
                const sharedBarHeight = getComputedStyle(standard.querySelector(".b3-dialog__progress")).height;
                const sharedColor = getComputedStyle(standard.querySelector(".b3-dialog__loading")).color;
                assert.equal(sharedBarHeight,"4px");
                progressExports.progressLoading({code:0,msg:"overrun",data:{current:999,total:10}},"standard-progress");
                assert.equal(standard.querySelector(".b3-dialog__progressbar").style.width,"100%");
                progressExports.progressLoading({code:0,msg:"unknown",data:{current:NaN,total:0}},"standard-progress");
                assert.equal(standard.querySelector('[role="progressbar"]').hasAttribute("aria-valuenow"),false);
                assert.ok(standard.querySelector(".b3-dialog__progress--indeterminate"));
                progressExports.progressLoading({code:1,msg:"Waiting"},"other-progress");
                let skipped = 0;
                progressExports.progressLoading({code:1,msg:"Waiting"},"other-progress", {
                    label:"Skip sync and exit", callback:() => skipped++,
                });
                const skipButton = document.querySelector("#other-progress button");
                assert.ok(skipButton.classList.contains("b3-button"));
                assert.equal(document.activeElement,skipButton,"exit action did not receive keyboard focus");
                assert.equal(getComputedStyle(skipButton).backgroundColor,"rgb(90, 100, 110)");
                skipButton.click();
                assert.equal(skipped,1);
                progressExports.progressLoading({code:1,msg:"<img src=y>"},"other-progress");
                assert.equal(document.querySelector('#other-progress [data-type="message"]').textContent,"<img src=y>");
                assert.equal(document.querySelector("#other-progress button"),skipButton,"progress update replaced the exit action");
                const skipBounds = skipButton.getBoundingClientRect();
                assert.ok(skipBounds.left >= 0 && skipBounds.right <= innerWidth && skipBounds.bottom <= innerHeight,
                    "exit action overflowed the progress panel");
                assert.equal(document.querySelector("#other-progress img"),null);
                progressExports.progressLoading({code:2},"standard-progress");
                assert.ok(document.getElementById("other-progress"),"closing sync progress removed another task");
                progressExports.progressLoading({code:2},"other-progress");
                for (const [language, label] of ${JSON.stringify(exitLabels)}) {
                    progressExports.progressLoading({code:1,msg:"Waiting"},"localized-exit", {label,callback() {}});
                    const panel = document.querySelector("#localized-exit .b3-dialog__loading").getBoundingClientRect();
                    const button = document.querySelector("#localized-exit button");
                    const bounds = button.getBoundingClientRect();
                    assert.ok(button.classList.contains("b3-button--wrap"),language+": missing shared wrapping modifier");
                    assert.ok(bounds.left >= panel.left && bounds.right <= panel.right && bounds.left >= 0 &&
                        bounds.right <= innerWidth && bounds.bottom <= innerHeight,language+": exit action overflowed");
                    assert.ok(button.scrollWidth <= button.clientWidth + 1,language+": exit action text overflowed");
                    progressExports.progressLoading({code:2},"localized-exit");
                }
                const calls = [];
                const flushes = [];
                const titles = [];
                const reloads = [];
                let saveInput, saveRequests, refreshQueued;
                let pendingRequests = new Promise(resolve => saveRequests = resolve);
                let pendingReloads = Promise.resolve();
                let snapshot;
                let reloadCount = 0;
                let poll;
                window.setInterval = callback => { poll = callback; return 1; };
                window.clearInterval = () => {};
                const editors = ["desktop", "mobile", "secondary"].map((id, index) => ({
                    protyle:{id,block:{rootID:"changed"},wysiwyg:{},title:{flushPendingInput:() => titles.push(id)}},
                    flushPendingTransactions:() => {
                        flushes.push(id);
                        return index ? Promise.resolve() : new Promise(resolve => saveInput = resolve);
                    }
                }));
                const runtime = {};
                new Function("exports","require","window",${JSON.stringify(source)})(runtime, name => {
                    if (name.includes("escape")) return escapeExports;
                    if (name === "../dialog/progress") return progressExports;
                    if (name.includes("constants")) return {Constants:{SIYUAN_APPID:"app"}};
                    if (name.includes("getAll")) return {getAllEditor:() => editors};
                    if (name.includes("editorSave")) return {getEditorSaveFailureVersion:() => 0,flushPendingEditorSaves:() => pendingRequests};
                    if (name.includes("reloadSync")) return {waitForSyncReloads:() => pendingReloads};
                    if (name.includes("reload")) return {reloadProtyleAndWait:protyle => new Promise(resolve => reloads.push({protyle,resolve}))};
                    return {fetchSyncPost:(url,data) => {
                        if (url.endsWith("getSyncCheckout")) return Promise.resolve({code:0,data:snapshot});
                        if (url.endsWith("confirmSyncCheckout")) { calls.push({url,data}); return Promise.resolve({code:0,data:{requested:true}}); }
                        return new Promise((resolve,reject) => calls.push({url,data,resolve,reject}));
                    }};
                }, {siyuan:window.siyuan,setInterval:window.setInterval,clearInterval:window.clearInterval,
                    location:{reload:() => reloadCount++}});
                const tick = () => new Promise(resolve => setTimeout(resolve,0));
                const editor = document.getElementById("editor");
                editor.focus();
                const progress = (taskID,code,revision,phase="applying",extra={}) => runtime.syncCheckoutProgress({code,msg:"",
                    data:{taskID,revision,phase,blocking:phase!=="background",current:1,total:10,
                    message:"<img src=x onerror='window.compromised=true'>",...extra}});
                progress("first",0,1,"background");
                assert.equal(document.getElementById("sync-checkout-progress"),null);
                assert.equal(document.activeElement,editor);
                assert.equal(editor.dispatchEvent(new Event("beforeinput",{bubbles:true,cancelable:true})),true);
                assert.equal(runtime.openSyncCheckoutProgress(),true);
                let root = document.getElementById("sync-checkout-progress");
                assert.equal(root.querySelector('[role="dialog"]').getAttribute("aria-modal"),"false");
                assert.equal(document.activeElement,editor);
                assert.equal(getComputedStyle(root.querySelector(".sync-checkout__scrim")).display,"none");
                root.querySelector('[data-action="toggle"]').click();
                assert.equal(document.getElementById("sync-checkout-progress"),null);
                progress("first",0,2,"preparing",{token:"window-token"});
                root = document.getElementById("sync-checkout-progress");
                assert.ok(root && root.contains(document.activeElement));
                assert.equal(root.classList.contains("sync-checkout--compact"),false,"local checkout should open the existing full progress view");
                assert.equal(root.querySelector(".sync-checkout__panel").hasAttribute("tabindex"),false,"the progress panel must not acquire a focus outline");
                assert.equal(document.activeElement,root.querySelector('[data-action="toggle"]'));
                assert.equal(getComputedStyle(root.querySelector(".sync-checkout__panel")).color,sharedColor);
                assert.equal(getComputedStyle(root.querySelector(".sync-checkout__notice")).color,sharedColor,"sync notice should use the normal progress text color");
                assert.equal(getComputedStyle(root.querySelector(".b3-dialog__progress")).height,sharedBarHeight);
                await tick();
                assert.deepEqual(flushes,["desktop","mobile","secondary"]);
                assert.deepEqual(titles,flushes);
                assert.equal(calls.length,0);
                saveInput(); await tick();
                assert.equal(calls.length,0,"acknowledged before transaction requests completed");
                snapshot = {kernelID:"kernel-one",revision:2,task:{taskID:"first",revision:2,phase:"preparing",blocking:true,token:"window-token"}};
                await runtime.reconcileSyncCheckout("secondary",true);
                assert.equal(reloadCount,0,"reconnect discarded input that was still being saved");
                saveRequests(); await tick();
                assert.equal(calls.length,1);
                assert.deepEqual(calls.shift().data,{taskID:"first",token:"window-token",saved:true});
                progress("first",0,3);
                root.querySelector('[data-action="toggle"]').focus();
                document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}));
                assert.equal(document.activeElement,root.querySelector('[data-action="cancel"]'));
                assert.equal(root.querySelector("img"),null);
                assert.equal(root.querySelector('[data-type="message"]').textContent,"<img src=x onerror='window.compromised=true'>");
                assert.equal(root.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"),"10");
                assert.equal(root.querySelector(".b3-dialog__progress-label").textContent,"10%");
                assert.equal(getComputedStyle(root.querySelector("button")).backgroundColor,"rgb(90, 100, 110)");
                for (const type of ["beforeinput","paste","drop","keydown"]) {
                    const event = type === "keydown" ? new KeyboardEvent(type,{key:"a",bubbles:true,cancelable:true}) : new Event(type,{bubbles:true,cancelable:true});
                    assert.equal(editor.dispatchEvent(event),false,type+" escaped editing guard");
                }
                assert.ok(document.elementFromPoint(12,12).classList.contains("sync-checkout__scrim"));
                root.querySelector('[data-action="toggle"]').click();
                assert.ok(root.classList.contains("sync-checkout--compact"));
                assert.ok(root.querySelector(".sync-checkout__details").classList.contains("fn__none"));
                assert.equal(getComputedStyle(root.querySelector(".sync-checkout__notice")).color,sharedColor,"collapsed sync notice should use the normal progress text color");
                const compactPanel = root.querySelector(".sync-checkout__panel").getBoundingClientRect();
                const noticeRect = root.querySelector(".sync-checkout__notice").getBoundingClientRect();
                const actionsRect = root.querySelector(".sync-checkout__actions").getBoundingClientRect();
                assert.ok(actionsRect.top >= noticeRect.bottom,"compact actions must be below the notice");
                assert.ok(Math.abs(actionsRect.width-noticeRect.width) <= 1,"compact rows must fill the same available width");
                assert.ok(compactPanel.left >= 0 && compactPanel.right <= innerWidth,"compact panel must fit the viewport");
                const compactCancel = root.querySelector('[data-action="cancel"]').getBoundingClientRect();
                assert.ok(Math.abs(compactCancel.right-actionsRect.right) <= 1,"compact actions must remain right aligned");
                assert.equal(editor.dispatchEvent(new Event("beforeinput",{bubbles:true,cancelable:true})),false);
                assert.ok(document.elementFromPoint(12,12).classList.contains("sync-checkout__scrim"));
                const restoringMessage = "Restoring 20231013134532-9doj565.sy\\n(3192/3192): 407 B / 407 B, 44 B/s, 00:00:00 remaining";
                progress("first",0,3,"applying",{current:9,message:restoringMessage});
                assert.ok(root.classList.contains("sync-checkout--compact"));
                root.querySelector('[data-action="toggle"]').click();
                assert.equal(root.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"),"90");
                const message = root.querySelector('[data-type="message"]');
                assert.equal(message.textContent,restoringMessage);
                const fileRange = document.createRange();
                fileRange.setStart(message.firstChild,0);
                fileRange.setEnd(message.firstChild,restoringMessage.indexOf("\\n"));
                const statsRange = document.createRange();
                statsRange.setStart(message.firstChild,restoringMessage.indexOf("\\n")+1);
                statsRange.setEnd(message.firstChild,restoringMessage.indexOf(")")+1);
                assert.ok(statsRange.getBoundingClientRect().top >= fileRange.getBoundingClientRect().bottom,
                    "progress statistics must start on a separate line at every viewport size");
                const panel = root.querySelector(".sync-checkout__panel").getBoundingClientRect();
                assert.ok(panel.left>=0 && panel.right<=innerWidth && panel.top>=0 && panel.bottom<=innerHeight,JSON.stringify(panel));
                if (innerWidth <= 600) assert.ok(panel.width >= innerWidth - 40,"narrow progress view wastes available width");
                assert.ok(root.querySelector(".sync-checkout__panel").scrollWidth <= Math.ceil(panel.width),"narrow panel has horizontal overflow");
                root.querySelectorAll("button").forEach(button => {
                    const rect = button.getBoundingClientRect();
                    assert.ok(rect.left >= panel.left && rect.right <= panel.right,"action is clipped at large font sizes");
                });
                const cancel = root.querySelector('[data-action="cancel"]');
                cancel.click(); cancel.click();
                assert.equal(calls.length,1);
                assert.equal(calls[0].url,"/api/sync/cancelSyncCheckout");
                assert.equal(calls[0].data.taskID,"first");
                assert.equal(cancel.disabled,true);
                calls[0].reject(); await new Promise(resolve=>setTimeout(resolve,0));
                assert.equal(cancel.disabled,false);
                cancel.click(); calls[1].resolve({code:0,data:{requested:true}});
                await new Promise(resolve=>setTimeout(resolve,0));
                progress("stale",2,2);
                assert.ok(document.getElementById("sync-checkout-progress"));
                pendingReloads = new Promise(resolve => refreshQueued = resolve);
                progress("first",0,4,"background",{upsertRootIDs:["changed"]});
                await tick();
                assert.equal(reloads.length,0,"did not wait for queued syncMergeResult refresh");
                assert.equal(editor.dispatchEvent(new Event("beforeinput",{bubbles:true,cancelable:true})),false);
                refreshQueued(); await tick();
                assert.equal(reloads.length,3,"did not refresh every affected editor");
                assert.equal(editor.dispatchEvent(new Event("beforeinput",{bubbles:true,cancelable:true})),false);
                reloads.forEach(item => item.resolve()); await tick();
                assert.equal(document.getElementById("sync-checkout-progress"),null);
                assert.equal(document.activeElement,editor);
                assert.equal(editor.dispatchEvent(new Event("beforeinput",{bubbles:true,cancelable:true})),true);
                progress("first",2,5,"done");
                assert.equal(runtime.openSyncCheckoutProgress(),false);
                editors.forEach(item => item.flushPendingTransactions = () => Promise.reject(new Error("save failed")));
                editor.value = "unsaved draft";
                progress("unsaved",0,6,"preparing",{token:"failed-save"}); await tick();
                assert.equal(calls.at(-1).data.saved,false);
                snapshot = {kernelID:"kernel-one",revision:7,task:null};
                await runtime.reconcileSyncCheckout("secondary",true);
                assert.equal(reloadCount,0,"failed preparation discarded an unsaved draft");
                assert.equal(editor.value,"unsaved draft");
                assert.equal(editor.dispatchEvent(new Event("beforeinput",{bubbles:true,cancelable:true})),true);
                calls.length = 0;
                progress("lost",0,8);
                snapshot = {kernelID:"kernel-one",revision:9,task:null};
                await runtime.reconcileSyncCheckout("secondary",true);
                assert.equal(reloadCount,1,"reconnect did not recover a lost terminal event");
                progress("lost",2,9,"done"); await tick();
                progress("lost-again",0,10);
                snapshot = {kernelID:"kernel-one",revision:11,task:null};
                poll(); await tick();
                assert.equal(reloadCount,2,"polling did not recover a dropped terminal frame");
                progress("lost-again",2,11,"done"); await tick();
                snapshot = {kernelID:"kernel-two",revision:1,task:{taskID:"restarted",revision:1,phase:"background",blocking:false}};
                await runtime.reconcileSyncCheckout();
                assert.equal(runtime.openSyncCheckoutProgress(),true,"kernel restart retained an obsolete revision");
                progress("restarted",2,2,"done");
                progress("stale",0,1);
                assert.equal(document.getElementById("sync-checkout-progress"),null);
                progress("second",0,3,"applying",{current:999,message:"Restoring long-resource-file-name.bin\\n(1/60): 4.60 GB / 10.50 GB, 32 MB/s, 00:03:12 remaining"});
                runtime.openSyncCheckoutProgress();
                assert.equal(document.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"),"100");
                assert.equal(document.querySelector(".b3-dialog__progressbar").style.width,"100%");
                assert.equal(document.querySelector('[data-action="cancel"]').disabled,false);
                progress("second",0,3,"applying",{total:0});
                assert.equal(document.querySelector('[role="progressbar"]').hasAttribute("aria-valuenow"),false);
                assert.ok(document.querySelector(".b3-dialog__progress--indeterminate"));
                progress("second",0,3,"applying",{current:460,total:1050,
                    message:"Restoring long-resource-file-name.bin\\n(1/60): 4.60 GB / 10.50 GB, 32 MB/s, 00:03:12 remaining"});
                assert.equal(document.querySelector(".b3-dialog__progress--indeterminate"),null);
                return "passed";
            })()`);
            assert.equal(result, "passed");
            await win.webContents.removeInsertedCSS(themeOverride);
            await new Promise(resolve => setTimeout(resolve, 200));
            if (process.env.SIYUAN_CHECKOUT_CAPTURE) {
                mkdirSync(process.env.SIYUAN_CHECKOUT_CAPTURE, {recursive: true});
                writeFileSync(path.join(process.env.SIYUAN_CHECKOUT_CAPTURE, `checkout-${width}-${height}-${font}-${dark}.png`),
                    (await win.webContents.capturePage()).toPNG());
            }
            await win.webContents.executeJavaScript("document.querySelector('[data-action=\"toggle\"]').click(); void 0;");
            await new Promise(resolve => setTimeout(resolve, 200));
            if (process.env.SIYUAN_CHECKOUT_CAPTURE) {
                writeFileSync(path.join(process.env.SIYUAN_CHECKOUT_CAPTURE, `checkout-compact-${width}-${height}-${font}-${dark}.png`),
                    (await win.webContents.capturePage()).toPNG());
            }
        }
        console.log("Sync checkout interaction and layout cases passed");
        win.destroy(); app.exit(0);
    } catch (error) {
        console.error(error);win.destroy();app.exit(1);
    }
};

if (process.versions.electron && process.type === "browser") {
    run().catch(error => {console.error(error);require("electron").app.exit(1);});
} else {
    require("node:test").test("sync stays editable in background, saves all editors, waits for refresh and recovers lost events across desktop/mobile layouts", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 90000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-sync-checkout-"));
        const env = {...process.env};delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(require("electron"),
                [__filename,profile], {env, windowsHide: true, timeout: 75000});
            assert.match(stdout,/Sync checkout interaction and layout cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep));
            rmSync(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});
        }
    });
}
