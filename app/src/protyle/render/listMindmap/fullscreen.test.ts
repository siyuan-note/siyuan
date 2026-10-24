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
    const resizeWindow = async (width: number, height: number) => {
        await require("electron").ipcRenderer.invoke("mindmap-fullscreen-size", width, height);
        // 原生窗口调用返回时，渲染进程可能尚未收到新的视口尺寸。
        for (let count = 0; count < 120 && (innerWidth !== width || innerHeight !== height); count++) {
            await frame();
        }
        check.deepEqual([innerWidth, innerHeight], [width, height]);
        await settle();
    };
    const originalWindow = {width: innerWidth, height: innerHeight};
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
            const preview = host.querySelector<HTMLElement>(".mindmap-view__document-viewport");
            check.ok(preview.hidden);
            check.ok(button("listMindmapDocumentViewport").hidden, "the preview control is fullscreen-only");
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

            // 指示框标记原文档范围，平移缩放时跟随内容，不将预览变成布局编辑。
            const previewCenter = center();
            const previewScale = view.scale;
            const root = host.querySelector<HTMLElement>(".mindmap-view__node");
            const documentRect = viewport.getBoundingClientRect();
            const nodeRect = root.getBoundingClientRect();
            const relativeNode = [(nodeRect.left - documentRect.left) / viewport.clientWidth,
                (nodeRect.top - documentRect.top) / viewport.clientHeight];
            const sourceSize = [viewport.clientWidth, viewport.clientHeight];
            const checkPreview = () => {
                const rect = preview.getBoundingClientRect();
                const node = root.getBoundingClientRect();
                check.ok(Math.abs(rect.width - sourceSize[0] * view.scale / previewScale) < .1);
                check.ok(Math.abs(rect.height - sourceSize[1] * view.scale / previewScale) < .1);
                [(node.left - rect.left) / rect.width, (node.top - rect.top) / rect.height]
                    .forEach((value, index) => check.ok(Math.abs(value - relativeNode[index]) < .001,
                        "the same document content remains at the same relative position within the preview"));
                check.equal(getComputedStyle(preview).pointerEvents, "none", "the frame does not intercept gestures");
                check.equal(getComputedStyle(preview).borderTopStyle, "dashed");
                check.equal(button("listMindmapDocumentViewport").getAttribute("aria-pressed"), "true");
            };
            button("fullscreen").click();
            await settle();
            check.equal(button("listMindmapDocumentViewport").hidden, false);
            check.equal(button("listMindmapDocumentViewport").getAttribute("aria-pressed"), "false");
            button("listMindmapDocumentViewport").click();
            check.equal(preview.hidden, false);
            checkPreview();
            await require("electron").ipcRenderer.invoke("mindmap-fullscreen-media", "print");
            check.equal(getComputedStyle(preview).display, "none", "viewport guides are excluded from printing");
            await require("electron").ipcRenderer.invoke("mindmap-fullscreen-media", "");
            checkPreview();
            const savedPreview = JSON.stringify(view.documentView);
            view.zoomAt(1.9);
            viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: 90, deltaY: 40, bubbles: true, cancelable: true}));
            await settle();
            checkPreview();
            button("listMindmapDocumentViewport").click();
            check.ok(preview.hidden);
            check.equal(button("listMindmapDocumentViewport").getAttribute("aria-pressed"), "false");
            button("listMindmapDocumentViewport").click();
            view.setReadOnly(true);
            checkPreview();
            view.setLocked(true);
            checkPreview();
            view.setLocked(false);
            view.setReadOnly(false);
            check.equal(JSON.stringify(view.documentView), savedPreview, "preview operations never replace the saved view");
            button("exitFullscreen").click();
            await settle();
            equalCenter(previewCenter);
            check.equal(view.scale, previewScale);
            check.ok(preview.hidden);
            check.ok(button("listMindmapDocumentViewport").hidden);
            button("fullscreen").click();
            await settle();
            check.ok(preview.hidden, "each fullscreen session starts without the optional frame");
            button("exitFullscreen").click();
            await settle();

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

            const originalParentStyle = parent.style.cssText;
            const originalHeight = host.style.getPropertyValue("--mindmap-view-height");
            const beforeDocumentResize = center();
            parent.style.width = `${mobile ? 400 : 620}px`;
            host.style.setProperty("--mindmap-view-height", `${mobile ? 340 : 500}px`);
            await settle();
            equalCenter(beforeDocumentResize);
            parent.style.cssText = originalParentStyle;
            host.style.setProperty("--mindmap-view-height", originalHeight);
            await settle();
            equalCenter(beforeDocumentResize);

            // 原生窗口宽度变化保留全屏取景，退出仍恢复独立保存的文档视角。
            parent.style.width = "calc(100vw - 80px)";
            await settle();
            const documentBeforeWindowResize = center();
            button("fullscreen").click();
            await settle();
            viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: 24, deltaY: 16, bubbles: true, cancelable: true}));
            const fullBeforeWindowResize = center();
            await resizeWindow(originalWindow.width - 120, originalWindow.height);
            equalCenter(fullBeforeWindowResize);
            button("exitFullscreen").click();
            await settle();
            equalCenter(documentBeforeWindowResize);
            await resizeWindow(originalWindow.width, originalWindow.height);
            equalCenter(documentBeforeWindowResize);

            // 在临界高度两侧往返，中心与顶部锚点连续衔接，全屏的缩放和平移不回写文档。
            await resizeWindow(900, 700);
            host.style.setProperty("--mindmap-view-height", "480px");
            await settle();
            const beforeHeightChanges = center();
            const savedScale = view.scale;
            const documentHeight = viewport.clientHeight;
            button("fullscreen").click();
            await settle();
            equalCenter(beforeHeightChanges);
            view.zoomAt(1.6);
            viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: 20, deltaY: 10, bubbles: true, cancelable: true}));
            const reference = () => [(viewport.clientWidth / 2 - view.offsetX) / view.scale,
                (Math.max(viewport.clientHeight, documentHeight) / 2 - view.offsetY) / view.scale];
            const fullReference = reference();
            button("listMindmapDocumentViewport").click();
            const savedWidth = view.documentView.width;
            for (const height of [520, 480, 479, 320, 479, 480, 520, 700]) {
                const oldHeight = viewport.clientHeight;
                const oldOffset = view.offsetY;
                await resizeWindow(900, height);
                reference().forEach((value, index) => check.ok(Math.abs(value - fullReference[index]) < 1e-8,
                    "live height changes preserve the fullscreen reference without resetting its pan or zoom: " +
                    JSON.stringify({height, index, value, expected: fullReference[index],
                        size: view.viewportSize, actual: [viewport.clientWidth, viewport.clientHeight],
                        scale: view.scale, offset: [view.offsetX, view.offsetY]})));
                if (oldHeight <= documentHeight && viewport.clientHeight <= documentHeight) {
                    check.equal(view.offsetY, oldOffset, "short fullscreen viewports retain their top reference");
                }
                check.equal(view.scale, 1.6);
                check.equal(view.documentView.scale, savedScale);
                check.deepEqual([view.documentView.center.x, view.documentView.center.y], beforeHeightChanges);
                check.ok(Math.abs(preview.getBoundingClientRect().width - savedWidth * 1.6 / savedScale) < .1);
                check.ok(Math.abs(preview.getBoundingClientRect().height - documentHeight * 1.6 / savedScale) < .1,
                    "height anchor changes do not stretch or rebase the document frame");
            }
            button("exitFullscreen").click();
            await settle();
            equalCenter(beforeHeightChanges);
            check.equal(view.scale, savedScale);

            // 滚动容器只露出高画布的一部分时，把正在看的节点保留在全屏顶部内。
            await resizeWindow(900, 600);
            host.style.setProperty("--mindmap-view-height", "1100px");
            await settle();
            {
                const id = view.model.root.children[0].id;
                const node = host.querySelector<HTMLElement>(`[data-mindmap-id="${id}"]`);
                view.offsetY = 24 - view.positions.get(id).y * view.scale;
                view.draw();
                const tallCenter = center();
                const top = node.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
                button("fullscreen").click();
                await settle();
                check.ok(Math.abs(node.getBoundingClientRect().top - top) < 1,
                    "a tall canvas keeps its visible top content when entering a shorter fullscreen viewport");
                button("exitFullscreen").click();
                await settle();
                equalCenter(tallCenter);
            }
            parent.style.height = "260px";
            parent.style.overflow = "auto";
            const following = document.createElement("div");
            following.style.height = "1800px";
            parent.append(following);
            await settle();
            parent.scrollTop = 180;
            const firstId = view.model.root.children[0].id;
            const first = host.querySelector<HTMLElement>(`[data-mindmap-id="${firstId}"]`);
            const visibleTop = parent.getBoundingClientRect().top + parent.clientTop;
            const clippedTop = visibleTop - viewport.getBoundingClientRect().top;
            view.offsetY = clippedTop + 24 - view.positions.get(firstId).y * view.scale;
            view.draw();
            const scrolledCenter = center();
            const scrolledScale = view.scale;
            const nodeBeforeFullscreen = first.getBoundingClientRect();
            check.ok(nodeBeforeFullscreen.top >= visibleTop && nodeBeforeFullscreen.bottom <= visibleTop + parent.clientHeight);
            button("fullscreen").click();
            await settle();
            const fullNode = first.getBoundingClientRect();
            check.ok(fullNode.top >= viewport.getBoundingClientRect().top && fullNode.bottom <= viewport.getBoundingClientRect().bottom,
                "a node visible in a clipped tall document remains visible after entering fullscreen");
            check.ok(Math.abs(fullNode.top - (nodeBeforeFullscreen.top - visibleTop)) < 1,
                "tall fullscreen entry aligns the visible document top rather than its hidden center");
            view.zoomAt(1.8);
            button("exitFullscreen").click();
            await settle();
            equalCenter(scrolledCenter);
            check.equal(view.scale, scrolledScale);
            check.ok(Math.abs(first.getBoundingClientRect().top - nodeBeforeFullscreen.top) < 1,
                JSON.stringify({scrollTop: parent.scrollTop, before: nodeBeforeFullscreen.top,
                    after: first.getBoundingClientRect().top, viewportTop: viewport.getBoundingClientRect().top}));
            following.remove();
            parent.style.cssText = originalParentStyle;
            host.style.setProperty("--mindmap-view-height", originalHeight);
            await resizeWindow(originalWindow.width, originalWindow.height);

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

test("fullscreen preserves entry focus across viewport resizing and clipping without reverting content updates", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = ["../av/richTextValue.ts", "summary.ts", "connectors.ts", "appearance.ts", "model.ts", "fold.ts", "routing.ts", "pan.ts", "view.ts"]
        .map(file => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText).join("\n");
    const css = ["business/_block.scss", "protyle/_mindmap-view.scss"].map(file => require("sass").compile(
        path.resolve(__dirname, "../../../assets/scss", file), {logger: require("sass").Logger.silent}).css).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-fullscreen-"));
    const script = path.join(temporary, "run.cjs");
    const lute = path.resolve(__dirname, "../../../../stage/protyle/js/lute/lute.min.js");
    const browserSource = transpileModule(`(${browserCases.toString()})`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/, "");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    require("electron").ipcMain.handle("mindmap-fullscreen-size", (_event, width, height) => win.setContentSize(width, height));
    require("electron").ipcMain.handle("mindmap-fullscreen-media", async (_event, media) => {
        if (!win.webContents.debugger.isAttached()) {
            win.webContents.debugger.attach("1.3");
        }
        await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {media});
    });
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lute)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserSource})(${JSON.stringify(source)}, ${JSON.stringify(css)})`)}));
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
