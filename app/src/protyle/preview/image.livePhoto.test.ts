import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync} from "node:fs";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {transpileModule, ModuleKind, ScriptTarget} from "typescript";
import {compileString} from "sass";

test("image gallery shows copy results above the preview and releases Live Photos on navigation and slideshow", async () => {
    const root = realpathSync(tmpdir());
    const temporary = mkdtempSync(path.join(root, "siyuan-live-photo-gallery-"));
    const css = compileString(readFileSync("src/assets/scss/viewerjs/_viewer.scss", "utf8") +
        readFileSync("src/assets/scss/component/_snackbar.scss", "utf8")).css;
    const server = createServer((request, response) => {
        if (request.url?.startsWith("/stage/protyle/js/viewerjs/viewer.js")) {
            response.writeHead(200, {"Content-Type": "text/javascript"});
            response.end(readFileSync("stage/protyle/js/viewerjs/viewer.js"));
        } else {
            response.writeHead(200, {"Content-Type": "text/html"});
            response.end(`<!doctype html><title>Gallery verification</title><style>${css}</style><body><div id="message" class="b3-snackbars"><div class="fn__flex-1"></div></div><script>${readFileSync("appearance/icons/litheness/icon.js", "utf8")}</script>`);
        }
    });
    try {
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const source = transpileModule(readFileSync("src/protyle/preview/image.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText;
        const messageSource = transpileModule(readFileSync("src/dialog/message.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText;
        const languages = JSON.parse(readFileSync("appearance/langs/en.json", "utf8"));
        const browserCase = `(async () => {
            const starts = [];
            const copiedURLs = [];
            const messages = [];
            let rejectCopy = false;
            let stopped = 0;
            let phase = "playing";
            const closed = [];
            const active = {playing:false,converting:false};
            const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
            const entries = [{src:image,video:"assets/first.mov"},{src:image,video:"assets/second.mov"},{src:image}];
            window.siyuan = {languages:${JSON.stringify(languages)},zIndex:10};
            const messageAPI = {};
            new Function("exports","require",${JSON.stringify(messageSource)})(messageAPI, () => ({
                genUUID: () => crypto.randomUUID(),
                getHostCapabilities: () => ({remoteKernel:false}),
                sanitizeKernelHTML: text => text,
                Constants: {SIYUAN_VERSION:"test"},
            }));
            const exports = {};
            const require = () => ({
                Constants:{PROTYLE_CDN:"/stage/protyle"},
                addScript: src => new Promise((resolve,reject) => {
                    const script=document.createElement("script");script.src=src;script.onload=resolve;script.onerror=reject;document.head.append(script);
                }),
                fetchPost: (_url,_data,callback) => callback({data:entries}),
                createLivePhotoPlayer: (_host,video) => {
                    const current=phase;
                    active[current]=true;
                    starts.push(video);
                    return () => {stopped++;closed.push(current);active[current]=false;};
                },
                isEncryptedBox: () => false,
                writeClipboardData: async ({textPlain}) => {
                    copiedURLs.push(textPlain);
                    if (rejectCopy) throw new Error("Clipboard denied");
                    return {status:"plain"};
                },
                showMessage: (...args) => {messages.push(args);return messageAPI.showMessage(...args);},
                getZIndex: element => Number(element.style.zIndex),
            });
            ${source}
            const wait = async predicate => {
                const deadline=performance.now()+8000;
                while(!predicate()){if(performance.now()>deadline){throw new Error("gallery timeout: "+predicate.toString());}await new Promise(resolve=>setTimeout(resolve,10));}
            };
            exports.previewDocImage(image,"document","assets/second.mov");
            await wait(()=>window.siyuan.viewer?.viewed);
            const viewer=window.siyuan.viewer;
            const checkCount = expected => {
                if (!viewer.title.textContent.startsWith(expected + " ")) {
                    throw new Error("gallery count mismatch: " + viewer.title.textContent);
                }
            };
            checkCount("2/3");
            const copyURL=viewer.toolbar.querySelector(".viewer-copy-url");
            if(copyURL?.getAttribute("aria-label")!=="Copy image URL"){throw new Error("Copy image URL action missing");}
            const copyIcon=copyURL.querySelector("svg").getBoundingClientRect();
            if(copyIcon.width!==12 || copyIcon.height!==24){throw new Error("Copy image URL icon size mismatch");}
            copyURL.click();
            copyURL.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
            copyURL.dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true}));
            if(copiedURLs.length!==3 || copiedURLs.some(value=>value!==image)){throw new Error("Copy image URL mismatch");}
            await wait(()=>messages.length===3);
            if(messages.some(args=>args[0]!==window.siyuan.languages.copied)){throw new Error("Copy success message mismatch");}
            const toast=document.querySelector(".b3-snackbar");
            const messageRoot=document.getElementById("message");
            if(Number(messageRoot.style.zIndex)<=Number(viewer.viewer.style.zIndex)){throw new Error("Copy result is behind preview");}
            const initialGeometry={rect:toast.getBoundingClientRect(),width:innerWidth,height:innerHeight};
            await wait(()=>{
                const rect=toast.getBoundingClientRect();
                return toast.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
            }).catch(error=>{
                const rect=toast.getBoundingClientRect();
                throw new Error(error.message+JSON.stringify({rect,initialGeometry,html:messageRoot.outerHTML,
                    point:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.outerHTML.slice(0,200)}));
            });
            rejectCopy=true;
            copyURL.click();
            await wait(()=>messages.length===4);
            if(messages[3][0]!==window.siyuan.languages.copyImageURLFailed || messages[3][2]!=="error"){
                throw new Error("Failed copy must show an error instead of success");
            }
            const button=viewer.toolbar.querySelector(".viewer-live-photo");
            if (!button || button.classList.contains("fn__none")) {throw new Error("Live Photo action missing");}
            const icon=button.querySelector("use");
            if(icon?.getAttribute("xlink:href")!=="#iconImagePlay"){throw new Error("Live Photo icon mismatch");}
            const bounds=icon.getBBox();
            if(bounds.width<=0 || bounds.height<=0){throw new Error("Live Photo icon is empty");}
            button.click();
            viewer.view(0);
            await wait(()=>viewer.index===0 && viewer.viewed);
            checkCount("1/3");
            button.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
            viewer.options.autoplay=false;
            viewer.play();
            if(active.playing || stopped!==2){throw new Error("slideshow retained previous playback");}
            viewer.stop();
            phase="converting";
            button.click();
            viewer.play();
            if(active.converting || stopped!==3){throw new Error("slideshow retained pending conversion");}
            viewer.stop();
            viewer.view(2);
            await wait(()=>viewer.index===2 && viewer.viewed);
            checkCount("3/3");
            const hidden=button.classList.contains("fn__none");
            viewer.destroy();
            return {starts,stopped,hidden,closed};
        })()`;
        const script = path.join(temporary, "main.cjs");
        writeFileSync(script, `
            const {app,BrowserWindow}=require("electron");
            app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});
            app.disableHardwareAcceleration();
            app.whenReady().then(async()=>{
                const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
                await window.loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/`)});
                if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
                    window.showInactive();
                    window.webContents.enableDeviceEmulation({screenPosition:"desktop",screenSize:{width:800,height:600},
                        viewSize:{width:800,height:600},deviceScaleFactor:1,scale:1});
                }
                const result=await window.webContents.executeJavaScript(${JSON.stringify(browserCase)},true);
                process.stdout.write(JSON.stringify(result)+"\\n");
                app.exit(0);
            }).catch(error=>{process.stderr.write(error.stack);app.exit(1);});
        `);
        const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: path.join(temporary, "cache")};
        delete env.ELECTRON_RUN_AS_NODE;
        const args = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ?
            ["--ozone-platform=headless", script] : [script];
        const result = await promisify(execFile)(require("electron"), args, {
            env, windowsHide: true, timeout: 20000,
        });
        assert.deepEqual(JSON.parse(result.stdout.trim().split("\n").at(-1)), {
            starts: ["assets/second.mov", "assets/first.mov", "assets/first.mov"], stopped: 3, hidden: true,
            closed: ["playing", "playing", "converting"],
        });
    } finally {
        server.close();
        assert.equal(path.dirname(path.resolve(temporary)), root);
        assert.ok(path.basename(temporary).startsWith("siyuan-live-photo-gallery-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
