import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {transpileModule} from "typescript";

test("backlink index commits refresh dock panels and reference count popovers", () => {
    const source = readFileSync("src/dialog/processSystem.ts", "utf8");
    const start = source.indexOf("export const processBacklinkIndexCommit");
    const end = source.indexOf("export const setRefDynamicText");
    assert.ok(start >= 0 && end > start);
    const compiled = transpileModule(source.slice(start, end).replace("export const", "const"), {}).outputText;
    const calls: unknown[] = [];
    const panel = (name: string) => ({
        markIndexDirty: (change: unknown) => calls.push([name, change]),
        refreshAfterIndex: () => calls.push(name),
    });
    const process = new Function("getAllModels", "getMobileBacklinkPanels", "window",
        compiled + "return processBacklinkIndexCommit;")(
        () => ({backlink: [panel("dock")]}), (): unknown[] => [],
        {siyuan: {blockPanels: [{backlink: panel("popover")}, {}]}});
    process({backlinkChanged: false});
    assert.deepEqual(calls, []);
    const change = {backlinkChanged: true, rootIDs: ["source"], backlinkFull: false};
    process(change);
    assert.deepEqual(calls, [["dock", change], "dock", ["popover", change], "popover"]);
});
