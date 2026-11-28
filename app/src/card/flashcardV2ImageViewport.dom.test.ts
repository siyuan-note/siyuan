import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCase = async (source: string) => {
    const style = document.createElement("style");
    style.textContent = ".card__v2-image-review-scroll{display:block}.card__v2-image-preview-scroll{width:600px;height:440px}";
    document.head.appendChild(style);
    const fixture = document.createElement("div");
    fixture.className = "card__v2-session";
    fixture.innerHTML = '<div class="card__block" style="width:400px;height:280px"><span class="card__v2-image-occlusion">' +
        '<img><span data-shape-id="target"></span><span data-shape-id="other"></span></span></div>';
    document.body.appendChild(fixture);
    const layer = fixture.querySelector<HTMLElement>(".card__v2-image-occlusion");
    const img = layer.querySelector("img");
    const bitmap = document.createElement("canvas");
    bitmap.width = 240;
    bitmap.height = 180;
    img.src = bitmap.toDataURL();
    await img.decode();
    class Dialog {
        element = document.createElement("div");
        constructor(private options: {content: string; destroyCallback: () => void}) {
            this.element.innerHTML = options.content;
            document.body.appendChild(this.element);
        }
        destroy() {
            this.element.remove();
            this.options.destroyCallback();
        }
    }
    const exports = {};
    new Function("exports", "require", source)(exports, (path: string) =>
        path.includes("adaptiveDialog") ? {AdaptiveDialog: Dialog} : {escapeAttr: (value: string) => value});
    const {bindFlashcardV2ImageViewport} = exports as typeof import("./flashcardV2ImageViewport");
    const view = bindFlashcardV2ImageViewport(layer, img, {left: .2, top: .25, right: .35, bottom: .4});
    const inline = fixture.querySelector<HTMLElement>(".card__v2-image-review-scroll");
    const initialFit = inline.style.getPropertyValue("--card-image-height");
    view.controls.querySelector<HTMLButtonElement>('[data-zoom="auto"]').click();
    const autoFocused = inline.hasAttribute("data-image-focused");
    img.click();
    const fullscreen = document.querySelector(".card__v2-image-preview-scroll");
    const maskedClone = Array.from(fullscreen.querySelectorAll<HTMLElement>("[data-shape-id]"), el => el.dataset.shapeId);
    const originalStillMounted = layer.contains(img);
    view.destroy();
    return {initialFit, autoFocused, maskedClone, originalStillMounted,
        closed: !document.querySelector(".card__v2-image-preview-scroll")};
};

test("the enlarged image clones both masks and closes with the owning review", async () => {
    const path = mkdtempSync(join(tmpdir(), "siyuan-mask-viewport-"));
    try {
        const source = transpileModule(readFileSync("src/card/flashcardV2ImageViewport.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const lang = {zoomIn: "Zoom in", zoomOut: "Zoom out", fitImage: "Fit image",
            flashcardFocusImageMask: "Focus current mask", flashcardImageOcclusion: "Image occlusion"};
        const command = "const __name = value => value; window.siyuan={languages:" + JSON.stringify(lang) + "};(" + browserCase.toString() +
            ")(" + JSON.stringify(source) + ");";
        const script = join(path, "viewport.cjs");
        writeFileSync(script, "const {app,BrowserWindow}=require('electron');" +
            "app.setPath('userData'," + JSON.stringify(join(path, "profile")) + ");" +
            "app.commandLine.appendSwitch('disable-gpu');app.whenReady().then(async()=>{" +
            "const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});" +
            "try {await win.loadURL('data:text/html,<html><body></body></html>');" +
            "const result=await win.webContents.executeJavaScript(" + JSON.stringify(command) + ");" +
            "console.log('VIEWPORT_RESULT='+JSON.stringify(result));app.exit(0);" +
            "} catch(error){console.error(error);app.exit(1);}});", "utf8");
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const {stdout} = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 30000});
        const match = stdout.match(/VIEWPORT_RESULT=(.*)/);
        assert.ok(match, stdout);
        const result = JSON.parse(match[1]);
        assert.match(result.initialFit, /^\d+px$/);
        assert.equal(result.autoFocused, true);
        assert.deepEqual(result.maskedClone, ["target", "other"]);
        assert.equal(result.originalStillMounted, true);
        assert.equal(result.closed, true);
    } finally {
        rmSync(path, {recursive: true, force: true});
    }
});
