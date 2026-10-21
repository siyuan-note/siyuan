import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const api = new Function("Constants", "mathRender", "tabsRender", "destroyTabsRender", source +
        "; return {ListMindmapView, readListMindmap};")(
        {CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data"}, () => {}, () => {}, () => {});
    const lute = Lute.New();
    lute.SetProtyleWYSIWYG(true);
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const settle = async () => { await frame(); await frame(); await frame(); };
    for (const mobile of [false, true]) {
        for (const dark of [false, true]) {
            document.body.className = mobile ? "body--android" : "body--windows";
            const parent = document.createElement("div");
            parent.style.cssText = `width:${mobile ? 320 : 760}px;transform:translateX(5px);overflow:hidden`;
            const host = document.createElement("div");
            host.style.cssText = `--mindmap-view-height:${mobile ? 300 : 460}px;` +
                `--b3-theme-background:${dark ? "#222" : "#fff"};--b3-theme-primary:#3574f0;--b3-border-color:#888`;
            parent.append(host);
            document.body.append(parent);
            const holder = document.createElement("div");
            holder.innerHTML = lute.Md2BlockDOM("- Root\n" +
                Array.from({length: 12}, (_, index) => `  - Node ${index}\n`).join(""));
            const list = holder.firstElementChild;
            const originalSource = list.outerHTML;
            const view = new api.ListMindmapView({host, model: api.readListMindmap(list), onExit: () => {}});
            await settle();
            const viewport = host.querySelector<HTMLElement>(".mindmap-view__viewport");
            const center = () => [(viewport.clientWidth / 2 - view.offsetX) / view.scale,
                (viewport.clientHeight / 2 - view.offsetY) / view.scale];
            const equalCenter = (expected: number[]) => center().forEach((value, index) =>
                check.ok(Math.abs(value - expected[index]) < 1e-8, "mode changes preserve the logical center"));
            const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
            const initialStyle = host.style.cssText;
            for (const scale of [.75, 1.25]) {
                view.zoomAt(scale);
                const documentCenter = center();
                const documentTransform = [view.scale, view.offsetX, view.offsetY];
                const root = host.querySelector<HTMLElement>(".mindmap-view__node");
                const documentPosition = root.getBoundingClientRect();
                const equalDocumentView = () => {
                    equalCenter(documentCenter);
                    [view.scale, view.offsetX, view.offsetY].forEach((value, index) => {
                        check.ok(Math.abs(value - documentTransform[index]) < 1e-8,
                            "leaving fullscreen restores the document transform");
                    });
                };
                button("fullscreen").click();
                await settle();
                equalCenter(documentCenter);
                check.equal(view.scale, scale);
                check.equal(host.parentElement, document.body);
                button("exitFullscreen").click();
                await settle();
                equalDocumentView();

                button("fullscreen").click();
                await settle();
                const full = viewport.getBoundingClientRect();
                if (mobile) {
                    const touches = (distance: number) => [0, 1].map(index => new Touch({identifier: index,
                        target: viewport, clientX: full.left + full.width / 2 + (index ? distance : -distance),
                        clientY: full.top + full.height / 2}));
                    viewport.dispatchEvent(new TouchEvent("touchstart", {touches: touches(50), cancelable: true}));
                    viewport.dispatchEvent(new TouchEvent("touchmove", {touches: touches(60), cancelable: true}));
                    viewport.dispatchEvent(new TouchEvent("touchend", {touches: [], cancelable: true}));
                    check.ok(view.scale > scale, "two fingers can zoom the fullscreen view");
                } else {
                    viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: 12, deltaY: 8,
                        bubbles: true, cancelable: true}));
                    const slider = host.querySelector<HTMLInputElement>(".mindmap-view__zoom-actions input");
                    slider.value = "150";
                    slider.dispatchEvent(new Event("input", {bubbles: true}));
                    check.equal(view.scale, 1.5);
                }
                check.notEqual(view.scale, scale);
                viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: 60, deltaY: 40,
                    bubbles: true, cancelable: true}));
                check.notDeepEqual(center(), documentCenter, "fullscreen panning changes the current center");
                view.setReadOnly(true);
                host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
                await settle();
                equalDocumentView();
                check.equal(host.parentElement, parent);
                check.equal(host.style.cssText, initialStyle);
                const restored = root.getBoundingClientRect();
                check.ok(Math.abs(restored.left - documentPosition.left) < 1 &&
                    Math.abs(restored.top - documentPosition.top) < 1,
                "fullscreen pan and zoom leave the document reading position unchanged");
                check.equal(list.outerHTML, originalSource);
                view.setReadOnly(false);
                button("fullscreen").click();
                await settle();
                equalCenter(documentCenter);
                check.equal(view.scale, scale, "reentering starts from the document, not the discarded fullscreen view");
                button("exitFullscreen").click();
                await settle();
                equalDocumentView();
            }
            const rapid = center();
            button("fullscreen").click();
            button("exitFullscreen").click();
            button("fullscreen").click();
            button("exitFullscreen").click();
            await settle();
            equalCenter(rapid);
            button("fullscreen").click();
            await settle();
            viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: -100000, bubbles: true, cancelable: true}));
            check.notDeepEqual(center(), rapid);
            button("exitFullscreen").click();
            await settle();
            equalCenter(rapid);
            view.refreshLayout();
            await settle();
            equalCenter(rapid);

            const beforeResize = center();
            const beforeResizeScale = view.scale;
            button("fullscreen").click();
            await settle();
            parent.style.width = `${mobile ? 360 : 680}px`;
            view.zoomAt(1.8);
            button("exitFullscreen").click();
            await settle();
            equalCenter(beforeResize);
            check.equal(view.scale, beforeResizeScale, "resizing the document restores its logical center and zoom");

            const beforeEdit = center();
            const beforeEditScale = view.scale;
            button("fullscreen").click();
            await settle();
            view.zoomAt(1.8);
            const content = view.model.root.contentBlocks[0].querySelector('[contenteditable="true"]');
            content.textContent = "Edited root";
            const editedSource = list.outerHTML;
            view.update(api.readListMindmap(list));
            await settle();
            button("exitFullscreen").click();
            await settle();
            equalCenter(beforeEdit);
            check.equal(view.scale, beforeEditScale);
            check.equal(view.getContentHost(view.model.root.id).textContent, "Edited root",
                "restoring the document viewport keeps content updates made in fullscreen");
            check.equal(list.outerHTML, editedSource);

            const beforeLock = center();
            const beforeLockScale = view.scale;
            button("fullscreen").click();
            await settle();
            view.zoomAt(1.8);
            view.setLocked(true);
            button("exitFullscreen").click();
            await settle();
            equalCenter(beforeLock);
            check.equal(view.scale, beforeLockScale, "locking in fullscreen does not replace the saved document view");
            button("fullscreen").click();
            await settle();
            view.destroy();
            check.equal(host.parentElement, parent);
            check.equal(host.classList.contains("fullscreen"), false);
            check.equal(Array.from(parent.childNodes).some(node => node.nodeType === Node.COMMENT_NODE), false);
            const initializing = new api.ListMindmapView({host, model: api.readListMindmap(list), onExit: () => {}});
            button("fullscreen").click();
            button("exitFullscreen").click();
            await settle();
            check.equal(initializing.initialFit, false, "an early round trip still completes the initial document layout");
            check.equal(host.parentElement, parent);
            check.ok(Number.isFinite(initializing.offsetX) && Number.isFinite(initializing.offsetY));
            initializing.destroy();
            parent.remove();
        }
    }
    return "Mindmap fullscreen cases passed";
};

test("fullscreen preserves entry focus and restores the document viewport without reverting content updates", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = ["../av/richTextValue.ts", "summary.ts", "connectors.ts", "model.ts", "fold.ts", "routing.ts", "pan.ts", "view.ts"]
        .map(file => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText).join("\n");
    const css = ["business/_block.scss", "protyle/_mindmap-view.scss"].map(file => require("sass").compile(
        path.resolve(__dirname, "../../../assets/scss", file), {logger: require("sass").Logger.silent}).css).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-fullscreen-"));
    const script = path.join(temporary, "run.cjs");
    const lute = path.resolve(__dirname, "../../../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lute)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(css)})`)}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {
            env, timeout: 25000, windowsHide: true,
        });
        assert.match(result.stdout, /Mindmap fullscreen cases passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
