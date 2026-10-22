import * as assert from "node:assert/strict";
import test from "node:test";
import {assignListMindmapBranchColors, clearListMindmapManualColors, getListMindmapAppearanceMenu,
    getMindmapTextColor, isListMindmapAppearance, LIST_MINDMAP_PALETTES, resolveListMindmapColors} from "./appearance";
import type {ListMindmapModel, ListMindmapNode} from "./model";

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
