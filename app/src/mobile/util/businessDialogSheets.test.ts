import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, forEachChild, isCallExpression, isNewExpression, ScriptTarget} from "typescript";

const entries: Record<string, number> = {
    "menus/importData.ts": 2,
    "boot/openChangelog.ts": 1,
    "menus/bookmark.ts": 2,
    "menus/navigation.ts": 1,
    "editor/rename.ts": 2,
    "editor/deleteFile.ts": 5,
    "menus/commonMenuItem.ts": 6,
    "util/fileTreeReorder.ts": 1,
    "menus/dataMigration.ts": 3,
    "menus/block.ts": 1,
    "util/checkBlockRef.ts": 1,
    "util/mount.ts": 4,
    "util/documentAncestor.ts": 1,
    "util/kernelFault.ts": 1,
    "util/configuredDocument.ts": 1,
    "util/pathName.ts": 1,
    "util/noRelyPCFunction.ts": 1,
    "mobile/dock/MobileFiles.ts": 1,
    "layout/dock/Inbox.ts": 1,
    "layout/dock/agent/AgentChat.ts": 3,
    "dialog/processSystem.ts": 4,
    "dialog/exitRequest.ts": 2,
};

test("mobile business dialogs explicitly opt in, including nested and failure entries", () => {
    for (const [file, count] of Object.entries(entries)) {
        const source = createSourceFile(file, readFileSync(`src/${file}`, "utf8"), ScriptTarget.Latest, true);
        let found = 0;
        const visit = (node: import("typescript").Node) => {
            if (isCallExpression(node) || isNewExpression(node)) {
                const name = node.expression.getText(source);
                if (["Dialog", "MobileDialog", "openInputDialog", "confirmDialog"].includes(name)) {
                    const options = node.arguments[0];
                    if (name === "Dialog" && file === "menus/commonMenuItem.ts" &&
                        options.getText(source).includes("mobile-attributes-sheet")) {
                        // 属性编辑器保留原有关闭回调，使用独立的抽屉绑定入口。
                    } else {
                        const moduleName = name === "confirmDialog" ? "mobileConfirmDialog" :
                            name === "openInputDialog" ? "mobileInputDialog" : "mobileDialog";
                        assert.ok(source.text.includes(moduleName), `${file}: ${name}`);
                        found++;
                    }
                }
            }
            forEachChild(node, visit);
        };
        visit(source);
        assert.equal(found, count, file);
    }
});

test("existing editable sheets reuse standard geometry without a second constructor binding", () => {
    for (const file of ["mobile/util/openBacklinks.ts", "mobile/util/openReference.ts", "menus/commonMenuItem.ts"]) {
        const source = createSourceFile(file, readFileSync(`src/${file}`, "utf8"), ScriptTarget.Latest, true);
        let bound = 0;
        const visit = (node: import("typescript").Node) => {
            if (isCallExpression(node) && node.expression.getText(source) === "bindBottomSheetDialog") {
                assert.match(node.arguments[4].getText(source), /mode:\s*"standard"/);
                assert.match(node.arguments[4].getText(source), /expandable:\s*true/);
                bound++;
            }
            if (isNewExpression(node) && node.expression.getText(source) === "MobileEditorDialog") {
                assert.doesNotMatch(node.arguments[0].getText(source), /mobileSheet:/);
            }
            forEachChild(node, visit);
        };
        visit(source);
        assert.equal(bound, 1, file);
    }
    const reference = readFileSync("src/mobile/util/openReference.ts", "utf8");
    assert.doesNotMatch(reference, /container\.style\.(top|height)\s*=/);
    assert.match(reference, /dialog\.beforeClose = async/);
    assert.match(reference, /await sheet\.flush\(\)/);
});

test("desktop-only dialogs and mobile page replacements are not opted in", () => {
    for (const file of ["menus/importObsidian.ts", "menus/workspace.ts", "menus/layouts.ts",
        "menus/onGetnotebookconf.ts", "boot/globalEvent/command/panel.ts", "boot/globalEvent/keydown.ts",
        "editor/util.ts"]) {
        assert.doesNotMatch(readFileSync(`src/${file}`, "utf8"), /from "[^"\n]*mobile(?:Dialog|InputDialog|ConfirmDialog)"/, file);
    }
});
