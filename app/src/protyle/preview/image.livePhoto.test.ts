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
import sharp from "sharp";

test("image gallery handles source scopes, copy feedback, Live Photos, and mobile controls", async () => {
    const root = realpathSync(tmpdir());
    const temporary = mkdtempSync(path.join(root, "siyuan-live-photo-gallery-"));
    const css = compileString(readFileSync("src/assets/scss/viewerjs/_viewer.scss", "utf8") +
        readFileSync("src/assets/scss/component/_snackbar.scss", "utf8") +
        ".fn__none { display: none !important; }").css;
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
    const mobilePng = await sharp({create: {width: 480, height: 320, channels: 3, background: "#fff"}}).png().toBuffer();
    const server = createServer((request, response) => {
        if (request.url?.startsWith("/stage/protyle/js/viewerjs/viewer.js")) {
            response.writeHead(200, {"Content-Type": "text/javascript"});
            response.end(readFileSync("stage/protyle/js/viewerjs/viewer.js"));
        } else if (request.url?.startsWith("/assets/")) {
            response.writeHead(200, {"Content-Type": "image/png"});
            response.end(request.url.startsWith("/assets/mobile-") ? mobilePng : Buffer.from(png, "base64"));
        } else {
            response.writeHead(200, {"Content-Type": "text/html"});
            response.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gallery verification</title><style>${css}</style><body><div id="message" class="b3-snackbars"><div class="fn__flex-1"></div></div><script>${readFileSync("appearance/icons/litheness/icon.js", "utf8")}</script>`);
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
        const escapeSource = transpileModule(readFileSync("src/util/escape.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText;
        const languages = JSON.parse(readFileSync("appearance/langs/en.json", "utf8"));
        const browserCase = `(async () => {
            document.documentElement.ontouchstart = null;
            const starts = [];
            const copiedURLs = [];
            const messages = [];
            let rejectCopy = false;
            let stopped = 0;
            let phase = "playing";
            const closed = [];
            const active = {playing:false,converting:false};
            const image = "data:image/png;base64,${png}";
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
            const escapeAPI = {};
            new Function("exports",${JSON.stringify(escapeSource)})(escapeAPI);
            const requests = [];
            const require = () => ({
                ...escapeAPI,
                isMobile: () => Boolean(document.getElementById("sidebar")),
                Constants:{PROTYLE_CDN:"/stage/protyle"},
                addScript: src => new Promise((resolve,reject) => {
                    if (window.Viewer) {resolve();return;}
                    const script=document.createElement("script");script.src=src;script.onload=resolve;script.onerror=reject;document.head.append(script);
                }),
                fetchPost: (url,data,callback) => {requests.push({url,data});callback({data:entries});},
                createLivePhotoPlayer: (host,video) => {
                    const current=phase;
                    const overlay=document.createElement("div");
                    overlay.className="live-photo-preview";
                    host.append(overlay);
                    active[current]=true;
                    starts.push(video);
                    return () => {overlay.remove();stopped++;closed.push(current);active[current]=false;};
                },
                isEncryptedBox: () => false,
                writeAssetToClipboard: () => ({ignore:false}),
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
            if (getComputedStyle(viewer.navigation).display==="none" || viewer.toolbar.querySelector(".viewer-next") ||
                !viewer.options.rotateOnTouch || !viewer.options.rotateOnGesture) {
                throw new Error("Desktop gallery controls changed");
            }
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

            const field=document.createElement("div");
            field.innerHTML='<div class="av__richtext-host">' +
                '<img src="/assets/first%20photo.png?box=notebook&amp;version=2"><img class="emoji" src="/assets/emoji.png">' +
                '<img src=""><img src="/assets/second%23photo.png"><img src="/assets/first%20photo.png?box=notebook&amp;version=2">' +
                '</div><div class="av__celltext--rich"><img src="/assets/other-field.png"></div>';
            document.body.append(field);
            const clicked=field.querySelector(".av__richtext-host img:last-child");
            exports.previewDocImage(clicked.getAttribute("src"),"host-doc","",clicked);
            await wait(()=>window.siyuan.viewer!==viewer && window.siyuan.viewer.viewed);
            const gallery=window.siyuan.viewer;
            const fieldImages=Array.from(gallery.images, item=>item.getAttribute("src"));
            const selected=gallery.index;
            gallery.prev();
            await wait(()=>gallery.index===1 && gallery.viewed);
            const previous=gallery.image.getAttribute("src");
            gallery.destroy();
            const other=field.querySelector(".av__celltext--rich img");
            exports.previewDocImage(other.getAttribute("src"),"host-doc","",other);
            await wait(()=>window.siyuan.viewer!==gallery && window.siyuan.viewer.viewed);
            const singleGallery=window.siyuan.viewer;
            const single=Array.from(singleGallery.images, item=>item.getAttribute("src"));
            singleGallery.destroy();
            window.checkMobileImagePreview = async (width) => {
                await wait(() => innerWidth === width);
                const sidebar = document.createElement("div");
                sidebar.id = "sidebar";
                document.body.append(sidebar);
                document.documentElement.style.setProperty("--b3-font-size", "22px");
                document.documentElement.style.setProperty("--mobile-bottom-bar-safe-area", "20px");
                const images = entries.map((entry, index) => ({...entry, src: "/assets/mobile-" + index + ".png"}));
                const previousGallery = window.siyuan.viewer;
                exports.previewImages(images, images[1].src, undefined, "assets/second.mov");
                await wait(() => window.siyuan.viewer !== previousGallery && window.siyuan.viewer.viewed);
                const mobile = window.siyuan.viewer;
                const footer = mobile.viewer.querySelector(".viewer-footer");
                const canvas = mobile.viewer.querySelector(".viewer-canvas");
                const buttons = [...mobile.toolbar.querySelectorAll("li")].filter(item => item.getClientRects().length);
                const positions = buttons.map(item => item.getBoundingClientRect());
                const next = mobile.toolbar.querySelector(".viewer-next");
                const previous = mobile.toolbar.querySelector(".viewer-prev");
                const reset = mobile.toolbar.querySelector(".viewer-reset");
                if (innerWidth !== width || getComputedStyle(mobile.navigation).display !== "none" ||
                    getComputedStyle(footer).paddingBottom !== "20px" ||
                    next.getBoundingClientRect().left - previous.getBoundingClientRect().right < 4 ||
                    next.getBoundingClientRect().top !== previous.getBoundingClientRect().top ||
                    new Set(positions.map(rect => rect.top)).size < 2 ||
                    positions.some(rect => rect.width < 44 || rect.height < 44 || rect.left < 0 || rect.right > innerWidth) ||
                    canvas.getBoundingClientRect().bottom > footer.getBoundingClientRect().top) {
                    throw new Error("Mobile gallery buttons do not fit below the image");
                }
                if (Math.abs(mobile.imageData.y - (canvas.clientHeight - mobile.imageData.height) / 2) > 1) {
                    throw new Error("Mobile image was centered before all toolbar controls were laid out");
                }
                for (const [button, label] of [[next, "Next"], [previous, "Previous"], [reset, "Reset"]]) {
                    const rect = button.getBoundingClientRect();
                    if (button.getAttribute("aria-label") !== label ||
                        !button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))) {
                        throw new Error("Mobile gallery action is obscured or unlabeled: " + label);
                    }
                }
                const point = (type, pointerId, clientX, clientY, target = canvas) => target.dispatchEvent(new PointerEvent(type, {
                    bubbles: true, cancelable: true, pointerType: "touch", pointerId, clientX, clientY,
                }));
                const startingRatio = mobile.imageData.ratio;
                const startImage = mobile.image.getBoundingClientRect();
                const tapX = startImage.x + startImage.width / 4;
                const tapY = startImage.y + startImage.height / 4;
                if (document.elementFromPoint(tapX, tapY) !== mobile.image) {
                    throw new Error("The mobile preview image cannot receive taps");
                }
                const tap = pointerId => {
                    point("pointerdown", pointerId, tapX, tapY, mobile.image);
                    point("pointerup", pointerId, tapX, tapY, mobile.image);
                };
                tap(1);
                if (mobile.imageData.ratio !== startingRatio || !mobile.viewed) {
                    throw new Error("A single tap changed or closed the mobile image");
                }
                tap(2);
                await wait(() => mobile.imageData.ratio === startingRatio * 2);
                const zoomedImage = mobile.image.getBoundingClientRect();
                if (Math.abs(zoomedImage.x + zoomedImage.width / 4 - tapX) > 1 ||
                    Math.abs(zoomedImage.y + zoomedImage.height / 4 - tapY) > 1) {
                    throw new Error("Mobile double-tap did not zoom around the touch point");
                }
                point("pointerdown", 5, tapX, tapY, mobile.image);
                point("pointermove", 5, tapX + 12, tapY, mobile.image);
                point("pointerup", 5, tapX + 12, tapY, mobile.image);
                if (mobile.image.getBoundingClientRect().x <= zoomedImage.x || mobile.imageData.ratio !== startingRatio * 2) {
                    throw new Error("Dragging a zoomed image must move it without changing the zoom");
                }
                tap(3);
                tap(4);
                await wait(() => mobile.imageData.ratio === startingRatio);
                const restoredImage = mobile.image.getBoundingClientRect();
                if (restoredImage.x !== startImage.x || restoredImage.y !== startImage.y) {
                    throw new Error("The second double-tap did not restore the initial view");
                }
                point("pointerdown", 1, 30, 60);
                point("pointerdown", 2, 130, 60);
                point("pointermove", 2, 180, 69);
                point("pointerup", 1, 30, 60);
                point("pointerup", 2, 180, 69);
                if (mobile.imageData.ratio <= startingRatio || mobile.imageData.rotate !== 0) {
                    throw new Error("Mobile pinch must zoom without rotating");
                }
                const ratioAfterPinch = mobile.imageData.ratio;
                for (const [type, scale, rotation] of [["gesturestart", 1, 0], ["gesturechange", 1.5, 3], ["gestureend", 1.5, 3]]) {
                    mobile.viewer.dispatchEvent(Object.assign(new Event(type, {cancelable: true}), {scale, rotation}));
                }
                if (mobile.imageData.ratio <= ratioAfterPinch || mobile.imageData.rotate !== 0) {
                    throw new Error("WebKit gesture must zoom without rotating");
                }
                mobile.toolbar.querySelector(".viewer-rotate-right").click();
                if (mobile.imageData.rotate !== 90) { throw new Error("Mobile manual rotation is unavailable"); }
                reset.click();
                if (mobile.imageData.rotate !== 0 || mobile.imageData.ratio !== startingRatio) {
                    throw new Error("Mobile reset did not restore the image");
                }
                mobile.toolbar.querySelector(".viewer-live-photo").click();
                const overlay = mobile.viewer.querySelector(".live-photo-preview");
                if (!overlay || overlay.getBoundingClientRect().bottom > footer.getBoundingClientRect().top) {
                    throw new Error("Mobile Live Photo overlaps the toolbar");
                }
                next.click();
                await wait(() => mobile.index === 2 && mobile.viewed);
                previous.click();
                await wait(() => mobile.index === 1 && mobile.viewed);
                if (overlay.isConnected) { throw new Error("Switching from a Live Photo left its overlay open"); }
                mobile.destroy();
                exports.previewImages([image]);
                await wait(() => window.siyuan.viewer !== mobile && window.siyuan.viewer.viewed);
                const single = window.siyuan.viewer;
                if (single.toolbar.querySelector(".viewer-prev, .viewer-next")) {
                    throw new Error("Single mobile images show redundant navigation");
                }
                single.viewer.querySelector(".viewer-canvas").click();
                await wait(() => single.destroyed);
                sidebar.remove();
            };
            return {starts,stopped,hidden,closed,requests,fieldImages,selected,previous,single};
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
                for (const width of [320,360]) {
                    const size={width,height:640};
                    window.webContents.enableDeviceEmulation({screenPosition:"mobile",screenSize:size,
                        viewSize:size,deviceScaleFactor:1,scale:1});
                    await window.webContents.executeJavaScript("window.checkMobileImagePreview("+width+")",true);
                }
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
            requests: [{url: "/api/asset/getDocPreviewImages", data: {id: "document"}}],
            fieldImages: ["/assets/first%20photo.png?box=notebook&version=2", "/assets/second%23photo.png",
                "/assets/first%20photo.png?box=notebook&version=2"],
            selected: 2, previous: "/assets/second%23photo.png", single: ["/assets/other-field.png"],
        });
    } finally {
        server.close();
        assert.equal(path.dirname(path.resolve(temporary)), root);
        assert.ok(path.basename(temporary).startsWith("siyuan-live-photo-gallery-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
