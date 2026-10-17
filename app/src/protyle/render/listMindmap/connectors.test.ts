import * as assert from "node:assert/strict";
import test from "node:test";
import {buildListMindmapConnectors, LIST_MINDMAP_CONNECTOR_STYLES} from "./connectors";
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
