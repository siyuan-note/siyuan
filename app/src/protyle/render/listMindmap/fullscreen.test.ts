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
            const guide = host.querySelector<HTMLElement>(".mindmap-view__document-frame");
            const center = () => [(viewport.clientWidth / 2 - view.offsetX) / view.scale,
                (viewport.clientHeight / 2 - view.offsetY) / view.scale];
            const equalCenter = (expected: number[]) => center().forEach((value, index) =>
                check.ok(Math.abs(value - expected[index]) < 1e-8, "mode changes preserve the logical center"));
            const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
            const initialStyle = host.style.cssText;
            const size = [viewport.clientWidth, viewport.clientHeight];
            check.equal(button("listMindmapDocumentLayout").hidden, true);
            for (const scale of [.75, 1.25]) {
                view.zoomAt(scale);
                const documentCenter = center();
                const documentTransform = [view.scale, view.offsetX, view.offsetY];
                button("fullscreen").click();
                await settle();
                equalCenter(documentCenter);
                check.equal(view.scale, scale);
                check.equal(host.parentElement, document.body);
                check.equal(guide.hidden, true);
                button("listMindmapDocumentLayout").click();
                check.equal(button("listMindmapDocumentLayout").getAttribute("aria-pressed"), "true");
                check.equal(getComputedStyle(guide).pointerEvents, "none");
                const bounds = guide.getBoundingClientRect();
                const full = viewport.getBoundingClientRect();
                check.deepEqual([bounds.width, bounds.height], size);
                check.ok(Math.abs(bounds.left + bounds.width / 2 - full.left - full.width / 2) < 1);
                check.ok(Math.abs(bounds.top + bounds.height / 2 - full.top - full.height / 2) < 1);
                check.equal(getComputedStyle(guide).borderTopStyle, "dashed");
                button("listMindmapDocumentLayout").click();
                check.equal(guide.hidden, true);
                button("listMindmapDocumentLayout").click();
                button("exitFullscreen").click();
                await settle();
                equalCenter(documentCenter);
                check.deepEqual([view.scale, view.offsetX, view.offsetY], documentTransform,
                    "an unchanged round trip restores the document transform");
                check.equal(guide.hidden, true);

                button("fullscreen").click();
                await settle();
                button("listMindmapDocumentLayout").click();
                if (mobile) {
                    const touches = (distance: number) => [0, 1].map(index => new Touch({identifier: index,
                        target: viewport, clientX: full.left + full.width / 2 + (index ? distance : -distance),
                        clientY: full.top + full.height / 2}));
                    viewport.dispatchEvent(new TouchEvent("touchstart", {touches: touches(50), cancelable: true}));
                    viewport.dispatchEvent(new TouchEvent("touchmove", {touches: touches(60), cancelable: true}));
                    viewport.dispatchEvent(new TouchEvent("touchend", {touches: [], cancelable: true}));
                    check.ok(view.scale > scale, "two fingers can zoom through the document frame");
                } else {
                    viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: 12, deltaY: 8,
                        bubbles: true, cancelable: true}));
                    const slider = host.querySelector<HTMLInputElement>(".mindmap-view__zoom-actions input");
                    slider.value = "150";
                    slider.dispatchEvent(new Event("input", {bubbles: true}));
                    check.equal(view.scale, 1.5);
                }
                const adjusted = center();
                const adjustedScale = view.scale;
                const root = host.querySelector<HTMLElement>(".mindmap-view__node");
                const preview = root.getBoundingClientRect();
                const previewPosition = [preview.left - bounds.left, preview.top - bounds.top];
                view.setReadOnly(true);
                check.equal(guide.hidden, false, "control refresh preserves the preview");
                check.equal(button("listMindmapDocumentLayout").getAttribute("aria-pressed"), "true");
                host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
                await settle();
                equalCenter(adjusted);
                check.equal(view.scale, adjustedScale);
                check.equal(host.parentElement, parent);
                check.equal(host.style.cssText, initialStyle);
                check.equal(guide.hidden, true);
                const restored = root.getBoundingClientRect();
                const documentBounds = viewport.getBoundingClientRect();
                check.ok(Math.abs(restored.left - documentBounds.left - previewPosition[0]) < 1 &&
                    Math.abs(restored.top - documentBounds.top - previewPosition[1]) < 1,
                "the document matches the frame preview after pan and zoom");
                check.equal(list.outerHTML, originalSource);
                view.setReadOnly(false);
            }
            const rapid = center();
            button("fullscreen").click();
            button("exitFullscreen").click();
            await settle();
            equalCenter(rapid);
            button("fullscreen").click();
            await settle();
            button("listMindmapDocumentLayout").click();
            viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: -100000, bubbles: true, cancelable: true}));
            const croppedCenter = center();
            button("exitFullscreen").click();
            await settle();
            equalCenter(croppedCenter);
            view.refreshLayout();
            await settle();
            equalCenter(croppedCenter);
            button("fullscreen").click();
            await settle();
            button("listMindmapDocumentLayout").click();
            view.setLocked(true);
            check.equal(guide.hidden, true, "locked maps hide the layout preview");
            check.equal(button("listMindmapDocumentLayout"), null);
            view.destroy();
            check.equal(host.parentElement, parent);
            check.equal(host.classList.contains("fullscreen"), false);
            check.equal(Array.from(parent.childNodes).some(node => node.nodeType === Node.COMMENT_NODE), false);
            parent.remove();
        }
    }
    return "Mindmap fullscreen cases passed";
};

test("fullscreen preserves the viewport and previews the document layout on desktop and touch screens", {
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
