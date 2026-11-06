import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, forEachChild, isCallExpression, isNewExpression, ScriptTarget, Node} from "typescript";

const coverage: Record<string, Record<string, number>> = {
    "protyle/breadcrumb/index.ts": {
        "mobileConfirmDialog": 2
    },
    "protyle/export/exportMd.ts": {
        "MobileDialog": 1,
        "mobileConfirmDialog": 1
    },
    "protyle/export/headingPageBreaksUI.ts": {
        "MobileDialog": 1
    },
    "protyle/export/index.ts": {
        "mobileConfirmDialog": 1
    },
    "protyle/export/util.ts": {
        "MobileDialog": 1
    },
    "protyle/header/Background.ts": {
        "mobileInputDialog": 1
    },
    "protyle/header/coverPicker.ts": {
        "MobileDialog": 1
    },
    "protyle/header/documentTitleEditor.ts": {
        "MobileDialog": 1
    },
    "protyle/hint/extend.ts": {
        "mobileConfirmDialog": 1
    },
    "protyle/render/av/blockAttr.ts": {
        "mobileConfirmDialog": 1
    },
    "protyle/render/av/calc.ts": {
        "MobileDialog": 1
    },
    "protyle/render/av/calendar/jump.ts": {
        "mobileInputDialog": 1
    },
    "protyle/render/av/col.ts": {
        "MobileDialog": 1
    },
    "protyle/render/av/collectionConditions.ts": {
        "mobileInputDialog": 1
    },
    "protyle/render/av/collectionReference.ts": {
        "mobileInputDialog": 1
    },
    "protyle/render/av/collectionReview.ts": {
        "MobileDialog": 1,
        "mobileConfirmDialog": 1
    },
    "protyle/render/av/colorDialog.ts": {
        "MobileDialog": 1,
        "mobileConfirmDialog": 1
    },
    "protyle/render/av/kanban/groupMenu.ts": {
        "mobileConfirmDialog": 1
    },
    "protyle/render/av/openDatabaseRow.ts": {
        "MobileDialog": 1
    },
    "protyle/render/av/newItemTemplate.ts": {
        "MobileDialog": 1
    },
    "protyle/render/av/subItems.ts": {
        "MobileDialog": 1
    },
    "protyle/render/av/panels/edit.ts": {
        "MobileDialog": 1
    },
    "protyle/render/av/rowSort.ts": {
        "mobileConfirmDialog": 1
    },
    "protyle/render/av/select.ts": {
        "mobileConfirmDialog": 1
    },
    "protyle/toolbar/inlineStyleDialog.ts": {
        "MobileDialog": 1,
        "mobileConfirmDialog": 1
    },
    "protyle/undo/globalUndo.ts": {
        "mobileConfirmDialog": 1
    },
    "protyle/upload/index.ts": {
        "mobileConfirmDialog": 1
    },
    "protyle/util/headingBatch.ts": {
        "MobileDialog": 1
    },
    "protyle/util/insertHTML.ts": {
        "MobileDialog": 1
    },
    "protyle/util/publishAccess.ts": {
        "MobileDialog": 1
    },
    "protyle/util/table.ts": {
        "mobileInputDialog": 1
    },
    "protyle/util/collectionRemoval.ts": {
        "mobileConfirmDialog": 1
    },
    "protyle/wysiwyg/callout.ts": {
        "mobileInputDialog": 1
    },
    "protyle/wysiwyg/list.ts": {
        "mobileInputDialog": 1
    },
    "protyle/wysiwyg/taskStatusDialog.ts": {
        "mobileInputDialog": 1
    },
    "ai/actions.ts": {
        "MobileDialog": 2
    },
    "ai/chat.ts": {
        "mobileInputDialog": 1
    },
    "ai/editor.ts": {
        "mobileConfirmDialog": 1
    },
    "ai/memory/manager.ts": {
        "MobileDialog": 1,
        "mobileConfirmDialog": 2
    },
    "ai/skills/manager.ts": {
        "MobileDialog": 1,
        "mobileInputDialog": 1
    },
    "card/makeCard.ts": {
        "MobileDialog": 1
    },
    "card/openCard.ts": {
        "mobileInputDialog": 1,
        "MobileDialog": 1
    },
    "card/viewCards.ts": {
        "MobileDialog": 1,
        "mobileConfirmDialog": 1
    },
    "protyle/render/av/richTextEditor.ts": {
        "MobileDialog": 1
    }
};

test("editor, AI and card business dialog entries opt into mobile adapters explicitly", () => {
    for (const [file, expected] of Object.entries(coverage)) {
        const source = createSourceFile(file, readFileSync("src/" + file, "utf8"), ScriptTarget.Latest, true);
        const actual: Record<string, number> = {};
        const visit = (node: Node) => {
            if (isCallExpression(node) || isNewExpression(node)) {
                const name = node.expression.getText(source);
                if (name in expected) actual[name] = (actual[name] || 0) + 1;
            }
            forEachChild(node, visit);
        };
        visit(source);
        assert.deepEqual(actual, expected, file);
    }
});

test("AV sheets use one adapter and desktop-only paths remain unmodified", () => {
    for (const file of ["locationEditor"]) {
        const source = readFileSync("src/protyle/render/av/" + file + ".ts", "utf8");
        assert.match(source, /bindBottomSheetDialog\([\s\S]*?\{mode: "standard"(?:, canStart: \(\) => !saving && !closing)?\}/, file);
        assert.doesNotMatch(source, /new MobileDialog/, file);
    }
    for (const file of ["newItemTemplate", "subItems"]) {
        const source = readFileSync("src/protyle/render/av/" + file + ".ts", "utf8");
        assert.equal((source.match(/new MobileDialog/g) || []).length, 1, file);
        assert.doesNotMatch(source, /bindBottomSheetDialog/, file);
    }
    const exports = readFileSync("src/protyle/export/index.ts", "utf8");
    assert.match(exports, /const wordDialog = new Dialog/);
    const skills = readFileSync("src/ai/skills/manager.ts", "utf8");
    assert.match(skills, /mobile \? undefined : new Dialog/);
    assert.doesNotMatch(skills, /bindSkillDialogViewport/);
    for (const file of ["card/openCard.ts", "card/viewCards.ts", "protyle/render/av/openDatabaseRow.ts"]) {
        assert.match(readFileSync("src/" + file, "utf8"), /mobileSheet: \{mode: "expanded"(?:,\s*beforeClose: [^\n]+)?\}/, file);
    }
});
