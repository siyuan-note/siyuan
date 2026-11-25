import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {formatShortcut} from "../util/shortcut";

test("agent phrases show one shortcut hint on desktop and send only with the desktop modifier", () => {
    const compatibility = createSourceFile("compatibility.ts",
        readFileSync("src/protyle/util/compatibility.ts", "utf8"), ScriptTarget.Latest, true);
    const isOnlyMeta = compatibility.statements.filter(isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations])
        .find(declaration => declaration.name.getText(compatibility) === "isOnlyMeta");
    const actions = transpileModule(readFileSync("src/ai/actions.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    assert.ok(isOnlyMeta?.initializer);
    const modifier = transpileModule(`const isOnlyMeta = ${isOnlyMeta.initializer.getText(compatibility)};\nisOnlyMeta;`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    for (const platform of ["desktop", "mac", "mobile"]) {
        const items: IMenu[] = [];
        const applied: [string, boolean][] = [];
        const target = {isConnected: true, getBoundingClientRect: () => ({left: 0, bottom: 0, height: 1})};
        const exports = {} as {openAgentPhrases: typeof import("./actions").openAgentPhrases};
        runInNewContext(actions, {
            exports,
            window: {siyuan: {languages: {
                aiContinueWrite: "Continue", aiTranslate: "Translate", aiExtractSummary: "Summarize",
                aiPolish: "Polish", aiBrainStorm: "Brainstorm", aiFixGrammarSpell: "Proofread",
                agentQuickPhraseSendTip: "Hold ${key} and click to send",
            }}},
            require: () => ({
                isMobile: () => platform === "mobile",
                isOnlyMeta: runInNewContext(modifier, {isMac: () => platform === "mac"}),
                updateHotkeyTip: (hotkey: string) => formatShortcut(hotkey, platform === "mac"),
                escapeHtml: (label: string) => label,
                toggleMenu: ({build}: {build: (menu: undefined, session: unknown) => void}) =>
                    build(undefined, {isCurrent: () => true, show: (show: () => void) => show()}),
                fetchPost: (url: string, _request: unknown, callback: (response: unknown) => void) => {
                    assert.equal(url, "/api/ai/editor/lsActions");
                    callback({data: [{id: "saved", name: "Review", action: "Review {{input}}"}]});
                },
                Menu: class {
                    addItem(item: IMenu) { items.push(item); }
                    addSeparator() {}
                    open() {}
                },
            }),
        });
        exports.openAgentPhrases(target as HTMLElement, (instruction, send) => applied.push([instruction, send]));
        const hints = items.filter(item => item.type === "readonly");
        if (platform === "mobile") {
            assert.equal(hints.length, 0);
        } else {
            assert.equal(hints.length, 1);
            assert.equal(items[0], hints[0]);
            assert.equal(hints[0].label, `Hold ${platform === "mac" ? "⌘" : "Ctrl"} and click to send`);
            assert.equal(hints[0].click, undefined);
        }
        assert.equal(items.some(item => item.accelerator), false);
        const saved = items.find(item => item.label === "Review");
        assert.ok(saved);
        for (const event of [{}, {ctrlKey: true}, {metaKey: true}]) {
            saved.click(undefined, event as MouseEvent);
        }
        items.find(item => item.label === "Continue").click(undefined, {} as MouseEvent);
        assert.deepEqual(applied, [
            ["Review {{input}}", false], ["Review {{input}}", platform === "desktop"],
            ["Review {{input}}", platform === "mac"], ["Continue", false],
        ]);
    }
});
