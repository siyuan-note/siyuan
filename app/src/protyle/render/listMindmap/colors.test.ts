import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createSourceFile, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";
import {getListMindmapLineColors, getListMindmapNodeColors, getListMindmapNodeColorMenu} from "./colors";
import {normalizeInlineStyles} from "../../toolbar/inlineStyle";

const labels = {color: "Color", errorStyle: "Error", warningStyle: "Warning", infoStyle: "Info", successStyle: "Success",
    listMindmapNodeColor: "Node color", colorFont: "Font color", colorPrimary: "Background color"};

test("default node and line palettes have thirteen colors and retain existing semantic pairs", () => {
    const data = normalizeInlineStyles({});
    const before = JSON.stringify(data);
    for (const mode of ["light", "dark"] as const) {
        const nodes = getListMindmapNodeColors(data, labels, mode);
        const lines = getListMindmapLineColors(data, labels, mode);
        assert.equal(nodes.length, 13);
        assert.equal(lines.length, 13);
        assert.deepEqual(nodes.slice(0, 4).map(item => [item.color, item.backgroundColor]),
            ["error", "warning", "info", "success"].map(id => [`var(--b3-card-${id}-color)`, `var(--b3-card-${id}-background)`]));
        assert.deepEqual(nodes.slice(4).map(item => [item.color, item.backgroundColor]),
            Array.from({length: 9}, (_, i) => [`var(--b3-font-color${i + 5})`, `var(--b3-font-background${i + 5})`]));
        assert.deepEqual(lines.map(item => item.value), Array.from({length: 13}, (_, i) => `var(--b3-font-color${i + 1})`));
    }
    assert.equal(JSON.stringify(data), before, "reading palettes does not migrate or overwrite workspace colors");
});

test("six built-in pairs precede scrolling colors while preserving hidden entries, custom ordering and mode values", () => {
    const combinedID = "20260821120000-abcdefg";
    const hiddenID = "20260821120000-bcdefgh";
    const lineID = "20260821120000-cdefghi";
    const data = normalizeInlineStyles({version: 2,
        styles: [
            {id: combinedID, name: "Custom pair", light: {color: "#112233", backgroundColor: "#ddeeff"},
                dark: {color: "#abcdef", backgroundColor: "#223344"}},
            {id: hiddenID, name: "Hidden pair", hidden: true, light: {color: "#112233", backgroundColor: "#ddeeff"},
                dark: {color: "#abcdef", backgroundColor: "#223344"}},
            {id: lineID, name: "Custom line", light: {color: "#123456"}, dark: {color: "#fedcba"}},
        ],
        builtin: {hidden: {style1: ["warning"], color: [2], backgroundColor: [6]},
            styles: [{id: "info", light: {color: "#112233", backgroundColor: "#ddeeff"},
                dark: {color: "#abcdef", backgroundColor: "#223344"}}]},
        order: {style1: [combinedID, "success", "info", "warning", "error", hiddenID],
            backgroundColor: ["13", "6", "5"], color: [lineID, "13", "2", "1"]},
    });
    const before = JSON.stringify(data);
    for (const mode of ["light", "dark"] as const) {
        const nodes = getListMindmapNodeColors(data, labels, mode);
        assert.deepEqual(nodes.slice(0, 5).map(item => item.label), ["Error", "Info", "Success", "Color 5", "Custom pair"]);
        assert.equal(nodes.some(item => item.label === "Hidden pair" || item.label === "Warning"), false);
        assert.equal(nodes[5].label, "Color 13", "remaining built-in colors retain their configured relative order");
        assert.equal(nodes.some(item => item.backgroundColor === "var(--b3-font-background6)"), false);
        assert.deepEqual(nodes[1].preview, mode === "light" ?
            {color: "#112233", backgroundColor: "#ddeeff"} : {color: "#abcdef", backgroundColor: "#223344"});
        assert.match(nodes[4].color, new RegExp(mode === "light" ? "#112233" : "#abcdef"));
        const lines = getListMindmapLineColors(data, labels, mode);
        assert.deepEqual(lines.slice(0, 7).map(item => item.label),
            ["Color 1", "Color 3", "Color 4", "Color 5", "Color 6", "Custom line", "Color 13"]);
        assert.match(lines[5].value, new RegExp(mode === "light" ? "#123456" : "#fedcba"));
        assert.equal(lines.some(item => item.value === "var(--b3-font-color2)"), false);
    }
    assert.equal(JSON.stringify(data), before);
});

test("desktop and mobile node settings open all three existing color managers from the palette anchor", () => {
    const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
        ScriptTarget.ES2021, true);
    let callback = "";
    const visit = (node: import("typescript").Node) => {
        if (isPropertyAssignment(node) && node.name.getText(source) === "onManageNodeColors") {
            callback = node.initializer.getText(source);
        }
        node.forEachChild(visit);
    };
    visit(source);
    assert.ok(callback);
    const compiled = transpileModule(`globalThis.openSettings = ${callback};`,
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    for (const mobile of [false, true]) {
        const selected: string[] = [];
        const entries: IMenu[] = [];
        const placements: unknown[] = [];
        const anchor = {getBoundingClientRect: () => ({left: 20, bottom: 100, height: 26})};
        const context: any = {
            getListMindmapNodeColorMenu, isMobile: () => mobile, window: {siyuan: {languages: labels}},
            openInlineStyleDialog: (type: string) => selected.push(type),
            toggleMenu: ({target, build}: {target: unknown, build: (menu: unknown, session: unknown) => void}) => {
                assert.equal(target, anchor, "the shared menu owner is the fixed settings button");
                build(undefined, {show: (open: () => void) => open()});
            },
            Menu: class {
                addItem(item: IMenu) { entries.push(item); }
                open(position: unknown) { placements.push(position); }
                fullscreen(position: unknown) { placements.push(position); }
            },
        };
        runInNewContext(compiled, context);
        context.openSettings(anchor);
        assert.deepEqual(JSON.parse(JSON.stringify(placements)), [mobile ? "bottom" : {x: 20, y: 100, h: 26}]);
        assert.equal(selected.length, 0, "opening the menu does not open a dialog or change colors");
        assert.deepEqual(entries.map(item => item.label), ["Node color", "Font color", "Background color"]);
        entries.forEach(item => item.click(undefined, undefined));
        assert.deepEqual(selected, ["style1", "color", "backgroundColor"]);
    }
});
