import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {join, relative} from "node:path";
import {test} from "node:test";
import {createSourceFile, forEachChild, isCallExpression, isNewExpression, ScriptTarget, type Node} from "typescript";

const sourceFiles = (directory: string): string[] => readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : file.endsWith(".ts") && !file.endsWith(".test.ts") ? [file] : [];
});

test("settings and sync route every confirmation through the shared adapter", () => {
    const original: string[] = [];
    let adapters = 0;
    for (const file of [...sourceFiles("src/config"), ...sourceFiles("src/sync"), "src/mobile/menu/workspaceManager.ts"]) {
        const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
        const visit = (node: Node) => {
            if (isCallExpression(node) || isNewExpression(node)) {
                const name = node.expression.getText(source);
                // confirmDialog 与 openInputDialog 自身按平台选择实现，不再属于绕过适配的桌面直连调用。
                if (name === "Dialog") {
                    original.push(`${relative("src", file).replaceAll("\\", "/")}:${name}`);
                }
                if (["AdaptiveDialog", "openInputDialog", "confirmDialog"].includes(name)) adapters++;
            }
            forEachChild(node, visit);
        };
        visit(source);
    }
    assert.deepEqual(original.sort(), ["config/index.ts:Dialog"]);
    // 73 处已统一使用 confirmDialog 或其他移动适配入口。
    assert.equal(adapters, 73);
});

test("settings reuse shared viewport, delayed focus and pending save contracts", () => {
    const secrets = readFileSync("src/config/tabs/secretsVariablesUi.ts", "utf8");
    assert.doesNotMatch(secrets, /bindItemDialogViewport|visualViewport/);
    assert.match(secrets, /focusWhenReady/);
    assert.match(secrets, /runPending/);
    const snippets = readFileSync("src/config/util/snippets.ts", "utf8");
    assert.match(snippets, /mobileSheet: \{beforeClose: async/);
    assert.match(snippets, /!isMobile\(\) && !dialog\.element\.isConnected/);
    assert.match(snippets, /controls\.forEach\(control => \{ control\.disabled = true;/);
    const checkout = readFileSync("src/sync/checkoutProgress.ts", "utf8");
    assert.match(checkout, /bindMobileSheetLayout\(root, [^\n]+standalone: true/);
    assert.match(checkout, /sheetLayout\?\.dispose\(\)/);
    assert.doesNotMatch(checkout, /bindBottomSheetDrag/);
});

test("complex settings forms use shared drawers without forcing expanded height", () => {
    for (const file of ["util/snippets.ts", "tabs/accessTab.ts", "tabs/ai/aiUi.ts",
        "tabs/ai/aiInstructions.ts", "tabs/secretsVariablesUi.ts", "tabs/syncUi.ts",
        "tabs/appearanceTab.ts", "notebookArchive.ts", "encryptedAssets.ts"]) {
        const source = readFileSync(`src/config/${file}`, "utf8");
        assert.match(source, /new AdaptiveDialog\(|openInputDialog\(/, file);
        assert.doesNotMatch(source, /expandable:/, file);
        assert.doesNotMatch(source, /mode: "expanded"/, file);
    }
});
