import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("mobile MCP deletion waits for persistence and retries without removing other servers", async () => {
    const servers = [{name: "remove"}, {name: "keep"}];
    let click: (event: unknown) => void;
    let confirm: () => Promise<boolean>;
    let options: {awaitConfirm: boolean};
    let fail = true;
    let saved: unknown;
    const block = {querySelector: (): null => null, addEventListener: (event: string, callback: typeof click) => {
        if (event === "click") click = callback;
    }};
    const root = {querySelector: (selector: string) => selector === "#aiMcpServersBlock" ? block : null};
    const exports = {} as {mountMcpServersBlock: (root: unknown) => void};
    const compiled = transpileModule(readFileSync("src/config/tabs/ai/aiUi.ts", "utf8"),
        {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {config: {ai: {mcp: {servers}}}, languages: {confirmDeleteTip: "${x}"}}},
        require: () => ({
            isMobile: () => true,
            startMountedPolling: () => {},
            escapeHtmlTextAndAttr: (value: string) => value,
            aiConfigApi: {patch: async (key: string, next: unknown) => {
                assert.equal(key, "mcp.servers");
                if (fail) throw new Error("delete failed");
                saved = next;
            }},
            mobileConfirmDialog: (...args: unknown[]) => {
                confirm = args[2] as typeof confirm;
                options = args[7] as typeof options;
            },
        }),
    });
    exports.mountMcpServersBlock(root);
    const action = {dataset: {type: "deleteAiMcpServer"},
        closest: () => ({dataset: {mcpServerName: "remove"}})};
    click({target: {closest: () => action}, preventDefault() {}, stopPropagation() {}});
    assert.equal(options.awaitConfirm, true);
    await assert.rejects(confirm(), /delete failed/);
    assert.equal(saved, undefined);
    assert.equal(servers.length, 2);
    fail = false;
    assert.equal(await confirm(), true);
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{name: "keep"}]);
});
