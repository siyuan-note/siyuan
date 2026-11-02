import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {join, relative} from "node:path";
import {test} from "node:test";
import {createSourceFile, forEachChild, isCallExpression, isNewExpression, ScriptTarget, type Node} from "typescript";

const sourceFiles = (directory: string): string[] => readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : file.endsWith(".ts") && !file.endsWith(".test.ts") ? [file] : [];
});

test("settings and sync opt in at all inventoried mobile dialog entries, retaining desktop exclusions", () => {
    const original: string[] = [];
    let adapters = 0;
    for (const file of [...sourceFiles("src/config"), ...sourceFiles("src/sync")]) {
        const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
        const visit = (node: Node) => {
            if (isCallExpression(node) || isNewExpression(node)) {
                const name = node.expression.getText(source);
                if (["Dialog", "openInputDialog", "confirmDialog"].includes(name)) {
                    original.push(`${relative("src", file).replaceAll("\\", "/")}:${name}`);
                }
                if (["MobileDialog", "mobileInputDialog", "mobileConfirmDialog"].includes(name)) adapters++;
            }
            forEachChild(node, visit);
        };
        visit(source);
    }
    assert.deepEqual(original.sort(), ["config/index.ts:Dialog", "config/tabs/appearanceTab.ts:confirmDialog",
        "config/tabs/keymapUi.ts:confirmDialog"]);
    // 70 个原有接入点，以及代码片段移动端关闭前的独立保存确认。
    assert.equal(adapters, 71);
});

test("settings reuse shared viewport, delayed focus and pending save contracts", () => {
    const secrets = readFileSync("src/config/tabs/secretsVariablesUi.ts", "utf8");
    assert.doesNotMatch(secrets, /bindItemDialogViewport|visualViewport/);
    assert.match(secrets, /focusWhenReady/);
    assert.match(secrets, /runPending/);
    const snippets = readFileSync("src/config/util/snippets.ts", "utf8");
    assert.match(snippets, /mobileSheet: \{expandable: true, beforeClose: async/);
    assert.match(snippets, /!isMobile\(\) && !dialog\.element\.isConnected/);
    assert.match(snippets, /controls\.forEach\(control => \{ control\.disabled = true;/);
    const checkout = readFileSync("src/sync/checkoutProgress.ts", "utf8");
    assert.match(checkout, /bindMobileSheetLayout\(root, [^\n]+standalone: true/);
    assert.match(checkout, /sheetLayout\?\.dispose\(\)/);
    assert.doesNotMatch(checkout, /bindBottomSheetDrag/);
});

test("complex settings forms opt in to optional expansion without forcing expanded height", () => {
    for (const file of ["util/snippets.ts", "tabs/accessTab.ts", "tabs/ai/aiUi.ts",
        "tabs/ai/aiInstructions.ts", "tabs/secretsVariablesUi.ts", "tabs/syncUi.ts",
        "tabs/appearanceTab.ts", "notebookArchive.ts", "encryptedAssets.ts"]) {
        const source = readFileSync(`src/config/${file}`, "utf8");
        assert.match(source, /mobileSheet: \{expandable: true/, file);
        assert.doesNotMatch(source, /mode: "expanded"/, file);
    }
});
