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
        for (const scale of [1, .75]) {
            document.body.className = mobile ? "body--android" : "body--windows";
            const outer = document.createElement("div");
            outer.style.cssText = `position:absolute;top:40px;left:30px;width:${mobile ? 320 : 700}px;` +
                `height:480px;overflow:auto;transform:scale(${scale});transform-origin:top left`;
            const spacer = document.createElement("div");
            const host = document.createElement("div");
            const tail = document.createElement("div");
            tail.style.height = "600px";
            host.style.cssText = "--mindmap-view-height:300px;--b3-border-color:#888";
            outer.append(spacer, host, tail);
            document.body.append(outer);
            const holder = document.createElement("div");
            holder.innerHTML = lute.Md2BlockDOM("- Root\n  - Node A\n  - Node B\n");
            const model = api.readListMindmap(holder.firstElementChild);
            const original = holder.innerHTML;
            const view = new api.ListMindmapView({host, model, onExit: () => {},
                colors: () => Array.from({length: 13}, (_, i) => ({label: `Color ${i}`, value: `rgb(${i}, 0, 0)`})),
                onManageLineColors: () => {},
                onNodeWidths: async () => true});
            const inspector = host.querySelector<HTMLElement>(".mindmap-view__inspector");
            const panel = host.querySelector<HTMLElement>(".mindmap-view__inspector-popover");
            const viewport = host.querySelector<HTMLElement>(".mindmap-view__viewport");
            const node = () => host.querySelector<HTMLElement>(`[data-mindmap-id="${model.root.children[0].id}"]`);
            const select = () => view.selectNode(model.root.children[0].id);
            const click = () => node().dispatchEvent(new MouseEvent("click", {bubbles: true}));
            let stage = "initial";
            const visible = (element: HTMLElement) => {
                const rect = element.getBoundingClientRect();
                const clip = outer.getBoundingClientRect();
                check.equal(element.hidden, false, `${stage}: ${element.className} stays open`);
                check.equal(getComputedStyle(element).visibility, "visible");
                check.ok(rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1,
                    `vertical bounds ${rect.top}..${rect.bottom} within ${clip.top}..${clip.bottom}`);
                check.ok(rect.left >= clip.left - 1 && rect.right <= clip.right + 1);
                check.ok(element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
                    `${stage}: ${element.className} remains above the canvas and receives pointer input`);
            };
            const checkPalette = async (columns: number) => {
                const palette = inspector.querySelector<HTMLElement>(".mindmap-view__palette");
                const row = palette.parentElement;
                check.equal(row.style.getPropertyValue("--mindmap-palette-columns"), String(columns));
                check.ok(palette.querySelector('[aria-pressed="true"] .color__square-mark'));
                const controls = Array.from(row.children).slice(1);
                const positions = controls.map(control => control.getBoundingClientRect().left);
                palette.scrollLeft = 73;
                await settle();
                const step = parseFloat(getComputedStyle(palette).gridTemplateColumns);
                check.ok(palette.scrollLeft > 0);
                check.ok(Math.abs(palette.scrollLeft - Math.round(palette.scrollLeft / step) * step) < 1,
                    `${stage}: ${columns} color columns snap into alignment at scale ${scale}`);
                check.deepEqual(controls.map(control => control.getBoundingClientRect().left), positions,
                    "scroll snapping keeps action and settings controls fixed");
            };
            await settle();
            select();
            await settle();
            visible(inspector);
            check.equal(outer.scrollTop, 0, "a fully visible map preserves document position");

            spacer.style.height = "430px";
            stage = "short";
            await settle();
            // 文档布局变化后，以真实滚动事件触发同一定位入口。
            outer.dispatchEvent(new Event("scroll"));
            await settle();
            check.equal(getComputedStyle(inspector).visibility, "hidden", "a narrow strip cannot contain the toolbar");
            node().dispatchEvent(new PointerEvent("pointerover", {bubbles: true, pointerType: "mouse"}));
            await settle();
            check.equal(outer.scrollTop, 0, "hover never scrolls the document");
            click();
            await settle();
            visible(inspector);
            check.ok(outer.scrollTop > 0, "an explicit click reveals a short map");
            check.ok(host.getBoundingClientRect().bottom <= outer.getBoundingClientRect().bottom + 1);
            const afterClick = outer.scrollTop;
            click();
            await settle();
            check.equal(outer.scrollTop, afterClick, "repeated selection does not jump");

            outer.scrollTop = 600;
            await settle();
            click();
            await settle();
            check.ok(host.getBoundingClientRect().top >= outer.getBoundingClientRect().top - 1,
                "a short map clipped at the top is also revealed");
            visible(inspector);

            outer.scrollTop = 0;
            view.suppressLinkClick = true;
            click();
            await settle();
            check.equal(outer.scrollTop, 0, "the click following a drag does not reveal the map");
            view.suppressLinkClick = false;
            view.pinching = true;
            click();
            await settle();
            check.equal(outer.scrollTop, 0, "pinches do not scroll the document");
            view.pinching = false;
            view.focusNode(model.root.children[0].id);
            await settle();
            visible(inspector);
            check.ok(outer.scrollTop > 0, "keyboard node focus also reveals the short map");

            spacer.style.height = "0";
            stage = "tall";
            host.style.setProperty("--mindmap-view-height", "1100px");
            outer.scrollTop = 120;
            await settle();
            click();
            await settle();
            check.equal(outer.scrollTop, 120, "a tall map retains its reading position");
            visible(inspector);
            check.ok(Math.abs(inspector.getBoundingClientRect().bottom -
                (outer.getBoundingClientRect().bottom - 8 * scale)) < 1);
            for (const kind of ["color", "width"]) {
                view.openInspectorPanel(kind, inspector.querySelector<HTMLButtonElement>(`[aria-label="${kind}"]`));
                await settle();
                visible(panel);
                outer.scrollTop += 90;
                await settle();
                visible(inspector);
                visible(panel);
                check.ok(panel.getBoundingClientRect().bottom <= inspector.getBoundingClientRect().top);
                view.closeInspectorPanel();
            }

            // 连线和概要共用同一操作栏，内容重绘也必须保留可见边界。
            view.selectedId = undefined;
            stage = "line";
            view.selectedEdge = model.root.children[0].id;
            view.renderInspector();
            await settle();
            visible(inspector);
            await checkPalette(7);
            view.selectedEdge = undefined;
            view.model.metadata.relations.push({id: "relation", from: model.root.children[0].id,
                to: model.root.children[1].id, label: "Relation"});
            view.selectedRelation = "relation";
            view.renderInspector();
            stage = "relation";
            await settle();
            visible(inspector);
            await checkPalette(5);
            view.selectedRelation = undefined;
            view.model.metadata.relations = [];
            view.model.metadata.summaries = [{id: "summary", label: "Summary", parentId: model.root.id,
                nodeIds: model.root.children.map((node: {id: string}) => node.id)}];
            view.selectSummary("summary");
            stage = "summary";
            await settle();
            visible(inspector);
            check.equal(inspector.querySelector('[aria-label="edit"]'), null);
            await checkPalette(6);
            delete view.model.metadata.summaries;
            select();

            outer.style.height = "220px";
            stage = "resize";
            await settle();
            visible(inspector);
            view.openInspectorPanel("width", inspector.querySelector<HTMLButtonElement>('[aria-label="width"]'));
            await settle();
            visible(panel);
            outer.scrollTop = 1080;
            await settle();
            check.equal(getComputedStyle(inspector).visibility, "hidden");
            check.equal(getComputedStyle(panel).visibility, "hidden");
            outer.scrollTop = 300;
            stage = "restore";
            await settle();
            visible(inspector);
            visible(panel);

            const clipping = document.createElement("div");
            clipping.style.cssText = "position:absolute;inset:0;overflow:hidden;width:260px;height:200px";
            document.body.append(clipping);
            clipping.append(outer);
            outer.dispatchEvent(new Event("scroll"));
            await settle();
            for (const control of [inspector, panel]) {
                const rect = control.getBoundingClientRect();
                const clip = clipping.getBoundingClientRect();
                check.ok(rect.left >= clip.left && rect.right <= clip.right,
                    `${control.className}: horizontal bounds ${rect.left}..${rect.right} within ${clip.left}..${clip.right}; ` +
                    `scale ${scale}; ${control.style.cssText}; host ${JSON.stringify(host.getBoundingClientRect().toJSON())}`);
                check.ok(rect.top >= clip.top && rect.bottom <= clip.bottom,
                    "nested clipping constrains both controls vertically");
            }
            document.body.append(outer);
            clipping.remove();
            outer.dispatchEvent(new Event("scroll"));
            await settle();

            const scrollBeforeFullscreen = outer.scrollTop;
            view.enterFullscreen();
            await settle();
            select();
            await settle();
            const full = inspector.getBoundingClientRect();
            check.ok(full.top >= 0 && full.bottom <= innerHeight);
            view.exitFullscreen();
            stage = "exit fullscreen";
            await settle();
            check.equal(outer.scrollTop, scrollBeforeFullscreen);
            select();
            await settle();
            visible(inspector);
            check.equal(holder.innerHTML, original, "overlay placement never modifies document data");
            view.queueInspectorLayout(true);
            view.destroy();
            await settle();
            check.equal(host.childElementCount, 0);
            outer.remove();
            check.equal(viewport.isConnected, false);
        }
    }
    return "Mindmap inspector cases passed";
};

test("mindmap inspectors follow clipped viewports and reveal short maps only after selection", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = ["../av/richTextValue.ts", "summary.ts", "connectors.ts", "appearance.ts", "model.ts", "fold.ts", "routing.ts", "pan.ts", "view.ts"]
        .map(file => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText).join("\n");
    const css = ["business/_block.scss", "business/_color.scss", "protyle/_mindmap-view.scss"]
        .map(file => require("sass").compile(path.resolve(__dirname, "../../../assets/scss", file),
            {logger: require("sass").Logger.silent}).css).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-inspector-"));
    const script = path.join(temporary, "run.cjs");
    const lute = path.resolve(__dirname, "../../../../stage/protyle/js/lute/lute.min.js");
    const browserSource = transpileModule(`(${browserCases.toString()})`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/, "");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 1000, height: 800,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
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
            env, timeout: 40000, windowsHide: true,
        });
        assert.match(result.stdout, /Mindmap inspector cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        rmSync(temporary, {recursive: true, force: true});
    }
});
