import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string, contentCSS: string, themes: string[]) => {
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
    const originalWindow = {width: innerWidth, height: innerHeight};
    for (const mobile of [false, true]) {
        for (const dark of [false, true]) {
            document.body.className = mobile ? "body--android" : "body--windows";
            const parent = document.createElement("div");
            parent.style.cssText = `width:${mobile ? 320 : 760}px;transform:translateX(5px);overflow:hidden`;
            const host = document.createElement("div");
            host.style.cssText = `--mindmap-view-height:${mobile ? 300 : 460}px;` +
                `--b3-theme-background:${dark ? "#222" : "#fff"};` +
                `--b3-theme-primary:${dark ? "#8ab4f8" : "#3574f0"};--b3-border-color:#888;--b3-border-radius:8px`;
            parent.append(host);
            document.body.append(parent);
            const holder = document.createElement("div");
            holder.innerHTML = lute.Md2BlockDOM("- Root\n" +
                Array.from({length: 12}, (_, index) => `  - Node ${index}\n`).join(""));
            const list = holder.firstElementChild;
            const originalSource = list.outerHTML;
            let remembered: {scale: number, center: {x: number, y: number}};
            const remember = (state: typeof remembered) => {
                remembered = {scale: state.scale, center: {...state.center}};
            };
            const view = new api.ListMindmapView({host, model: api.readListMindmap(list),
                onViewportChange: remember, onExit: () => {}});
            await settle();
            const viewport = host.querySelector<HTMLElement>(".mindmap-view__viewport");
            const resizeWindow = async (width: number, height: number) => {
                await require("electron").ipcRenderer.invoke("mindmap-fullscreen-size", width, height);
                // 原生尺寸通知、ResizeObserver 和布局绘制分步完成；尺寸到达后还须等待导图同步。
                // 操作系统在高 DPI 下可能产生 1px 取整，取景框的位置断言仍使用原有精度。
                const ready = () => Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1 &&
                    view.viewportSize.width === viewport.clientWidth && view.viewportSize.height === viewport.clientHeight &&
                    !view.frame && !view.drawFrame;
                await settle();
                for (let count = 0; count < 120 && !ready(); count++) {
                    await frame();
                }
                check.ok(ready(), "mindmap did not finish resizing: " + JSON.stringify({
                    requested: {width, height}, window: {width: innerWidth, height: innerHeight},
                    viewport: {width: viewport.clientWidth, height: viewport.clientHeight},
                    layout: view.viewportSize, frame: view.frame, drawFrame: view.drawFrame,
                }));
            };
            const center = () => [(viewport.clientWidth / 2 - view.offsetX) / view.scale,
                (viewport.clientHeight / 2 - view.offsetY) / view.scale];
            const equalCenter = (expected: number[]) => center().forEach((value, index) =>
                check.ok(Math.abs(value - expected[index]) < 1e-8, "mode changes preserve the logical center"));
            const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
            const preview = host.querySelector<HTMLElement>(".mindmap-view__document-viewport");
            check.ok(preview.hidden);
            check.ok(button("listMindmapDocumentLayout").hidden, "the layout control is fullscreen-only");
            const initialStyle = host.style.cssText;
            const documentRadius = getComputedStyle(host).borderTopLeftRadius;
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

            // 只有主动开启文档布局，才将固定取景框内的视角应用到文档。
            const layoutCenter = center();
            const layoutScale = view.scale;
            const root = host.querySelector<HTMLElement>(".mindmap-view__node");
            const checkGrid = () => {
                const style = getComputedStyle(preview);
                check.equal(style.backgroundImage.match(/radial-gradient/g)?.length, 2,
                    "separate dot rows and columns form the grid lines");
                check.match(style.backgroundImage, /1px/);
                check.equal(style.backgroundSize, "12px 96px, 96px 12px");
                check.ok(style.backgroundPosition.split(", ").every(position => position === "50% 50%"),
                    "both dot layers share the center origin");
                check.ok(style.backgroundOrigin.split(", ").every(origin => origin === "padding-box"));
                check.equal(style.overflow, "hidden", "dots and guides stay inside the rounded frame");
                const vertical = getComputedStyle(preview, "::before");
                const horizontal = getComputedStyle(preview, "::after");
                check.equal(vertical.borderLeftStyle, "dashed");
                check.equal(horizontal.borderTopStyle, "dashed");
                check.equal(vertical.borderLeftColor, style.borderTopColor);
                check.equal(horizontal.borderTopColor, style.borderTopColor);
                const rect = preview.getBoundingClientRect();
                const width = rect.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
                const height = rect.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
                const x = parseFloat(vertical.left) + new DOMMatrixReadOnly(vertical.transform).m41 +
                    parseFloat(vertical.borderLeftWidth) / 2;
                const y = parseFloat(horizontal.top) + new DOMMatrixReadOnly(horizontal.transform).m42 +
                    parseFloat(horizontal.borderTopWidth) / 2;
                check.ok(Math.abs(x - width / 2) < .02, "the vertical stroke center meets the center grid dot");
                check.ok(Math.abs(y - height / 2) < .02, "the horizontal stroke center meets the center grid dot");
                for (const guide of [vertical, horizontal]) {
                    check.ok(Number(guide.opacity) > 0 && Number(guide.opacity) < 1);
                    check.equal(guide.pointerEvents, "none");
                }
            };
            const checkFrame = () => {
                const rect = preview.getBoundingClientRect();
                const viewportRect = viewport.getBoundingClientRect();
                check.ok(Math.abs(rect.width - view.documentView.width) < .1);
                check.ok(Math.abs(rect.height - view.documentView.height) < .1);
                check.ok(Math.abs(rect.left - viewportRect.left -
                    (viewport.clientWidth - rect.width) / 2) < .1);
                check.ok(Math.abs(rect.top - viewportRect.top -
                    Math.max(0, (viewport.clientHeight - rect.height) / 2)) < .1,
                "document frame vertical position: " + JSON.stringify({mobile, dark, dpr: devicePixelRatio,
                    top: rect.top, viewportTop: viewportRect.top, viewportHeight: viewport.clientHeight,
                    frameHeight: rect.height, transform: preview.style.transform, size: view.viewportSize}));
                const style = getComputedStyle(preview);
                const canvasStyle = getComputedStyle(host);
                check.equal(style.pointerEvents, "none", "the frame does not intercept gestures");
                check.equal(style.borderTopStyle, "solid");
                check.equal(style.borderTopColor, canvasStyle.outlineColor, "the frame follows the active canvas color");
                check.equal(style.borderTopWidth, canvasStyle.outlineWidth);
                check.equal(style.borderTopLeftRadius, documentRadius, "the frame keeps the document canvas radius");
                checkGrid();
                check.equal(button("listMindmapDocumentLayout").getAttribute("aria-pressed"), "true");
            };
            const captureLayout = () => {
                const rect = preview.getBoundingClientRect();
                const node = root.getBoundingClientRect();
                return {scale: view.scale, width: rect.width, height: rect.height,
                    x: node.left - rect.left, y: node.top - rect.top};
            };
            const checkApplied = (expected: ReturnType<typeof captureLayout>) => {
                const rect = viewport.getBoundingClientRect();
                const node = root.getBoundingClientRect();
                check.equal(view.scale, expected.scale);
                check.ok(Math.abs(node.left - rect.left - expected.x -
                    (viewport.clientWidth - expected.width) / 2) < .2,
                "the document shows the horizontal position framed in fullscreen");
                check.ok(Math.abs(node.top - rect.top - expected.y -
                    (viewport.clientHeight - expected.height) / 2) < .2,
                "the document shows the vertical position framed in fullscreen");
                check.ok(preview.hidden);
                check.ok(button("listMindmapDocumentLayout").hidden);
            };
            button("fullscreen").click();
            await settle();
            check.equal(button("listMindmapDocumentLayout").hidden, false);
            check.equal(button("listMindmapDocumentLayout").getAttribute("aria-pressed"), "false");
            button("listMindmapDocumentLayout").click();
            check.equal(preview.hidden, false);
            checkFrame();
            // 奇数和小数尺寸下，验证笔画中心与网格原点，而非只验证线条边缘的百分比位置。
            const frameStyle = preview.style.cssText;
            for (const [width, height] of [[320, 200], [321, 201], [320.5, 200.5], [321.25, 201.75]]) {
                preview.style.width = `${width}px`;
                preview.style.height = `${height}px`;
                checkGrid();
            }
            preview.style.cssText = frameStyle;
            checkFrame();
            // 栅格采样确认大格边上有中间刻度，格内留白，避免仅检查 CSS 字符串却绘成孤立交点。
            const gridSample = document.createElement("div");
            gridSample.style.cssText = "position:fixed;left:16px;top:16px;width:322px;height:202px;z-index:9999;" +
                `background:${getComputedStyle(host).backgroundColor}`;
            const gridClone = preview.cloneNode(false) as HTMLElement;
            gridClone.style.cssText = "left:0;top:0;width:321.25px;height:201.75px";
            gridSample.append(gridClone);
            document.body.append(gridSample);
            try {
                for (const dpr of [1, 2]) {
                    const rect = gridClone.getBoundingClientRect();
                    const x = rect.left + rect.width / 2;
                    const y = rect.top + rect.height / 2;
                    const dots = Array.from({length: 7}, (_, index) => index * 12 + 12).flatMap(offset => [
                        {x: x + offset, y: y - 96}, {x: x + 96, y: y - offset},
                    ]);
                    const gaps = [{x: x + 6, y: y - 96}, {x: x + 96, y: y - 6}, {x: x + 12, y: y - 84}];
                    const differences: number[] = await require("electron").ipcRenderer.invoke("mindmap-fullscreen-grid",
                        {width: innerWidth, height: innerHeight, dpr, background: {x: x + 6, y: y + 6},
                            points: [...dots, ...gaps]});
                    check.ok(differences.slice(0, dots.length).every(value => value > 10),
                        `every intermediate grid dot is visible, dpr=${dpr}, dark=${dark}: ${differences}`);
                    check.ok(differences.slice(dots.length).every(value => value < 2),
                        `dot gaps and grid interiors stay clear, dpr=${dpr}, dark=${dark}: ${differences}`);
                }
            } finally {
                await require("electron").ipcRenderer.invoke("mindmap-fullscreen-grid-reset");
                gridSample.remove();
                await settle();
            }
            checkFrame();
            const savedLayout = JSON.stringify(view.documentView);
            const fixedFrame = preview.getBoundingClientRect().toJSON();
            view.zoomAt(1.9);
            viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: 90, deltaY: 40, bubbles: true, cancelable: true}));
            await settle();
            checkFrame();
            check.deepEqual(preview.getBoundingClientRect().toJSON(), fixedFrame,
                "panning and zooming move the map beneath a fixed, unscaled frame");
            view.setReadOnly(true);
            checkFrame();
            view.setReadOnly(false);
            check.equal(JSON.stringify(view.documentView), savedLayout,
                "layout edits keep the original snapshot available for cancellation");
            button("listMindmapDocumentLayout").click();
            check.ok(preview.hidden);
            check.equal(button("listMindmapDocumentLayout").getAttribute("aria-pressed"), "false");
            button("exitFullscreen").click();
            await settle();
            equalCenter(layoutCenter);
            check.equal(view.scale, layoutScale, "closing the layout toggle cancels its pending view change");
            check.equal(list.outerHTML, originalSource);

            // 开启后无需继续移动，也能主动采用开启时的全屏取景。
            button("fullscreen").click();
            await settle();
            check.ok(preview.hidden, "each fullscreen session starts with layout editing off");
            view.zoomAt(1.7);
            viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: 24, deltaY: 16, bubbles: true, cancelable: true}));
            await settle();
            const positionBeforeEnable = root.getBoundingClientRect().toJSON();
            button("listMindmapDocumentLayout").click();
            check.deepEqual(root.getBoundingClientRect().toJSON(), positionBeforeEnable,
                "enabling layout editing does not jump the canvas");
            const immediateLayout = captureLayout();
            host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
            await settle();
            checkApplied(immediateLayout);
            const appliedCenter = center();
            button("fullscreen").click();
            await settle();
            view.zoomAt(.8);
            button("exitFullscreen").click();
            await settle();
            equalCenter(appliedCenter);
            check.equal(view.scale, immediateLayout.scale, "ordinary fullscreen restores the most recently applied view");

            // 实际桌面缩放与双指手势修改框内取景，内容更新和打印不丢失布局状态。
            button("fullscreen").click();
            await settle();
            button("listMindmapDocumentLayout").click();
            if (mobile) {
                const full = viewport.getBoundingClientRect();
                const touches = (distance: number) => [0, 1].map(index => new Touch({identifier: index,
                    target: viewport, clientX: full.left + full.width / 2 + (index ? distance : -distance),
                    clientY: full.top + full.height / 2}));
                viewport.dispatchEvent(new TouchEvent("touchstart", {touches: touches(50), cancelable: true}));
                viewport.dispatchEvent(new TouchEvent("touchmove", {touches: touches(60), cancelable: true}));
                viewport.dispatchEvent(new TouchEvent("touchend", {touches: [], cancelable: true}));
            } else {
                const slider = host.querySelector<HTMLInputElement>(".mindmap-view__zoom-actions input");
                slider.value = "180";
                slider.dispatchEvent(new Event("input", {bubbles: true}));
            }
            viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: -50, deltaY: 30, bubbles: true, cancelable: true}));
            const layoutContent = view.model.root.contentBlocks[0].querySelector('[contenteditable="true"]');
            layoutContent.textContent = "Edited in document layout";
            view.update(api.readListMindmap(list));
            await settle();
            checkFrame();
            const beforePrint = [view.scale, view.offsetX, view.offsetY];
            const rememberedBeforePrint = JSON.stringify(remembered);
            window.dispatchEvent(new Event("beforeprint"));
            await require("electron").ipcRenderer.invoke("mindmap-fullscreen-media", "print");
            check.equal(getComputedStyle(preview).display, "none", "layout guides are excluded from printing");
            const printBounds = viewport.getBoundingClientRect();
            for (const node of host.querySelectorAll<HTMLElement>(".mindmap-view__node:not([hidden])")) {
                const bounds = node.getBoundingClientRect();
                check.ok(bounds.width > 0 && bounds.height > 0, "printed nodes retain their dimensions");
                check.ok(bounds.left >= printBounds.left - 1 && bounds.right <= printBounds.right + 1 &&
                    bounds.top >= printBounds.top - 1 && bounds.bottom <= printBounds.bottom + 1,
                    "print fitting retains every node inside the printable viewport");
            }
            check.equal(JSON.stringify(remembered), rememberedBeforePrint, "print fitting does not overwrite the saved view");
            await require("electron").ipcRenderer.invoke("mindmap-fullscreen-media", "");
            window.dispatchEvent(new Event("afterprint"));
            await settle();
            check.deepEqual([view.scale, view.offsetX, view.offsetY], beforePrint);
            checkFrame();
            const editedLayout = captureLayout();
            button("exitFullscreen").click();
            await settle();
            checkApplied(editedLayout);
            check.equal(remembered.scale, view.scale, "explicit fullscreen layout saves the applied document zoom");
            check.deepEqual([remembered.center.x, remembered.center.y], center());
            check.equal(view.getContentHost(view.model.root.id).textContent, "Edited in document layout");

            // 画布锁定会取消未应用的布局，不能借助模式切换改写锁定视角。
            const beforeLockLayout = center();
            const beforeLockLayoutScale = view.scale;
            button("fullscreen").click();
            await settle();
            button("listMindmapDocumentLayout").click();
            view.zoomAt(.7);
            view.setLocked(true);
            check.ok(preview.hidden);
            check.ok(button("listMindmapDocumentLayout").hidden);
            button("exitFullscreen").click();
            await settle();
            equalCenter(beforeLockLayout);
            check.equal(view.scale, beforeLockLayoutScale);
            view.setLocked(false);

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
            }
            button("exitFullscreen").click();
            await settle();
            equalCenter(beforeHeightChanges);
            check.equal(view.scale, savedScale);

            // 布局模式下跨越高矮视口边界，框固定尺寸并实时切换中心或顶部对齐。
            button("fullscreen").click();
            await settle();
            button("listMindmapDocumentLayout").click();
            view.zoomAt(1.3);
            for (const height of [520, 480, 479, 320, 479, 480, 700]) {
                await resizeWindow(900, height);
                checkFrame();
            }
            const afterHeightLayout = captureLayout();
            button("exitFullscreen").click();
            await settle();
            checkApplied(afterHeightLayout);

            // 全屏窗口宽度改变后，应用取景中心并适应返回文档的实际宽度。
            button("fullscreen").click();
            await settle();
            button("listMindmapDocumentLayout").click();
            await resizeWindow(780, 700);
            checkFrame();
            const afterWidthLayout = captureLayout();
            button("exitFullscreen").click();
            await settle();
            checkApplied(afterWidthLayout);
            await resizeWindow(900, 700);

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
            check.equal(remembered.scale, beforeLockScale);
            check.deepEqual([remembered.center.x, remembered.center.y], beforeLock);
            button("fullscreen").click();
            await settle();
            view.destroy();
            check.equal(host.parentElement, parent);
            check.equal(host.classList.contains("fullscreen"), false);
            check.equal(Array.from(parent.childNodes).some(node => node.nodeType === Node.COMMENT_NODE), false);
            const initializing = new api.ListMindmapView({host, model: api.readListMindmap(list),
                viewport: remembered, onViewportChange: remember, onExit: () => {}});
            button("fullscreen").click();
            button("exitFullscreen").click();
            await settle();
            check.equal(initializing.initialFit, false, "an early round trip still completes the initial document layout");
            check.equal(host.parentElement, parent);
            check.ok(Number.isFinite(initializing.offsetX) && Number.isFinite(initializing.offsetY));
            check.equal(initializing.scale, beforeLockScale, "reopening restores zoom instead of fitting");
            const reopenedViewport = host.querySelector<HTMLElement>(".mindmap-view__viewport");
            const reopenedCenter = [(reopenedViewport.clientWidth / 2 - initializing.offsetX) / initializing.scale,
                (reopenedViewport.clientHeight / 2 - initializing.offsetY) / initializing.scale];
            reopenedCenter.forEach((value, index) => check.ok(Math.abs(value - beforeLock[index]) < 1e-8,
                "reopening restores the document center"));
            initializing.destroy();
            parent.remove();
        }
    }
    // 使用完整排版、内置主题及代码高亮样式，检查移出编辑器祖先后的实际配色。
    style.textContent = contentCSS;
    const themeStyle = document.createElement("style");
    document.head.append(themeStyle);
    for (const mobile of [false, true]) {
        document.body.className = mobile ? "body--android" : "body--windows";
        for (const theme of themes) {
            themeStyle.textContent = theme;
            const parent = document.createElement("div");
            parent.className = "protyle-wysiwyg";
            const host = document.createElement("div");
            parent.append(host);
            document.body.append(parent);
            const holder = document.createElement("div");
            holder.innerHTML = lute.Md2BlockDOM("- Root\n  - Child\n");
            const list = holder.firstElementChild;
            const rich = document.createElement("div");
            rich.innerHTML = lute.Md2BlockDOM("`inline`\n\n```js\ncode\n```\n\n> Quote\n\n| Header |\n| --- |\n| Cell |\n");
            rich.querySelector("[contenteditable]").insertAdjacentHTML("beforeend",
                '<span data-type="mark">Mark</span><span data-type="search-mark">Search</span>' +
                '<span data-type="kbd">Ctrl</span>' +
                '<span data-type="text" style="background-color:var(--b3-font-background1)">Color</span>');
            const callout = rich.querySelector(".bq").cloneNode(true) as HTMLElement;
            callout.className = "callout";
            callout.dataset.type = "NodeCallout";
            callout.dataset.nodeId = Lute.NewNodeID();
            rich.append(callout);
            list.firstElementChild.append(...rich.children);
            const originalSource = list.outerHTML;
            const view = new api.ListMindmapView({host, model: api.readListMindmap(list), onExit: () => {}});
            await settle();
            const backgrounds = () => Array.from(host.querySelectorAll<HTMLElement>(
                '.mindmap-view__content .code-block, .mindmap-view__content [data-type~="code"], ' +
                '.mindmap-view__content [data-type~="mark"], .mindmap-view__content [data-type~="search-mark"], ' +
                '.mindmap-view__content [data-type~="kbd"], .mindmap-view__content [data-type="text"], ' +
                ".mindmap-view__content .bq, .mindmap-view__content .callout, " +
                ".mindmap-view__content th, .mindmap-view__content td"),
            element => ({type: element.dataset.type || element.className || element.tagName,
                background: getComputedStyle(element).backgroundColor}));
            const documentBackgrounds = backgrounds();
            check.equal(documentBackgrounds.length, 10, "all rich content background fixtures are rendered");
            for (let round = 0; round < 2; round++) {
                host.querySelector<HTMLButtonElement>('[aria-label="fullscreen"]').click();
                await settle();
                check.deepEqual(backgrounds(), documentBackgrounds, "fullscreen retains every rich content background");
                host.querySelector<HTMLButtonElement>('[aria-label="exitFullscreen"]').click();
                await settle();
                check.deepEqual(backgrounds(), documentBackgrounds, "returning to the document retains backgrounds");
            }
            check.equal(list.outerHTML, originalSource, "fullscreen styling never rewrites source blocks");
            view.destroy();
            parent.remove();
        }
    }
    return "Mindmap fullscreen cases passed";
};

test("fullscreen restores entry focus or applies explicit document layout across resizing, clipping and content updates", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = ["../av/richTextValue.ts", "summary.ts", "connectors.ts", "appearance.ts", "model.ts", "fold.ts", "routing.ts", "pan.ts", "view.ts"]
        .map(file => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText).join("\n");
    const css = ["business/_block.scss", "protyle/_mindmap-view.scss"].map(file => require("sass").compile(
        path.resolve(__dirname, "../../../assets/scss", file), {logger: require("sass").Logger.silent}).css).join("\n");
    const contentCSS = require("sass").compile(path.resolve(__dirname, "../../../assets/scss/base.scss"),
        {logger: require("sass").Logger.silent}).css;
    const themes = ["daylight", "midnight"].map((name, index) => readFileSync(
        path.resolve(__dirname, "../../../../appearance/themes", name, "theme.css"), "utf8") + "\n" + readFileSync(
        path.resolve(__dirname, "../../../../stage/protyle/js/highlight.js/styles", index ? "github-dark.min.css" : "github.min.css"), "utf8"));
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
    require("electron").ipcMain.handle("mindmap-fullscreen-grid", async (_event, options) => {
        if (!win.webContents.debugger.isAttached()) {
            win.webContents.debugger.attach("1.3");
        }
        await win.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
            width: options.width, height: options.height, deviceScaleFactor: options.dpr, mobile: false,
        });
        await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        const {data} = await win.webContents.debugger.sendCommand("Page.captureScreenshot", {format: "png"});
        const image = require("electron").nativeImage.createFromBuffer(Buffer.from(data, "base64"));
        const size = image.getSize();
        if (Math.abs(size.width - options.width * options.dpr) > 1) {
            throw new Error("Grid raster did not use the requested pixel density");
        }
        const bitmap = image.toBitmap();
        const pixel = (x, y) => {
            const offset = (y * size.width + x) * 4;
            return [bitmap[offset], bitmap[offset + 1], bitmap[offset + 2]];
        };
        const background = pixel(Math.floor(options.background.x * options.dpr), Math.floor(options.background.y * options.dpr));
        const radius = Math.ceil(1.5 * options.dpr);
        return options.points.map(point => {
            let difference = 0;
            const centerX = Math.floor(point.x * options.dpr);
            const centerY = Math.floor(point.y * options.dpr);
            for (let y = centerY - radius; y <= centerY + radius; y++) {
                for (let x = centerX - radius; x <= centerX + radius; x++) {
                    pixel(x, y).forEach((value, channel) => {
                        difference = Math.max(difference, Math.abs(value - background[channel]));
                    });
                }
            }
            return difference;
        });
    });
    require("electron").ipcMain.handle("mindmap-fullscreen-grid-reset", () =>
        win.webContents.debugger.sendCommand("Emulation.clearDeviceMetricsOverride"));
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lute)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserSource})(${JSON.stringify(source)}, ${JSON.stringify(css)}, ${JSON.stringify(contentCSS)}, ${JSON.stringify(themes)})`)}));
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
            env, timeout: 40000, windowsHide: true,
        });
        assert.match(result.stdout, /Mindmap fullscreen cases passed/);
    } finally {
        // Electron 子进程退出后文件句柄可能尚未释放，Windows 上需要重试删除。
        rmSync(temporary, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }
});
