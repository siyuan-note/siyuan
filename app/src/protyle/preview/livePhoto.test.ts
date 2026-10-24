import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync, mkdirSync, copyFileSync} from "node:fs";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {runInNewContext} from "node:vm";
import {compileString} from "sass";
import {transpileModule, ModuleKind, ScriptTarget} from "typescript";

const source = transpileModule(readFileSync("src/protyle/preview/livePhoto.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

test("Live Photo asset paths resolve from the resource root on every application page", () => {
    for (const page of ["/", "/stage/build/app/", "/stage/build/desktop/", "/stage/build/mobile/"]) {
        const exports = {} as typeof import("./livePhoto");
        runInNewContext(source, {exports, require: () => ({}), URL,
            location: {origin: "http://localhost:6806", href: "http://localhost:6806" + page}});
        for (const asset of ["assets/photo.mov", "assets/photo.mov?box=20261018000000-abcdefg&x=1", "/assets/photo.mov"]) {
            assert.equal(exports.livePhotoAssetPath(asset), asset.replace(/^\//, ""), page);
        }
        assert.equal(exports.livePhotoAssetPath("http://localhost:6806/assets/photo.mov"), "assets/photo.mov");
        for (const invalid of ["https://other.example/assets/photo.mov", "//other.example/assets/a.mov",
            "data:video/mp4;base64,AAAA", "javascript:alert(1)", "assets/%2e%2e/private.mov",
            "assets/a%5cb.mov", "assets/%ZZ.mov", "../private.mov"]) {
            assert.equal(exports.livePhotoAssetPath(invalid), "", invalid);
        }
    }
});

test("application-page playback reaches conversion and displays waiting and failure status", async () => {
    const root = realpathSync(tmpdir());
    const temporary = mkdtempSync(path.join(root, "siyuan-live-photo-status-"));
    const css = compileString(readFileSync("src/assets/scss/viewerjs/_viewer.scss", "utf8")).css;
    const server = createServer((_request, response) => {
        response.writeHead(200, {"Content-Type": "text/html"});
        response.end(`<!doctype html><style>${css}</style><div class="viewer-container"></div>`);
    });
    try {
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const browserCase = `(async () => {
            const requests = [];
            const originals = [];
            let finish;
            window.siyuan = {languages:{loading:"Loading preview",livePhotoPreviewUnavailable:"Preview unavailable. Original retained."}};
            HTMLMediaElement.prototype.play = function(){originals.push(this.src);return Promise.reject(new Error("simulated unsupported source"));};
            HTMLMediaElement.prototype.pause = () => {};
            HTMLMediaElement.prototype.load = () => {};
            const exports = {};
            const require = () => ({fetchSyncPost:(endpoint,data)=>{
                if(endpoint.includes("startLivePhotoPreview")){
                    requests.push(data.path);
                    return new Promise(resolve=>{finish=resolve;});
                }
                return Promise.resolve({code:0});
            }});
            ${source}
            const wait = async predicate => {
                const deadline=performance.now()+5000;
                while(!predicate()){if(performance.now()>deadline)throw new Error("preview timeout");await new Promise(resolve=>setTimeout(resolve,10));}
            };
            const host=document.querySelector(".viewer-container");
            document.body.style.setProperty("--b3-font-size","14px");
            document.body.style.setProperty("--b3-theme-background","#ffffff");
            const close=exports.createLivePhotoPlayer(host,"assets/photo.mov?box=20261018000000-abcdefg","", "20261018000000-abcdefg");
            await wait(()=>finish);
            const status=host.querySelector(".live-photo-preview > span");
            const waiting={size:parseFloat(getComputedStyle(status).fontSize),height:status.getBoundingClientRect().height,text:status.textContent};
            finish({code:-1});
            await wait(()=>status.textContent.startsWith("Preview unavailable"));
            const failed={size:parseFloat(getComputedStyle(status).fontSize),height:status.getBoundingClientRect().height};
            document.body.style.setProperty("--b3-font-size","28px");
            document.body.style.setProperty("--b3-theme-background","#222222");
            status.style.color="#eeeeee";
            const large={size:parseFloat(getComputedStyle(status).fontSize),height:status.getBoundingClientRect().height};
            const toolbar=document.createElement("div");toolbar.className="viewer-toolbar";
            toolbar.innerHTML='<ul><li class="viewer-live-photo"><svg><use href="#iconImagePlay"></use></svg></li></ul>';
            host.append(toolbar);
            const svg=toolbar.querySelector("svg").getBoundingClientRect();
            const icon={width:svg.width,height:svg.height};
            const result={requests,originals,waiting,failed,large,icon};
            window.closePreview=close;
            return result;
        })()`;
        const script = path.join(temporary, "main.cjs");
        writeFileSync(script, `
            const {app,BrowserWindow}=require("electron");
            const fs=require("node:fs");
            app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});
            app.disableHardwareAcceleration();
            app.whenReady().then(async()=>{
                const window=new BrowserWindow({show:false,width:360,height:640,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
                await window.loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/stage/build/app/`)});
                const result=await window.webContents.executeJavaScript(${JSON.stringify(browserCase)},true);
                await window.webContents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
                const screenshot=await window.webContents.capturePage();
                fs.writeFileSync(${JSON.stringify(path.join(temporary, "status.png"))},screenshot.toPNG());
                await window.webContents.executeJavaScript("window.closePreview()");
                process.stdout.write(JSON.stringify(result)+"\\n");
                app.exit(0);
            }).catch(error=>{process.stderr.write(error.stack);app.exit(1);});
        `);
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 20000});
        const report = JSON.parse(result.stdout.trim().split("\n").at(-1));
        assert.deepEqual(report.requests, ["assets/photo.mov?box=20261018000000-abcdefg"]);
        assert.equal(report.originals.length, 1);
        assert.ok(report.originals[0].endsWith("/assets/photo.mov?box=20261018000000-abcdefg"));
        assert.ok(!report.originals[0].includes("/stage/build/app/assets/"));
        for (const state of [report.waiting, report.failed, report.large]) {
            assert.ok(state.size >= 14 && state.height > 0, JSON.stringify(report));
        }
        assert.equal(report.large.size, 28);
        assert.deepEqual(report.icon, {width: 12, height: 24});
        if (process.env.SIYUAN_LIVE_PHOTO_REVIEW_IMAGES) {
            mkdirSync(process.env.SIYUAN_LIVE_PHOTO_REVIEW_IMAGES, {recursive: true});
            copyFileSync(path.join(temporary, "status.png"), path.join(process.env.SIYUAN_LIVE_PHOTO_REVIEW_IMAGES, "status.png"));
        }
    } finally {
        server.close();
        assert.equal(path.dirname(path.resolve(temporary)), root);
        assert.ok(path.basename(temporary).startsWith("siyuan-live-photo-status-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
