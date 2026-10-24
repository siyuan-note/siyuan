import * as assert from "node:assert/strict";
import test from "node:test";
import {assignListMindmapBranchColors, clearListMindmapManualColors, getListMindmapAppearanceMenu,
    getMindmapLineColor, getMindmapTextColor, isListMindmapAppearance, LIST_MINDMAP_PALETTES, resolveListMindmapColors} from "./appearance";
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
        assert.ok(isListMindmapAppearance({version: 1, palette: preset.colors, rootColor: preset.rootColor, backgroundColor: "#AABBCC"}));
    }
    for (const value of [null, [], {}, {version: 2, palette: []}, {version: 1, palette: "red"},
        {version: 1, palette: ["red"]}, {version: 1, palette: Array(25).fill("#123456")},
        {version: 1, palette: [], backgroundColor: null}, {version: 1, palette: [], backgroundColor: "url(x)"},
        ...[null, "", "red", "url(x)", 123, []].map(rootColor => ({version: 1, palette: [] as string[], rootColor})),
        ...[null, "", "flat", "unknown", 123, []].map(nodeStyle => ({version: 1, palette: [] as string[], nodeStyle}))]) {
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
        assert.equal(model.metadata.appearance.rootColor, preset.rootColor);
        assert.equal(model.metadata.appearance.nodeStyle, "layered");
        assert.ok(!preset.colors.includes(preset.rootColor), "root colors remain separate from every branch color");
        assert.equal(model.metadata.appearance.backgroundColor, "#ffffff");
        assert.equal(model.metadata.nodes.a.textColor, "red");
        for (const [index, color] of [...preset.colors, preset.rootColor].entries()) {
            const lightFill = preset.id === "soft" ||
                (["lavender", "monochrome"].includes(preset.id) && index >= 4);
            assert.equal(getMindmapTextColor(color), lightFill && index < preset.colors.length ? "#000000" : "#ffffff",
                `${preset.id} branch ${index + 1} retains its intended foreground`);
            const foreground = luminance(getMindmapTextColor(color));
            const background = luminance(color);
            const contrast = (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
            assert.ok(contrast >= 4.5, `${preset.id} ${color} must retain readable text contrast`);
        }
    }
});

for (const fixture of [
    {id: "ocean", colors: ["#0c4a6e", "#0369a1", "#0284c7", "#0891b2", "#0d9488", "#0f766e"]},
    {id: "sunset", colors: ["#9a3412", "#c2410c", "#ea580c", "#be123c", "#9f1239", "#7e22ce"]},
    {id: "lavender", colors: ["#4c1d95", "#6d28d9", "#7c3aed", "#a855f7", "#c084fc", "#e9d5ff"]},
]) {
    test(`previous ${fixture.id} palettes retain saved colors and selection until explicitly reapplied`, () => {
        const model = makeModel();
        const preset = LIST_MINDMAP_PALETTES.find(preset => preset.id === fixture.id);
        const previous = fixture.colors;
        model.metadata.appearance = {version: 1, palette: previous, backgroundColor: "#ffffff"};
        model.metadata.nodes.a = {branchColor: 2, textColor: "#ff0000"};
        const before = JSON.stringify(model.metadata);
        const menu = getListMindmapAppearanceMenu(model.metadata, update => update(model.metadata), {},
            {id: "connectorStyle", label: "Connectors"});
        const themes = (menu.submenu as IMenu[]).find(item => item.id === "theme").submenu as IMenu[];
        assert.deepEqual(themes.filter(item => item.checked).map(item => item.id), [fixture.id]);
        assert.equal(resolveListMindmapColors(model).get("a").backgroundColor, previous[2]);
        assert.equal(JSON.stringify(model.metadata), before, "opening the menu never migrates document colors");
        themes.find(item => item.id === fixture.id).click(undefined, undefined);
        assert.deepEqual(model.metadata.appearance.palette, preset.colors);
        assert.equal(model.metadata.appearance.rootColor, preset.rootColor);
        assert.equal(model.metadata.appearance.backgroundColor, "#ffffff");
        assert.deepEqual(model.metadata.nodes.a, {branchColor: 2, textColor: "#ff0000"});
    });
}

test("root colors are opt-in for every existing palette and preserve branch slots, manual styles and undo snapshots", () => {
    for (const preset of LIST_MINDMAP_PALETTES) {
        const model = makeModel();
        model.metadata.appearance = {version: 1, palette: [...preset.colors], backgroundColor: "#ffffff"};
        model.metadata.nodes.root = {backgroundColor: "#fed7aa", bold: true};
        assignListMindmapBranchColors(model);
        const before = JSON.stringify(model.metadata);
        const legacy = resolveListMindmapColors(model);
        assert.equal(legacy.get("root").backgroundColor, legacy.get("a").backgroundColor);
        const themes = () => getListMindmapAppearanceMenu(model.metadata, update => update(model.metadata), {},
            {id: "connectorStyle", label: "Connectors"}).submenu as IMenu[];
        const paletteMenu = () => themes().find(item => item.id === "theme").submenu as IMenu[];
        assert.equal(paletteMenu().find(item => item.id === preset.id).checked, true);
        assert.equal(JSON.stringify(model.metadata), before, "reading and opening a menu never migrate old colors");
        paletteMenu().find(item => item.id === preset.id).click(undefined, undefined);
        const after = JSON.stringify(model.metadata);
        const styled = resolveListMindmapColors(model);
        assert.equal(styled.get("root").backgroundColor, "transparent");
        assert.equal(styled.get("root").lineColor, preset.rootColor);
        assert.notEqual(styled.get("a").backgroundColor, legacy.get("a").backgroundColor);
        assert.equal(styled.get("a1").backgroundColor, "transparent");
        assert.deepEqual(model.metadata.appearance.palette, preset.colors, "layered styling retains the saved branch palette");
        assert.deepEqual(model.metadata.nodes.root, {backgroundColor: "#fed7aa", bold: true});
        model.metadata = JSON.parse(before);
        assert.deepEqual(resolveListMindmapColors(model), legacy, "undo restores the exact legacy root and branch colors");
        model.metadata = JSON.parse(after);
        assert.deepEqual(resolveListMindmapColors(model), styled, "redo and reload retain the independent root color");
        clearListMindmapManualColors(model.metadata);
        assert.deepEqual(model.metadata.nodes.root, {bold: true});
        assert.equal(model.metadata.appearance.rootColor, preset.rootColor, "clearing manual colors retains the root theme");
        assert.equal(model.metadata.nodes.a.branchColor, 0);
        assert.equal(model.metadata.nodes.b.branchColor, 1);
        model.metadata.appearance.rootColor = "#ff0000";
        assert.equal(paletteMenu().some(item => item.checked), false, "a different root color is not the built-in preset");
        paletteMenu().find(item => item.id === "default").click(undefined, undefined);
        assert.equal(model.metadata.appearance.rootColor, undefined);
        assert.equal(model.metadata.appearance.nodeStyle, undefined);
        assert.equal(resolveListMindmapColors(model).size, 0);
    }
});

test("layered palettes combine transparent nodes, neutral text, hierarchical typography and colored lines on every canvas", () => {
    const luminance = (color: string) => color.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16) / 255)
        .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
        .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) /
        (Math.min(luminance(a), luminance(b)) + .05);
    for (const preset of LIST_MINDMAP_PALETTES) {
        for (const canvas of ["#ffffff", "#1e1e1e", ...LIST_MINDMAP_PALETTES[1].colors]) {
            const model = makeModel();
            model.metadata.appearance = {version: 1, palette: [...preset.colors], rootColor: preset.rootColor, nodeStyle: "layered"};
            assignListMindmapBranchColors(model);
            const before = JSON.stringify(model.metadata);
            const colors = resolveListMindmapColors(model, canvas);
            assert.equal(colors.get("root").lineColor, preset.rootColor);
            assert.equal(colors.get("a").lineColor, colors.get("a1").lineColor, "descendants inherit their branch line color");
            assert.notEqual(colors.get("a").lineColor, colors.get("b").lineColor, "colors distinguish different branches");
            assert.deepEqual(["root", "a", "a1"].map(id => colors.get(id).fontSize), [20, 16, 14]);
            assert.deepEqual(["root", "a", "a1"].map(id => colors.get(id).bold), [true, true, false]);
            assert.deepEqual(["root", "a", "a1"].map(id => colors.get(id).lineWidth), [2.25, 1.75, 1.25]);
            for (const [id, style] of colors) {
                assert.equal(style.backgroundColor, "transparent", `${preset.id} ${id} has no theme background`);
                assert.equal(style.textColor, colors.get("root").textColor, "text stays consistent instead of competing with colored lines");
                assert.ok(contrast(style.textColor, canvas) >= 4.5, `${preset.id} ${id} text on ${canvas}`);
                assert.ok(contrast(getMindmapLineColor(style.lineColor, canvas), canvas) >= 3,
                    `${preset.id} ${id} line on ${canvas}`);
            }
            model.root.children.reverse();
            assert.deepEqual(resolveListMindmapColors(model, canvas), colors, "reordering preserves branch colors and levels");
            model.metadata = JSON.parse(before);
            assert.deepEqual(resolveListMindmapColors(model, canvas), colors, "reload retains the layered style");
            assert.equal(JSON.stringify(model.metadata), before);
            model.metadata.appearance.backgroundColor = canvas;
            assert.deepEqual(resolveListMindmapColors(model, "#123456"), colors, "saved canvas colors override application colors");
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

test("theme lines contrast with every canvas preset while retaining sufficiently visible colors", () => {
    const luminance = (color: string) => {
        const linear = color.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16) / 255)
            .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
        return linear.reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    };
    const contrast = (line: string, background: string) => {
        const values = [luminance(line), luminance(background)];
        return (Math.max(...values) + .05) / (Math.min(...values) + .05);
    };
    for (const background of ["#ffffff", "#1e1e1e", ...LIST_MINDMAP_PALETTES[1].colors]) {
        for (const preset of LIST_MINDMAP_PALETTES) {
            for (const color of [...preset.colors, preset.rootColor]) {
                const adjusted = getMindmapLineColor(color, background);
                assert.ok(contrast(adjusted, background) >= 3, `${preset.id} ${color} on ${background}`);
                if (contrast(color, background) >= 3) {
                    assert.equal(adjusted, color, "visible theme lines retain their original color");
                }
            }
        }
    }
    assert.equal(getMindmapLineColor("#bfdbfe", "rgb(255, 255, 255)"), getMindmapLineColor("#bfdbfe", "#ffffff"));
    assert.equal(getMindmapLineColor("#166534", "rgba(30, 30, 30, 1)"), getMindmapLineColor("#166534", "#1e1e1e"));
    assert.equal(getMindmapLineColor("#166534", "rgba(0, 0, 0, 0)"), "#166534");
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
    assert.equal(model.metadata.appearance.rootColor, LIST_MINDMAP_PALETTES[1].rootColor);
    choose("theme", "default");
    assert.equal(model.metadata.appearance.rootColor, undefined);
    assert.equal(resolveListMindmapColors(model).size, 0);
    clearListMindmapManualColors(model.metadata);
    assert.deepEqual(model.metadata.nodes.a, {bold: true});
    assert.deepEqual(model.metadata.relations[0], {id: "r", from: "a", to: "b", label: "Keep", width: 3});
    assert.equal(model.metadata.summaries[0].label, "Keep");
    assert.equal(model.metadata.summaries[0].color, undefined);
    assert.equal(model.metadata.appearance.backgroundColor, "#1e1e1e");
});

const contrastCases = async (source: string, css: string) => {
    const check = require("node:assert/strict");
    const api = new Function("Constants", "mathRender", "tabsRender", "destroyTabsRender", source +
        "; return {ListMindmapView, readListMindmap, retagMindmapBranch, getMindmapLineColor, resolveListMindmapColors, LIST_MINDMAP_PALETTES};")({
        CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap", CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data",
    }, async () => {}, () => {}, () => {});
    const sheet = document.createElement("style");
    sheet.textContent = css;
    document.head.append(sheet);
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    const holder = document.createElement("div");
    holder.innerHTML = lute.Md2BlockDOM("- Root\n  - Empty\n    - Deep\n  - Quote\n");
    const list = holder.firstElementChild as HTMLElement;
    api.retagMindmapBranch(list, true);
    const model = api.readListMindmap(list);
    const [emptyNode, quoteNode] = model.root.children;
    const deepNode = emptyNode.children[0];
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
    const context = view.canvas.getContext("2d");
    const stroke = context.stroke.bind(context);
    const lines: string[] = [];
    const widths: number[] = [];
    context.stroke = (path: Path2D) => { lines.push(computedColor(context.strokeStyle)); widths.push(context.lineWidth); stroke(path); };
    // 固定几何位置，绘制断言不依赖隐藏窗口的动画帧调度。
    view.positions = new Map([model.root, emptyNode, quoteNode].map((node, index) => [node.id,
        {id: node.id, x: index ? 180 : 20, y: index * 80, width: 120, height: 40}]));
    view.edges = [emptyNode, quoteNode].map(node => ({from: model.root.id, to: node.id}));
    view.positions.set(deepNode.id, {id: deepNode.id, x: 340, y: 80, width: 120, height: 40});
    view.edges.push({from: emptyNode.id, to: deepNode.id});
    for (const preset of api.LIST_MINDMAP_PALETTES) {
        for (const background of ["#ffffff", "#1e1e1e"]) {
            for (const printLayout of [false, true]) {
                view.options.printLayout = printLayout;
                view.readOnly = printLayout;
                document.documentElement.style.setProperty("--b3-theme-background", background);
                for (const savedBackground of [undefined, background]) {
                    model.metadata.appearance = {version: 1, palette: preset.colors, rootColor: preset.rootColor,
                        backgroundColor: savedBackground};
                    model.metadata.connectorStyle = "rounded";
                    model.metadata.nodes[quoteNode.id] = {lineColor: "#abcdef"};
                    const before = JSON.stringify(model.metadata);
                    view.update(model);
                    lines.length = 0;
                    view.draw();
                    check.ok(lines.includes(computedColor(api.getMindmapLineColor(preset.colors[0], background))),
                        `theme lines adapt to canvas: ${preset.id} ${background} ${savedBackground} ${printLayout} ${JSON.stringify(lines)}`);
                    check.ok(lines.includes("rgb(171, 205, 239)"), "manual line colors stay authoritative");
                    check.ok(lines.includes(computedColor(api.getMindmapLineColor(preset.rootColor, background))),
                        "the common trunk follows the independent root color in editing and print rendering");
                    check.equal(JSON.stringify(model.metadata), before, "contrast correction never rewrites document colors");
                    check.equal(getComputedStyle(view.nodeElements.get(emptyNode.id)).backgroundColor,
                        computedColor(preset.colors[0]), "node fill retains its saved palette color");
                    check.equal(getComputedStyle(view.nodeElements.get(model.root.id)).backgroundColor,
                        computedColor(preset.rootColor), "the root renders its independent saved color");
                }
            }
        }
    }
    for (const preset of api.LIST_MINDMAP_PALETTES) {
        model.metadata.appearance = {version: 1, palette: preset.colors, rootColor: preset.rootColor, nodeStyle: "layered"};
        for (const printLayout of [false, true]) {
            view.options.printLayout = printLayout;
            view.readOnly = printLayout;
            for (const background of ["#ffffff", "#1e1e1e"]) {
                document.documentElement.style.setProperty("--b3-theme-background", background);
                view.update(model);
                const expected = api.resolveListMindmapColors(model, background);
                for (const [id, colors] of expected) {
                    const element = view.nodeElements.get(id);
                    check.equal(getComputedStyle(element).backgroundColor, "rgba(0, 0, 0, 0)",
                        "all levels render without a theme fill in editing and print views");
                    check.equal(getComputedStyle(element).color, computedColor(colors.textColor));
                    check.equal(getComputedStyle(element).fontSize, `${colors.fontSize}px`);
                    check.equal(getComputedStyle(element).fontWeight, colors.bold ? "600" : "400");
                }
                widths.length = 0;
                view.draw();
                [2.25, 1.75, 1.25].forEach(width => check.ok(widths.includes(width),
                    "real canvas rendering keeps trunks stronger than deeper branch lines"));
                const quote = view.nodeElements.get(quoteNode.id);
                check.equal(getComputedStyle(quote.querySelector(".bq .p")).color, getComputedStyle(quote).color,
                    "layered quote text inherits the neutral theme foreground");
                const empty = view.nodeElements.get(emptyNode.id);
                check.equal(getComputedStyle(view.getContentHost(emptyNode.id), "::before").color, getComputedStyle(empty).color,
                    "layered placeholders retain their branch foreground in editing and print views");
                for (const node of [model.root, emptyNode, deepNode]) {
                    const previous = model.metadata.nodes[node.id];
                    model.metadata.nodes[node.id] = {...previous, backgroundColor: "#2563eb", fontSize: 22, bold: false, italic: true};
                    view.update(model);
                    const element = view.nodeElements.get(node.id);
                    check.equal(getComputedStyle(element).backgroundColor, "rgb(37, 99, 235)",
                        "manual backgrounds remain authoritative at every level");
                    check.equal(getComputedStyle(element).color, "rgb(255, 255, 255)",
                        "manual solid fills retain a readable foreground on a transparent theme");
                    check.equal(getComputedStyle(element).fontSize, "22px", "manual font sizes take precedence over theme hierarchy");
                    check.equal(getComputedStyle(element).fontWeight, "400", "explicit normal weight overrides theme emphasis");
                    check.equal(getComputedStyle(element).fontStyle, "italic");
                    if (previous) {
                        model.metadata.nodes[node.id] = previous;
                    } else {
                        delete model.metadata.nodes[node.id];
                    }
                }
            }
        }
    }
    host.style.setProperty("--b3-mindmap-line-width", "3");
    widths.length = 0;
    view.draw();
    [4.5, 3.5, 2.5].forEach(width => check.ok(widths.includes(width),
        "theme CSS scales the base line width while retaining the new preset's hierarchy"));
    model.metadata.nodes[model.root.id] = {lineWidth: 4};
    widths.length = 0;
    view.draw();
    check.ok(widths.every(width => width === 4), "saved manual line widths override theme CSS and built-in hierarchy");
    delete model.metadata.nodes[model.root.id];
    host.style.removeProperty("--b3-mindmap-line-width");
    view.options.printLayout = false;
    view.readOnly = false;
    view.update(model);
    view.setEditing(deepNode.id);
    const editorHost = view.getContentHost(deepNode.id);
    const editorContent = document.createElement("div");
    editorContent.textContent = "Unsaved editor content";
    editorHost.replaceChildren(editorContent);
    const metadataBeforeThemeChange = JSON.stringify(model.metadata);
    document.documentElement.style.setProperty("--b3-theme-background", "#ffffff");
    await new Promise(resolve => setTimeout(resolve, 0));
    check.equal(getComputedStyle(view.nodeElements.get(deepNode.id)).color,
        computedColor(api.resolveListMindmapColors(model, "#ffffff").get(deepNode.id).textColor),
        "application theme changes refresh layered foregrounds without a document reload");
    check.equal(editorHost.firstElementChild, editorContent, "theme changes preserve the active editor DOM");
    check.equal(view.editingId, deepNode.id);
    check.equal(JSON.stringify(model.metadata), metadataBeforeThemeChange);
    model.metadata.appearance.palette = [];
    view.update(model);
    view.nodeElements.forEach((element: HTMLElement) => {
        check.equal(element.style.fontSize, "", "removing the theme restores legacy font sizing");
        check.equal(element.style.fontWeight, "");
        check.equal(element.style.fontStyle, "");
    });
    context.stroke = stroke;
    view.destroy();
    return "mindmap-contrast-ok";
};

test("palette text and canvas connectors stay readable while manual colors and legacy styles survive", {
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
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
        backgroundThrottling: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("fs").readFileSync(${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (async () => { try { return await (${contrastCases.toString()})` +
        `(${JSON.stringify(source)}, ${JSON.stringify(css)}); } catch (error) { return error.stack; } })()`)}));
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
