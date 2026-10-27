import * as assert from "node:assert/strict";
import test from "node:test";
import {buildListMindmapConnectors, buildListMindmapSummaryConnector, LIST_MINDMAP_CONNECTOR_STYLES} from "./connectors";
import {getListMindmapConnectorMenuItem} from "./connectorMenu";
import type {ListMindmapPosition} from "./model";

class PathFixture {
    commands: (string | number)[][] = [];
    moveTo(...values: number[]) { this.commands.push(["move", ...values]); }
    lineTo(...values: number[]) { this.commands.push(["line", ...values]); }
    bezierCurveTo(...values: number[]) { this.commands.push(["bezier", ...values]); }
    quadraticCurveTo(...values: number[]) { this.commands.push(["quadratic", ...values]); }
}
const positions = new Map<string, ListMindmapPosition>([
    ["root", {id: "root", x: 20, y: 100, width: 100, height: 40}],
    ["a", {id: "a", parentId: "root", x: 160, y: 0, width: 100, height: 40}],
    ["b", {id: "b", parentId: "root", x: 230, y: 200, width: 70, height: 40}],
    ["c", {id: "c", parentId: "b", x: 340, y: 200, width: 80, height: 40}],
]);
const edges = [{from: "root", to: "a"}, {from: "root", to: "b"}, {from: "b", to: "c"}];
const build = (style: typeof LIST_MINDMAP_CONNECTOR_STYLES[number]) =>
    buildListMindmapConnectors("root", positions, edges, style, () => new PathFixture());

test("curved connector presets retain the legacy endpoints and use distinct tangents", () => {
    const before = structuredClone(positions);
    const legacy = build("bezier");
    assert.equal(legacy.trunks.length, 0);
    assert.deepEqual(legacy.branches[0].path.commands, [
        ["move", 120, 120], ["bezier", 140, 120, 140, 40, 160, 40], ["line", 260, 40],
    ]);
    assert.deepEqual(legacy.branches[2].path.commands, [
        ["move", 300, 240], ["bezier", 320, 240, 320, 240, 340, 240], ["line", 420, 240],
    ]);
    const fork = build("spline");
    assert.deepEqual(fork.branches[0].path.commands, [
        ["move", 120, 120], ["bezier", 120, 120, 140, 40, 160, 40], ["line", 260, 40],
    ]);
    assert.deepEqual(positions, before, "changing connector shapes cannot change node positions");
});

test("orthogonal siblings share a trunk while each selectable branch stays horizontal", () => {
    const result = build("orthogonal");
    assert.equal(result.trunks.length, 2, "one trunk per visible parent, including single-child parents");
    assert.deepEqual(result.trunks[0].commands, [
        ["move", 120, 120], ["line", 140, 120], ["move", 140, 40], ["line", 140, 240],
    ]);
    assert.deepEqual(result.branches.map(branch => [branch.id, branch.path.commands]), [
        ["a", [["move", 140, 40], ["line", 260, 40]]],
        ["b", [["move", 140, 240], ["line", 300, 240]]],
        ["c", [["move", 320, 240], ["line", 420, 240]]],
    ]);
    const hidden = new Map(positions);
    hidden.delete("b");
    const folded = buildListMindmapConnectors("root", hidden, edges, "orthogonal", () => new PathFixture());
    assert.deepEqual(folded.branches.map(branch => branch.id), ["a"], "missing folded endpoints cannot leave orphan paths");
});

test("rounded orthogonal corners stop the shared trunk at each outer tangent", () => {
    const result = build("rounded");
    assert.deepEqual(result.trunks[0].commands, [
        ["move", 120, 120], ["line", 140, 120], ["move", 140, 48], ["line", 140, 232],
    ]);
    assert.deepEqual(result.branches[0].path.commands, [
        ["move", 140, 48], ["quadratic", 140, 40, 148, 40], ["line", 260, 40],
    ]);
    assert.deepEqual(result.branches[1].path.commands, [
        ["move", 140, 232], ["quadratic", 140, 240, 148, 240], ["line", 300, 240],
    ]);
    assert.deepEqual(result.branches[2].path.commands, [["move", 320, 240], ["line", 420, 240]],
        "aligned nodes need no corner and retain a continuous horizontal connection");
});

test("reference themes overlay root trunks in branch order and keep their shared geometry out of hit paths", () => {
    for (const style of ["orthogonal", "rounded"] as const) {
        const result = buildListMindmapConnectors("root", positions, edges, style, () => new PathFixture(), true);
        assert.deepEqual(result.trunkParents, ["b"], "only non-root parents retain one common trunk");
        const corner = style === "rounded" ? 8 : 0;
        assert.deepEqual(result.branches[0].trunk.commands, [
            ["move", 120, 120], ["line", 140, 120], ["line", 140, 20 + corner],
        ]);
        assert.deepEqual(result.branches[1].trunk.commands, [
            ["move", 120, 120], ["line", 140, 120], ["line", 140, 220 - corner],
        ]);
        assert.equal(result.branches[2].trunk, undefined);
        assert.ok(result.branches.every(branch => {
            const x = branch.path.commands[0][1];
            return typeof x === "number" && x >= 140;
        }),
            "selectable paths exclude the horizontal root stem and vertical overlap");
        assert.equal(result.branches[0].path.commands.at(-1).at(-1), 20,
            "filled first-level nodes attach at their center");
        assert.equal(result.branches[2].path.commands.at(-1).at(-1), 240,
            "deeper unfilled nodes keep their text underline");
        const reordered = buildListMindmapConnectors("root", positions, [edges[1], edges[0], edges[2]],
            style, () => new PathFixture(), true);
        assert.deepEqual(reordered.branches.map(branch => branch.id), ["b", "a", "c"]);
        assert.deepEqual(reordered.branches[0].trunk.commands, result.branches[1].trunk.commands);
        assert.deepEqual(reordered.branches[1].trunk.commands, result.branches[0].trunk.commands);
    }
    for (const style of ["spline", "bezier"] as const) {
        const result = buildListMindmapConnectors("root", positions, edges, style, () => new PathFixture(), true);
        assert.equal(result.trunks.length, 0);
        assert.ok(result.branches.every(branch => !branch.trunk));
        assert.equal(result.branches[0].path.commands.at(-1).at(-1), 20);
        assert.equal(result.branches[2].path.commands[0].at(-1), 220);
    }
});

test("the connector submenu checks the saved preset and selects exactly one whole-map style", () => {
    const labels = {listMindmapConnectorStyle: "Connectors", listMindmapConnectorSpline: "Fork",
        listMindmapConnectorOrthogonal: "Elbow", listMindmapConnectorBezier: "Fan", listMindmapConnectorRounded: "Rounded"};
    for (const current of LIST_MINDMAP_CONNECTOR_STYLES) {
        const selected: string[] = [];
        const item = getListMindmapConnectorMenuItem(current, style => selected.push(style), labels);
        assert.equal(item.label, "Connectors");
        assert.ok(Array.isArray(item.submenu));
        const entries = item.submenu as IMenu[];
        assert.deepEqual(entries.map(entry => entry.label), ["Fork", "Elbow", "Fan", "Rounded"]);
        assert.deepEqual(entries.filter(entry => entry.checked).map(entry => entry.id), [current]);
        entries.forEach(entry => entry.click(undefined, undefined));
        assert.deepEqual(selected, [...LIST_MINDMAP_CONNECTOR_STYLES]);
    }
});

test("summary connectors follow all four styles while retaining their range and label endpoints", () => {
    const position = {id: "summary", x: 200, top: 10, bottom: 110, labelX: 224, labelY: 40, width: 100, height: 40};
    const shapes = LIST_MINDMAP_CONNECTOR_STYLES.map(style =>
        buildListMindmapSummaryConnector(position, style, () => new PathFixture()).commands);
    assert.equal(new Set(shapes.map(commands => JSON.stringify(commands))).size, 4);
    shapes.forEach(commands => {
        const points = commands.flatMap(command => {
            const values = command.slice(1) as number[];
            return values.filter((_value, index) => index % 2 === 0).map((x, index) => [x, values[index * 2 + 1]]);
        });
        for (const point of [[190, 10], [190, 110], [218, 60]]) {
            assert.ok(points.some(candidate => candidate[0] === point[0] && candidate[1] === point[1]));
        }
        assert.ok(points.every(([x, y]) => x >= 190 && x <= 218 && y >= 10 && y <= 110));
    });
    assert.ok(shapes[0].some(command => command[0] === "bezier"));
    assert.ok(shapes[1].every(command => command[0] === "move" || command[0] === "line"));
    assert.ok(shapes[2].some(command => command[0] === "bezier"));
    assert.ok(shapes[3].some(command => command[0] === "quadratic"));
    for (const height of [0, 1, 8]) {
        const commands = buildListMindmapSummaryConnector({...position, bottom: position.top + height},
            "rounded", () => new PathFixture()).commands;
        const ys = commands.flatMap(command => command.slice(2).filter((_value, index) => index % 2 === 0)) as number[];
        assert.ok(ys.every(y => y >= position.top && y <= position.top + height));
    }
});
