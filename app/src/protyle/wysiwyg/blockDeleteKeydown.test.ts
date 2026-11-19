import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isIfStatement, ScriptTarget, transpileModule} from "typescript";
import {BLOCK_SELECTION_CLASS, runBlockSelectionDelete} from "./blockSelection";

const source = createSourceFile("keydown.ts", readFileSync("src/protyle/wysiwyg/keydown.ts", "utf8"),
    ScriptTarget.ES2021, true);
let deletion: import("typescript").IfStatement;
const visit = (node: import("typescript").Node) => {
    if (isIfStatement(node) && node.expression.getText(source).startsWith(
        '(!event.altKey && (event.key === "Backspace" || event.key === "Delete"))')) {
        deletion = node;
    }
    node.forEachChild(visit);
};
source.forEachChild(visit);
assert.ok(deletion);
const statements = (deletion.thenStatement as import("typescript").Block).statements;
const textDeletion = statements.findIndex(statement => isIfStatement(statement) &&
    statement.expression.getText(source) === 'selectText === "" && range.collapsed');
assert.ok(textDeletion > 0);
const compiled = transpileModule(`async () => {
    ${statements.slice(0, textDeletion).map(statement => statement.getText(source)).join("\n")}
    return "native-text";
}`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = (key: string, selected: string[], crossBlock = false, fullText = true, mode = false) => {
    const calls: {kind: string, args: unknown[]}[] = [];
    const nodeElement = {id: "child"};
    const endElement = crossBlock ? {id: "other-child"} : nodeElement;
    const range = {collapsed: false};
    const protyle = {wysiwyg: {element: {querySelector: () => selected[0]}}};
    const event = {key, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; }};
    let rangeChecks = 0;
    const capture = (kind: string) => async (...args: unknown[]) => {
        assert.equal(event.defaultPrevented, true, "prevent native deletion before awaiting removal");
        assert.equal(event.stopped, true);
        calls.push({kind, args});
    };
    const handle = runInNewContext(compiled, {
        event, protyle, range, nodeElement, endElement, isCrossBlock: crossBlock, selectText: "child",
        blockSelectionModeElement: mode ? {id: "parent"} : undefined, forwardBlockRemovalPending: false,
        BLOCK_SELECTION_CLASS, runBlockSelectionDelete,
        getRangeBlockRefCheckTargets: () => {
            rangeChecks++;
            return {elements: fullText ? [nodeElement] : [], exactIDs: [] as string[], deletedIDs: [] as string[]};
        },
        removeCrossBlockRange: capture("text"), removeBlock: capture("blocks"),
        removeBlockPreservingSelectionMode: capture("mode"),
    }) as () => Promise<string | undefined>;
    return {handle, calls, event, protyle, range, nodeElement, endElement, rangeChecks: () => rangeChecks};
};

for (const key of ["Backspace", "Delete"]) {
    test(`${key} prioritizes selected parent and multiple blocks over stale text ranges`, async () => {
        for (const selected of [["parent"], ["parent", "sibling"]]) {
            for (const crossBlock of [false, true]) {
                for (const fullText of [false, true]) {
                    const fixture = setup(key, selected, crossBlock, fullText);
                    await fixture.handle();
                    assert.deepEqual(fixture.calls, [{kind: "blocks", args:
                        [fixture.protyle, fixture.nodeElement, fixture.range, key]}]);
                    assert.equal(fixture.rangeChecks(), 0, "stale text must not determine reference-check targets");
                }
            }
        }
    });
    test(`${key} retains the block-selection-mode removal path`, async () => {
        const fixture = setup(key, ["parent"], true, true, true);
        await fixture.handle();
        assert.equal(fixture.calls[0].kind, "mode");
        assert.equal(fixture.calls[0].args.length, 4, "do not bypass reference checks");
        assert.equal(fixture.calls[0].args[3], key);
        assert.equal(fixture.rangeChecks(), 0);
    });
    test(`${key} preserves text removal when no blocks are selected`, async () => {
        for (const crossBlock of [false, true]) {
            const fixture = setup(key, [], crossBlock);
            await fixture.handle();
            assert.deepEqual(fixture.calls, [{kind: "text", args:
                [fixture.protyle, fixture.range, fixture.nodeElement, fixture.endElement]}]);
            assert.equal(fixture.rangeChecks(), 1);
        }
        const partial = setup(key, [], false, false);
        assert.equal(await partial.handle(), "native-text");
        assert.equal(partial.calls.length, 0);
        assert.equal(partial.event.defaultPrevented, false);
    });
}
