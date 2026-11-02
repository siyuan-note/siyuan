import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {transpileModule, ScriptTarget} from "typescript";

const source = readFileSync(path.join(__dirname, "tree.ts"), "utf8");
const start = source.indexOf("    const syncSelection =");
const implementation = source.slice(start, source.indexOf("    const chooseRoot =", start));
const setup = () => {
    const row = (id: string) => ({id: `row-${id}`, dataset: {nodeId: id}, selected: "false", focused: false,
        setAttribute(_name: string, value: string) {this.selected = value;},
        classList: {toggle() {}},
    });
    const items = [row("a"), row("b")];
    const viewport = {scrollTop: 180, active: "", querySelectorAll: () => items,
        setAttribute(_name: string, value: string) {this.active = value;}, removeAttribute() {this.active = "";}};
    const initial = {kind: "ready", rootId: "root", generation: 1, currentNodeId: "a", currentPath: ["root"]};
    let next = {...initial, currentNodeId: "b"};
    const applied: Array<{value: unknown; force: boolean}> = [];
    const loaded: string[] = [];
    const deps = {
        refreshSequence: 0, disposed: false, state: initial, selected: "a", focused: "a", viewport,
        rows: [{node: {id: "a"}}, {node: {id: "b"}}], expanded: new Set(["root"]), children: new Map([["root", []]]),
        bridge: {state: async () => next}, options: {onError() {throw new Error("Unexpected tree error");}},
        applyState: async (value: unknown, force: boolean) => {applied.push({value, force});},
        load: async (id: string) => {loaded.push(id);}, updateFocus() {},
    };
    const body = transpileModule(implementation + "\nreturn syncSelection;", {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const syncSelection: () => Promise<void> = new Function("deps", `with (deps) {${body}}`)(deps);
    return {syncSelection, viewport, items, deps, applied, loaded, next(value: typeof next) {next = value;}};
};

test("same-root document selection retains row identity and scroll without listing or rebuilding", async () => {
    const fixture = setup();
    const before = [...fixture.items];
    await fixture.syncSelection();
    assert.deepEqual(fixture.applied, []);
    assert.deepEqual(fixture.loaded, []);
    assert.equal(fixture.viewport.scrollTop, 180);
    assert.equal(fixture.items[0], before[0]);
    assert.equal(fixture.items[1], before[1]);
    assert.equal(fixture.items[0].selected, "false");
    assert.equal(fixture.items[1].selected, "true");
    assert.equal(fixture.viewport.active, "row-b");
});

test("changed roots use a full refresh and missing paths load only their required directories", async () => {
    const fixture = setup();
    fixture.next({...fixture.deps.state, rootId: "new-root", generation: 2, currentPath: ["new-root"]});
    await fixture.syncSelection();
    assert.equal(fixture.applied[0].force, true);
    assert.deepEqual(fixture.loaded, []);
    fixture.applied.length = 0;
    fixture.next({...fixture.deps.state, currentPath: ["root", "nested"]});
    await fixture.syncSelection();
    assert.equal(fixture.applied[0].force, false);
    assert.deepEqual(fixture.loaded, ["root", "nested"]);
});

test("a superseded selection snapshot cannot replace newer state", async () => {
    const fixture = setup();
    let finish: (value: typeof fixture.deps.state) => void;
    fixture.deps.bridge.state = () => new Promise(resolve => {finish = resolve;});
    const pending = fixture.syncSelection();
    fixture.deps.refreshSequence++;
    finish({...fixture.deps.state, currentNodeId: "b"});
    await pending;
    assert.equal(fixture.deps.selected, "a");
    assert.deepEqual(fixture.applied, []);
});
