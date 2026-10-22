import * as assert from "node:assert/strict";
import test from "node:test";
import {assignListMindmapBranchColors, clearListMindmapManualColors, getListMindmapAppearanceMenu,
    getMindmapTextColor, isListMindmapAppearance, LIST_MINDMAP_PALETTES, resolveListMindmapColors} from "./appearance";
import type {ListMindmapModel, ListMindmapNode} from "./model";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const makeModel = (): ListMindmapModel => {
    const node = (id: string, children: ListMindmapNode[] = []): ListMindmapNode =>
        ({id, children, contentBlocks: [], collapsed: false, virtual: false});
    const root = node("root", [node("a", [node("a1")]), node("b", [node("b1")])]);
    const nodes = new Map<string, ListMindmapNode>();
    const visit = (item: ListMindmapNode) => {
        nodes.set(item.id, item);
        item.children.forEach(child => { child.parentId = item.id; visit(child); });
    };
    visit(root);
    return {list: undefined, root, nodes, metadata: {version: 1, nodes: {}, relations: []}};
};

test("appearance validates optional colors and rejects unsupported formats", () => {
    assert.ok(isListMindmapAppearance({version: 1, palette: [], extension: "retained"}));
    for (const preset of LIST_MINDMAP_PALETTES) {
        assert.ok(isListMindmapAppearance({version: 1, palette: preset.colors, backgroundColor: "#AABBCC"}));
    }
    for (const value of [null, [], {}, {version: 2, palette: []}, {version: 1, palette: "red"},
        {version: 1, palette: ["red"]}, {version: 1, palette: Array(25).fill("#123456")},
        {version: 1, palette: [], backgroundColor: null}, {version: 1, palette: [], backgroundColor: "url(x)"}]) {
        assert.equal(isListMindmapAppearance(value), false);
    }
});

test("all seven built-in palettes remain selectable after reload and provide readable foregrounds", () => {
    assert.equal(LIST_MINDMAP_PALETTES.length, 7);
    assert.equal(new Set(LIST_MINDMAP_PALETTES.map(preset => preset.id)).size, 7);
    assert.equal(new Set(LIST_MINDMAP_PALETTES.map(preset => JSON.stringify(preset.colors))).size, 7);
    const model = makeModel();
    model.metadata.appearance = {version: 1, palette: [], backgroundColor: "#ffffff"};
    model.metadata.nodes.a = {textColor: "red"};
    const luminance = (color: string) => {
        const rgb = color.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16) / 255);
        const linear = rgb.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
        return linear.reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    };
    const themes = () => {
        const menu = getListMindmapAppearanceMenu(model.metadata, update => update(model.metadata), {},
            {id: "connectorStyle", label: "Connectors"});
        return (menu.submenu as IMenu[]).find(item => item.id === "theme").submenu as IMenu[];
    };
    for (const preset of LIST_MINDMAP_PALETTES) {
        themes().find(item => item.id === preset.id).click(undefined, undefined);
        model.metadata = JSON.parse(JSON.stringify(model.metadata));
        assert.deepEqual(themes().filter(item => item.checked).map(item => item.id), [preset.id]);
        assert.deepEqual(model.metadata.appearance.palette, preset.colors);
        assert.equal(model.metadata.appearance.backgroundColor, "#ffffff");
        assert.equal(model.metadata.nodes.a.textColor, "red");
        for (const color of preset.colors) {
            const foreground = luminance(getMindmapTextColor(color));
            const background = luminance(color);
            const contrast = (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
            assert.ok(contrast >= 4.5, `${preset.id} ${color} must retain readable text contrast`);
        }
    }
});

test("branch identity survives reordering, theme changes, insertion, reparenting and serialized reload", () => {
    const model = makeModel();
    const before = JSON.stringify(model.metadata);
    assert.equal(assignListMindmapBranchColors(model), false);
    assert.equal(resolveListMindmapColors(model).size, 0);
    assert.equal(JSON.stringify(model.metadata), before, "legacy maps are never styled implicitly");
    model.metadata.appearance = {version: 1, palette: [...LIST_MINDMAP_PALETTES[0].colors]};
    assert.equal(assignListMindmapBranchColors(model), true);
    assert.equal(assignListMindmapBranchColors(model), false);
    const first = resolveListMindmapColors(model);
    assert.deepEqual(first.get("a"), first.get("a1"));
    assert.notEqual(first.get("a").backgroundColor, first.get("b").backgroundColor);
    model.root.children.reverse();
    model.metadata = JSON.parse(JSON.stringify(model.metadata));
    assert.deepEqual(resolveListMindmapColors(model), first);
    model.metadata.appearance.palette = [...LIST_MINDMAP_PALETTES[1].colors];
    assert.equal(resolveListMindmapColors(model).get("a").backgroundColor, LIST_MINDMAP_PALETTES[1].colors[0]);
    const added = {...model.root.children[0], id: "new", children: [] as ListMindmapNode[]};
    model.root.children.unshift(added);
    assert.equal(assignListMindmapBranchColors(model), true);
    assert.equal(model.metadata.nodes.new.branchColor, 2);
    assert.equal(model.metadata.nodes.a.branchColor, 0);
    const a1 = model.nodes.get("a1");
    model.nodes.get("a").children = [];
    model.nodes.get("b").children.push(a1);
    a1.parentId = "b";
    assert.deepEqual(resolveListMindmapColors(model).get("b"), resolveListMindmapColors(model).get("a1"));
    for (const color of ["#000000", "#166534", "#2563eb"]) {
        assert.equal(getMindmapTextColor(color), "#ffffff");
    }
    for (const color of ["#ffffff", "#bfdbfe", "#fecaca"]) {
        assert.equal(getMindmapTextColor(color), "#000000");
    }
});

test("appearance menu preserves manual colors and non-color metadata until explicit reset", () => {
    const model = makeModel();
    model.metadata.nodes.a = {textColor: "red", backgroundColor: "blue", lineColor: "green", bold: true};
    model.metadata.relations.push({id: "r", from: "a", to: "b", label: "Keep", color: "red", width: 3});
    model.metadata.summaries = [{id: "s", parentId: "root", nodeIds: ["a"], label: "Keep", color: "blue"}];
    const old = JSON.stringify(model.metadata.nodes);
    const labels = {appearance: "Appearance", theme: "Theme", default: "Default"};
    const change = (update: (data: typeof model.metadata) => void) => update(model.metadata);
    const build = () => getListMindmapAppearanceMenu(model.metadata, change, labels, {id: "connectorStyle", label: "Connectors"});
    const choose = (group: string, id: string) => {
        const entries = (build().submenu as IMenu[]).find(item => item.id === group).submenu as IMenu[];
        entries.find(item => item.id === id).click(undefined, undefined);
    };
    choose("theme", "forest");
    assert.equal(JSON.stringify(model.metadata.nodes), old);
    choose("canvasBackground", "dark");
    assert.equal(model.metadata.appearance.backgroundColor, "#1e1e1e");
    choose("theme", "soft");
    assert.equal(model.metadata.appearance.backgroundColor, "#1e1e1e");
    choose("theme", "default");
    assert.equal(resolveListMindmapColors(model).size, 0);
    clearListMindmapManualColors(model.metadata);
    assert.deepEqual(model.metadata.nodes.a, {bold: true});
    assert.deepEqual(model.metadata.relations[0], {id: "r", from: "a", to: "b", label: "Keep", width: 3});
    assert.equal(model.metadata.summaries[0].label, "Keep");
    assert.equal(model.metadata.summaries[0].color, undefined);
    assert.equal(model.metadata.appearance.backgroundColor, "#1e1e1e");
});

const contrastCases = (source: string, css: string) => {
    const check = require("node:assert/strict");
    const api = new Function("Constants", "mathRender", "tabsRender", "destroyTabsRender", source +
        "; return {ListMindmapView, readListMindmap, retagMindmapBranch};")({
        CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap", CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data",
    }, async () => {}, () => {}, () => {});
    const sheet = document.createElement("style");
    sheet.textContent = css;
    document.head.append(sheet);
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    const holder = document.createElement("div");
    holder.innerHTML = lute.Md2BlockDOM("- Root\n  - Empty\n  - Quote\n");
    const list = holder.firstElementChild as HTMLElement;
    api.retagMindmapBranch(list, true);
    const model = api.readListMindmap(list);
    const [emptyNode, quoteNode] = model.root.children;
    emptyNode.contentBlocks[0].querySelector("[contenteditable]").textContent = "";
    const quoteHolder = document.createElement("div");
    quoteHolder.innerHTML = lute.Md2BlockDOM("> Quoted text\n\n> Second paragraph\n");
    const quote = quoteHolder.firstElementChild as HTMLElement;
    const manualText = document.createElement("span");
    manualText.style.color = "#c2410c";
    manualText.textContent = "Manual color";
    quote.querySelector("[contenteditable]").append(manualText);
    quoteNode.contentBlocks.push(quote);
    const host = document.createElement("div");
    host.className = "mindmap-view";
    host.style.cssText = "width:760px;height:460px";
    document.body.append(host);
    const view = new api.ListMindmapView({host, model, onExit() {}});
    const computedColor = (value: string) => {
        const probe = document.createElement("span");
        probe.style.color = value;
        document.body.append(probe);
        const result = getComputedStyle(probe).color;
        probe.remove();
        return result;
    };
    for (const surface of ["#5f6368", "#9aa0a6"]) {
        document.documentElement.style.setProperty("--b3-theme-on-surface", surface);
        document.documentElement.style.setProperty("--b3-theme-on-surface-light", surface);
        document.documentElement.style.setProperty("--b3-empty-color", surface);
        for (const palette of [["#2563eb"], ["#bfdbfe"]]) {
            model.metadata.appearance = {version: 1, palette};
            for (const readOnly of [false, true]) {
                view.readOnly = readOnly;
                view.update(model);
                const rendered = view.nodeElements.get(quoteNode.id) as HTMLElement;
                const empty = view.nodeElements.get(emptyNode.id) as HTMLElement;
                const expected = getComputedStyle(rendered).color;
                check.equal(getComputedStyle(rendered.querySelector(".bq")).color, expected,
                    "quoted text follows the node foreground on dark and light palettes");
                check.equal(getComputedStyle(rendered.querySelector(".bq .p")).color, expected);
                check.equal(getComputedStyle(rendered.querySelector(".bq span")).color, "rgb(194, 65, 12)",
                    "explicit inline colors survive the contrast correction");
                const content = empty.querySelector(".mindmap-view__content");
                check.equal(getComputedStyle(content, "::before").color, getComputedStyle(empty).color,
                    "empty node hints retain readable contrast");
                if (!readOnly) {
                    content.classList.add("mindmap-view__editor");
                    const editor = document.createElement("div");
                    editor.className = "protyle-wysiwyg protyle-wysiwyg--empty";
                    editor.setAttribute("placeholder", "Enter text");
                    content.replaceChildren(editor);
                    check.equal(getComputedStyle(editor, "::before").color, getComputedStyle(empty).color,
                        "the inline editor uses the same readable placeholder color");
                    content.classList.remove("mindmap-view__editor");
                }
            }
            model.metadata.nodes[quoteNode.id] = {textColor: "#ff00ff"};
            view.update(model);
            check.equal(getComputedStyle(view.nodeElements.get(quoteNode.id).querySelector(".bq")).color,
                "rgb(255, 0, 255)", "manual node foregrounds remain authoritative");
            delete model.metadata.nodes[quoteNode.id];
        }
        delete model.metadata.appearance;
        view.update(model);
        check.equal(getComputedStyle(view.nodeElements.get(quoteNode.id).querySelector(".bq")).color,
            computedColor(surface), "removing a palette restores the application quote color");
    }
    view.destroy();
    return "mindmap-contrast-ok";
};

test("palette quote text and placeholders stay readable while manual colors and legacy styles survive", {
    timeout: 20000,
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
}, async () => {
    const compile = (file: string) => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const source = ["../../wysiwyg/listContext.ts", "summary.ts", "connectors.ts", "appearance.ts", "model.ts",
        "fold.ts", "routing.ts", "pan.ts", "../av/richTextValue.ts", "view.ts"].map(compile).join("\n");
    const css = require("sass").compile(path.resolve(__dirname, "../../../assets/scss/base.scss"), {
        logger: require("sass").Logger.silent,
    }).css;
    const dir = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-contrast-"));
    const script = path.join(dir, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(dir, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("fs").readFileSync(${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${contrastCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(css)})`)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as string, [script],
            {env, windowsHide: true, timeout: 18000});
        assert.match(result.stdout, /mindmap-contrast-ok/);
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
});
