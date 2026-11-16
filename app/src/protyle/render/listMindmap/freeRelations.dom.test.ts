import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string, themes: string[]) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const theme = document.createElement("style");
    document.head.append(theme);
    const api = new Function("Constants", "mathRender", "tabsRender", "destroyTabsRender", source +
        "; return {ListMindmapView, readListMindmap};")(
        {CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data"}, () => {}, () => {}, () => {});
    const lute = Lute.New();
    lute.SetProtyleWYSIWYG(true);
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const settle = async () => { await frame(); await frame(); await frame(); };
    for (const [index, themeCSS] of themes.entries()) {
        theme.textContent = themeCSS;
        const sourceElement = document.createElement("div");
        sourceElement.innerHTML = lute.Md2BlockDOM("- Root\n  - Alpha\n  - Middle\n  - Omega\n");
        const list = sourceElement.firstElementChild;
        const model = api.readListMindmap(list);
        model.metadata.appearance = {version: 1, palette: ["#2563eb", "#15803d"], nodeStyle: "layered"};
        const [a, middle, b] = model.root.children.map((node: {id: string}) => node.id);
        const relation = {id: "free", from: a, to: b, label: "", pathStyle: "bezier", strokeStyle: "solid",
            color: "#ff0000", width: 3, fromAnchor: {side: "bottom", ratio: .5}, toAnchor: {side: "top", ratio: .5}};
        model.metadata.relations = [relation];
        model.metadata.nodes[middle] = {backgroundColor: "#0000ff", fontSize: index ? 32 : 16};
        const host = document.createElement("div");
        host.style.width = index ? "320px" : "720px";
        document.body.append(host);
        const patches: any[] = [];
        const menus: string[] = [];
        const view = new api.ListMindmapView({host, model,
            labels: new Proxy({}, {get: (_target, key) => String(key)}),
            onRelationChange: (...args: any[]) => patches.push(args),
            onRelationMenu: (_anchor: HTMLElement, id: string) => menus.push(id), onExit: () => {},
        });
        await settle();
        view.fit();
        await settle();
        const overlay = host.querySelector<HTMLCanvasElement>(".mindmap-view__relation-canvas");
        const viewport = host.querySelector<HTMLElement>(".mindmap-view__viewport");
        const canvasBounds = overlay.getBoundingClientRect();
        const viewportBounds = viewport.getBoundingClientRect();
        check.ok(Math.abs(canvasBounds.left - viewportBounds.left) < .1);
        check.ok(Math.abs(canvasBounds.top - viewportBounds.top) < .1);
        check.ok(Math.abs(canvasBounds.width - viewportBounds.width) < .1);
        check.equal(getComputedStyle(overlay).pointerEvents, "none");
        const middleElement = host.querySelector<HTMLElement>(`[data-mindmap-id="${middle}"]`);
        const bounds = middleElement.getBoundingClientRect();
        check.equal(parseFloat(getComputedStyle(middleElement).fontSize), index ? 32 : 16);
        const points = view.relationRoutes.get("free");
        const sampleX = viewportBounds.left + view.offsetX + points[0].x * view.scale;
        const sampleY = bounds.top + 4 * view.scale;
        const screenshot = await require("electron").ipcRenderer.invoke("mindmap-free-capture", index ? "dark" : "light");
        const image = new Image();
        image.src = screenshot;
        await image.decode();
        const sample = document.createElement("canvas");
        sample.width = image.width;
        sample.height = image.height;
        const context = sample.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixel = context.getImageData(Math.round(sampleX), Math.round(sampleY), 1, 1).data;
        check.ok(pixel[0] > 180 && pixel[2] < 100, `free line paints above the blue node: ${[...pixel]}`);
        check.ok(middleElement.contains(document.elementFromPoint(sampleX, sampleY)), "crossing lines do not intercept node input");
        middleElement.classList.add("mindmap-view__node--editing");
        check.ok(Number(getComputedStyle(middleElement).zIndex) > Number(getComputedStyle(overlay).zIndex));
        middleElement.classList.remove("mindmap-view__node--editing");
        view.selectedRelation = "free";
        view.selectedId = undefined;
        view.inspector.hidden = false;
        view.updateSelection();
        view.renderInspector();
        view.draw();
        check.equal(host.querySelectorAll(".mindmap-view__route-handle").length, 4);
        host.querySelector<HTMLButtonElement>('[aria-label="listMindmapRelationAppearance"]').click();
        check.deepEqual(menus, ["free"]);
        const handle = view.routeHandles.get("free:0") as HTMLElement;
        const handleBounds = handle.getBoundingClientRect();
        const x = handleBounds.left + handleBounds.width / 2;
        const y = handleBounds.top + handleBounds.height / 2;
        await require("electron").ipcRenderer.invoke("mindmap-free-drag", {x, y, dx: 30, dy: -20, touch: !!index});
        await settle();
        check.equal(patches.length, 1);
        check.ok(patches[0][1].curve);
        check.equal(JSON.stringify(relation), patches[0][2], "preview keeps the source snapshot untouched");
        Object.assign(relation, patches[0][1]);
        view.update(model);
        await settle();
        const saved = JSON.stringify(relation);
        for (const pathStyle of ["straight", "bezier", "rounded", "bezier", "auto", "bezier"]) {
            relation.pathStyle = pathStyle;
            view.update(model);
            if (pathStyle === "straight" || pathStyle === "bezier") {
                check.equal(view.relationRoutes.get("free").length, pathStyle === "straight" ? 2 : 4,
                    "shape updates invalidate routes before the next layout frame");
            }
            await settle();
            view.selectedRelation = "free";
            view.draw();
            check.ok(view.relationRoutes.get("free").length >= 2);
            if (pathStyle === "straight") {
                check.equal(host.querySelectorAll(".mindmap-view__route-handle").length, 2);
            }
        }
        check.equal(JSON.stringify(relation), saved, "shape switches preserve the saved curve");
        view.destroy();
        host.remove();
        for (const printLayout of [false, true]) {
            const readHost = document.createElement("div");
            readHost.style.width = "500px";
            document.body.append(readHost);
            const readView = new api.ListMindmapView({host: readHost, model, readOnly: true, printLayout, onExit: () => {}});
            await settle();
            check.equal(readHost.querySelectorAll(".mindmap-view__route-handle").length, 0);
            check.equal(readView.relationRoutes.get("free").length, 4);
            check.equal(JSON.stringify(relation), saved);
            readView.destroy();
            readHost.remove();
        }
    }
    return "free-relationships-ok";
};

test("free relationships paint above nodes and preserve controls, dragging, themes and readonly export", {
    timeout: 45000,
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
}, async () => {
    const compile = (file: string) => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const source = ["../../wysiwyg/listContext.ts", "summary.ts", "connectors.ts", "appearance.ts", "relationGeometry.ts", "model.ts",
        "fold.ts", "routing.ts", "pan.ts", "../av/richTextValue.ts", "view.ts"].map(compile).join("\n");
    const css = require("sass").compile(path.resolve(__dirname, "../../../assets/scss/base.scss"), {
        logger: require("sass").Logger.silent,
    }).css;
    const themes = ["daylight", "midnight"].map(name =>
        readFileSync(path.resolve(__dirname, "../../../../appearance/themes", name, "theme.css"), "utf8"));
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-free-relations-"));
    const script = path.join(directory, "run.cjs");
    const browserSource = transpileModule(`(${browserCases.toString()})`, {compilerOptions: {target: ScriptTarget.ES2021}})
        .outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/, "");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 850, height: 700,
        webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true}});
    win.webContents.debugger.attach("1.3");
    ipcMain.handle("mindmap-free-capture", async (_event, name) => {
        const image = await win.webContents.capturePage();
        if (process.env.SIYUAN_TEST_SCREENSHOT_DIR) {
            require("fs").writeFileSync(require("path").join(process.env.SIYUAN_TEST_SCREENSHOT_DIR, name + ".png"), image.toPNG());
        }
        return image.toDataURL();
    });
    ipcMain.handle("mindmap-free-drag", async (_event, {x, y, dx, dy, touch}) => {
        win.webContents.focus();
        if (touch) {
            await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true, maxTouchPoints: 2});
            try {
                for (const event of [{type: "touchStart", touchPoints: [{x, y}]},
                    {type: "touchMove", touchPoints: [{x: x + dx, y: y + dy}]}, {type: "touchEnd", touchPoints: []}]) {
                    await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", event);
                    await new Promise(resolve => setTimeout(resolve, 30));
                }
            } finally {
                await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: false});
            }
            return;
        }
        for (const event of [{type: "mouseDown", x, y}, {type: "mouseMove", x: x + dx, y: y + dy},
            {type: "mouseUp", x: x + dx, y: y + dy}]) {
            win.webContents.sendInputEvent({...event, x: Math.round(event.x), y: Math.round(event.y),
                button: "left", clickCount: 1, modifiers: event.type === "mouseMove" ? ["leftbuttondown"] : []});
            await new Promise(resolve => setTimeout(resolve, 30));
        }
    });
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("fs").readFileSync(${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserSource})(${JSON.stringify(source)}, ${JSON.stringify(css)}, ${JSON.stringify(themes)})`)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as string, [script], {env, windowsHide: true, timeout: 43000});
        assert.match(result.stdout, /free-relationships-ok/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
