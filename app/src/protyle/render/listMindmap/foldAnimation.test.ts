import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import {layoutListMindmapSummaries} from "./summary";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"), ScriptTarget.Latest, true);
const declaration = source.statements.find(isClassDeclaration);
const methods = declaration.members.filter(member => ["animateFold", "positionNodes"].includes(member.name?.getText(source)));
assert.equal(methods.length, 2);
const compiled = transpileModule(`class View {${methods.map(member => member.getText(source)).join("\n")}} globalThis.View = View;`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const setup = (expanding = false) => {
    let sequence = 0;
    let reduced = false;
    const frames = new Map<number, (time: number) => void>();
    const sandbox: any = {
        Map, Set, performance: {now: () => 0}, layoutListMindmapSummaries,
        requestAnimationFrame: (callback: (time: number) => void) => { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame: (id: number) => frames.delete(id),
        window: {matchMedia: () => ({matches: reduced})},
    };
    runInNewContext(compiled, sandbox);
    const view = new sandbox.View();
    const position = (id: string, x: number, y: number) => ({id, x, y, width: 100, height: 40});
    const expanded = new Map([
        ["root", position("root", 20, 100)], ["a", position("a", 180, 50)],
        ["leaf", position("leaf", 340, 50)], ["b", position("b", 180, 150)],
    ]);
    const collapsed = new Map([
        ["root", position("root", 20, 80)], ["a", position("a", 180, 50)], ["b", position("b", 180, 110)],
    ]);
    const expandedEdges = [{from: "root", to: "a"}, {from: "a", to: "leaf"}, {from: "root", to: "b"}];
    const collapsedEdges = expandedEdges.filter(edge => edge.to !== "leaf");
    const previous = expanding ? collapsed : expanded;
    const target = expanding ? expanded : collapsed;
    const previousOffset = {x: 10, y: expanding ? 40 : 20};
    const targetOffset = {x: 10, y: expanding ? 20 : 40};
    const leaf = {id: "leaf", parentId: "a", children: [] as {id: string}[]};
    const a = {id: "a", parentId: "root", children: [leaf]};
    const b = {id: "b", parentId: "root", children: [] as {id: string}[]};
    const root = {id: "root", children: [a, b]};
    const draws: {leaf: number, sibling: number, alpha: number, root: number}[] = [];
    Object.assign(view, {
        model: {root, nodes: new Map([root, a, b, leaf].map(node => [node.id, node])),
            metadata: {version: 1, nodes: {}, relations: [], summaries: []}},
        options: {}, positions: target, edges: expanding ? expandedEdges : collapsedEdges,
        summaryPositions: new Map(), relationRoutes: new Map([["old-route", []]]),
        nodeElements: new Map([...expanded.keys()].map(id => [id, {style: {}, hidden: false, inert: false}])),
        offsetX: targetOffset.x, offsetY: targetOffset.y,
        draw: () => draws.push({leaf: view.positions.get("leaf")?.x, sibling: view.positions.get("b").y,
            alpha: view.foldOpacities?.get("leaf"), root: view.positions.get("root").y + view.offsetY}),
    });
    view.positionNodes();
    const snapshot = JSON.stringify(view.model.metadata);
    return {view, previous, target, previousOffset, draws, frames,
        start: () => view.animateFold(previous, expanding ? collapsedEdges : expandedEdges, previousOffset, new Map()),
        reduce: () => reduced = true,
        advance: (time: number) => {
            const callbacks = [...frames.values()];
            frames.clear();
            callbacks.forEach(callback => callback(time));
        },
        unchanged: () => assert.equal(JSON.stringify(view.model.metadata), snapshot),
    };
};

test("folding moves and fades outgoing nodes with their edges while keeping the anchor fixed", () => {
    const fixture = setup();
    const {view, draws, target} = fixture;
    fixture.start();
    assert.equal(view.nodeElements.get("leaf").hidden, false);
    assert.equal(view.nodeElements.get("leaf").inert, true, "a collapsing child cannot receive input");
    assert.ok(view.edges.some((edge: {to: string}) => edge.to === "leaf"));
    fixture.advance(90);
    const middle = draws.at(-1);
    assert.ok(middle.leaf < 340 && middle.leaf > 280, "the child retracts toward its parent attachment");
    assert.ok(middle.sibling < 150 && middle.sibling > 110, "adjacent branches move smoothly into the freed space");
    assert.ok(middle.alpha > 0 && middle.alpha < 1, "node and connector drawing share the same opacity");
    assert.ok(draws.every(draw => draw.root === 120), "offset interpolation keeps the operation node fixed");
    fixture.advance(180);
    assert.equal(view.positions, target);
    assert.equal(view.nodeElements.get("leaf").hidden, true);
    assert.equal(view.nodeElements.get("leaf").inert, false);
    assert.equal(view.nodeElements.get("leaf").style.opacity, "");
    assert.equal(view.edges.some((edge: {to: string}) => edge.to === "leaf"), false);
    assert.equal(view.stopFoldAnimation, undefined);
    assert.equal(fixture.frames.size, 0);
    fixture.unchanged();
});

test("expanding uses a longer balanced transition before restoring exact geometry without temporary styles", () => {
    const fixture = setup(true);
    fixture.start();
    const {view, draws, target} = fixture;
    assert.equal(view.nodeElements.get("leaf").hidden, false);
    assert.equal(view.nodeElements.get("leaf").style.opacity, "0");
    assert.equal(view.positions.get("leaf").x, 304);
    fixture.advance(70);
    assert.ok(draws.at(-1).alpha > 0 && draws.at(-1).alpha < .25, "the first quarter no longer consumes most of the opening movement");
    fixture.advance(140);
    assert.ok(draws.at(-1).leaf > 304 && draws.at(-1).leaf < 340);
    assert.ok(draws.at(-1).alpha > .35 && draws.at(-1).alpha < .65, "the opening remains visibly in progress at its midpoint");
    fixture.advance(180);
    assert.ok(view.stopFoldAnimation, "opening outlasts the shorter collapse duration");
    fixture.advance(280);
    assert.equal(view.positions, target);
    assert.equal(view.nodeElements.get("leaf").inert, false);
    assert.equal(view.nodeElements.get("leaf").style.left, "340px");
    assert.equal(view.foldOpacities, undefined);
    assert.equal(fixture.frames.size, 0);
    fixture.unchanged();
});

test("a newly expanded subtree preserves row and column spacing throughout its entrance", () => {
    const fixture = setup(true);
    fixture.previous.delete("a");
    fixture.previous.delete("b");
    fixture.start();
    for (const time of [0, 70, 140, 210]) {
        fixture.advance(time);
        const positions = fixture.view.positions;
        assert.equal(positions.get("b").y - positions.get("a").y, 100,
            "sibling labels never pile up at the collapsed parent's center");
        assert.equal(positions.get("leaf").x - positions.get("a").x, 160,
            "parent and child text retain their full horizontal separation");
        assert.ok(Math.abs(positions.get("root").y + fixture.view.offsetY - 120) < 1e-9);
    }
    fixture.advance(280);
    assert.equal(fixture.frames.size, 0);
    fixture.unchanged();
});

test("interruptions finish once, cancel scheduled frames and cannot let stale callbacks restore old geometry", () => {
    const fixture = setup();
    fixture.start();
    const staleFrame = [...fixture.frames.values()][0];
    const finish = fixture.view.stopFoldAnimation;
    fixture.advance(40);
    finish();
    const drawCount = fixture.draws.length;
    fixture.view.positions = new Map();
    staleFrame(160);
    finish();
    assert.equal(fixture.view.positions.size, 0, "canceled callbacks never overwrite a later layout");
    assert.equal(fixture.draws.length, drawCount);
    assert.equal(fixture.frames.size, 0);
    assert.equal(fixture.view.stopFoldAnimation, undefined);
    fixture.unchanged();
});

test("reduced motion, print and destroyed views skip motion and a preference change ends an active transition", () => {
    for (const mode of ["reduced", "print", "printing", "destroyed"]) {
        const fixture = setup();
        if (mode === "reduced") {
            fixture.reduce();
        } else if (mode === "print") {
            fixture.view.options.printLayout = true;
        } else if (mode === "printing") {
            fixture.view.printTransform = {};
        } else {
            fixture.view.destroyed = true;
        }
        fixture.start();
        assert.equal(fixture.view.positions, fixture.target);
        assert.equal(fixture.frames.size, 0, mode);
        assert.equal(fixture.view.stopFoldAnimation, undefined);
        fixture.unchanged();
    }
    const fixture = setup(true);
    fixture.start();
    fixture.reduce();
    fixture.advance(30);
    assert.equal(fixture.view.positions, fixture.target);
    assert.equal(fixture.frames.size, 0);
    assert.equal(fixture.view.nodeElements.get("leaf").inert, false);
    const destroyed = setup();
    destroyed.start();
    const drawCount = destroyed.draws.length;
    destroyed.view.destroyed = true;
    destroyed.advance(30);
    assert.equal(destroyed.draws.length, drawCount, "teardown does not draw a destroyed canvas");
    assert.equal(destroyed.frames.size, 0);
});
