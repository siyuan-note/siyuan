const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync} = require("node:fs");
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
    const sass = require("sass");
    const css = ["dialog", "button", "sync-checkout"].map(name => sass.compile(path.join(__dirname,
        `../src/assets/scss/component/_${name}.scss`)).css).join("\n");
    try {
        for (const [width, height, font, dark] of [[1100, 720, 16, false], [1100, 720, 24, true], [360, 640, 24, false], [640, 360, 24, true]]) {
            win.setContentSize(width, height);
            await win.loadURL("data:text/html,<html><body><input id='editor' value='original'></body></html>");
            await win.webContents.insertCSS(css + `
                :root {--b3-theme-primary:#357;--b3-mask-background:#0008;--b3-theme-background:${dark ? "#222" : "#fff"};
                    --b3-theme-on-surface:${dark ? "#eee" : "#222"};--b3-theme-surface:#888;--b3-border-radius:4px;--b3-border-radius-b:8px;}
                body,button {font-size:${font}px;} .fn__none {display:none;} .fn__flex {display:flex;align-items:center;}
                .fn__flex-1 {flex:1;} .fn__space {width:8px;} .b3-button {background-color:rgb(90,100,110);}
                .ft__breakword {word-break:break-all;}
                #editor {position:fixed;left:8px;top:8px;}`);
            const result = await win.webContents.executeJavaScript(`(async () => {
                const assert = require("node:assert/strict");
                window.siyuan = {zIndex:100,languages:{sync:"Sync",collapse:"Collapse",cancel:"Cancel",_kernel:{436:"Editing stays blocked during sync"}}};
                const escapeExports = {};
                new Function("exports", ${JSON.stringify(escape)})(escapeExports);
                const calls = [];
                const runtime = {};
                new Function("exports","require",${JSON.stringify(source)})(runtime, name => name.includes("escape") ? escapeExports : {
                    fetchSyncPost:(url,data) => new Promise((resolve,reject) => calls.push({url,data,resolve,reject}))
                });
                const editor = document.getElementById("editor");
                editor.focus();
                const progress = (taskID,code,current=1,total=10,msg="<img src=x onerror='window.compromised=true'>") =>
                    runtime.syncCheckoutProgress({code,msg,data:{taskID,current,total}});
                progress("first",0);
                let root = document.getElementById("sync-checkout-progress");
                assert.ok(root && root.contains(document.activeElement));
                document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}));
                assert.equal(document.activeElement,root.querySelector('[data-action="toggle"]'));
                assert.equal(root.querySelector("img"),null);
                assert.equal(root.querySelector('[data-type="message"]').textContent,"<img src=x onerror='window.compromised=true'>");
                assert.equal(root.querySelector("progress").value,10);
                assert.equal(getComputedStyle(root.querySelector("button")).backgroundColor,"rgb(90, 100, 110)");
                for (const type of ["beforeinput","paste","drop","keydown"]) {
                    const event = type === "keydown" ? new KeyboardEvent(type,{key:"a",bubbles:true,cancelable:true}) : new Event(type,{bubbles:true,cancelable:true});
                    assert.equal(editor.dispatchEvent(event),false,type+" escaped editing guard");
                }
                assert.ok(document.elementFromPoint(12,12).classList.contains("sync-checkout__scrim"));
                root.querySelector('[data-action="toggle"]').click();
                assert.ok(root.classList.contains("sync-checkout--compact"));
                assert.ok(root.querySelector(".sync-checkout__details").classList.contains("fn__none"));
                assert.equal(editor.dispatchEvent(new Event("beforeinput",{bubbles:true,cancelable:true})),false);
                assert.ok(document.elementFromPoint(12,12).classList.contains("sync-checkout__scrim"));
                progress("first",0,9,10,"Still restoring");
                assert.ok(root.classList.contains("sync-checkout--compact"));
                root.querySelector('[data-action="toggle"]').click();
                assert.equal(root.querySelector("progress").value,90);
                const panel = root.querySelector(".sync-checkout__panel").getBoundingClientRect();
                assert.ok(panel.left>=0 && panel.right<=innerWidth && panel.top>=0 && panel.bottom<=innerHeight,JSON.stringify(panel));
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
                progress("stale",2);
                assert.ok(document.getElementById("sync-checkout-progress"));
                progress("first",2);
                assert.equal(document.getElementById("sync-checkout-progress"),null);
                assert.equal(document.activeElement,editor);
                assert.equal(editor.dispatchEvent(new Event("beforeinput",{bubbles:true,cancelable:true})),true);
                progress("second",0,999,10,"Restoring /assets/long-resource-file-name.bin (1/60): 4.60 GB / 10.50 GB, 32 MB/s, 00:03:12 remaining");
                assert.equal(document.querySelector("progress").value,100);
                assert.equal(document.querySelector('[data-action="cancel"]').disabled,false);
                return "passed";
            })()`);
            assert.equal(result, "passed");
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
    require("node:test").test("sync checkout progress guards editing, handles cancellation, and fits desktop/mobile layouts", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-sync-checkout-"));
        const env = {...process.env};delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(require("electron"),
                [__filename,profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout,/Sync checkout interaction and layout cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep));
            rmSync(profile,{recursive:true,force:true});
        }
    });
}
