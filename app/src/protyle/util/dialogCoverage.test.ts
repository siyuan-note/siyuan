import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, forEachChild, isCallExpression, isNewExpression, ScriptTarget, Node} from "typescript";

const coverage: Record<string, Record<string, number>> = {
    "protyle/breadcrumb/index.ts": {
        "confirmDialog": 2
    },
    "protyle/export/exportMd.ts": {
        "AdaptiveDialog": 1,
        "confirmDialog": 1
    },
    "protyle/export/headingPageBreaksUI.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/export/index.ts": {
        "confirmDialog": 3
    },
    "protyle/export/util.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/header/Background.ts": {
        "openInputDialog": 1
    },
    "protyle/header/coverPicker.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/header/documentTitleEditor.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/hint/extend.ts": {
        "confirmDialog": 1
    },
    "protyle/render/av/blockAttr.ts": {
        "confirmDialog": 1
    },
    "protyle/render/av/calc.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/render/av/calendar/jump.ts": {
        "openInputDialog": 1
    },
    "protyle/render/av/col.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/render/av/collectionConditions.ts": {
        "openInputDialog": 1
    },
    "protyle/render/av/collectionReference.ts": {
        "openInputDialog": 1
    },
    "protyle/render/av/collectionReview.ts": {
        "AdaptiveDialog": 1,
        "confirmDialog": 1
    },
    "protyle/render/av/colorDialog.ts": {
        "AdaptiveDialog": 1,
        "confirmDialog": 1
    },
    "protyle/render/av/kanban/groupMenu.ts": {
        "confirmDialog": 1
    },
    "protyle/render/av/openDatabaseRow.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/render/av/newItemTemplate.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/render/av/subItems.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/render/av/panels/edit.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/render/av/rowSort.ts": {
        "confirmDialog": 1
    },
    "protyle/render/av/select.ts": {
        "confirmDialog": 1
    },
    "protyle/toolbar/inlineStyleDialog.ts": {
        "AdaptiveDialog": 1,
        "confirmDialog": 1
    },
    "protyle/undo/globalUndo.ts": {
        "confirmDialog": 1
    },
    "protyle/upload/index.ts": {
        "confirmDialog": 2
    },
    "protyle/util/headingBatch.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/util/insertHTML.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/util/publishAccess.ts": {
        "AdaptiveDialog": 1
    },
    "protyle/util/table.ts": {
        "openInputDialog": 1
    },
    "protyle/util/collectionRemoval.ts": {
        "confirmDialog": 1
    },
    "protyle/wysiwyg/callout.ts": {
        "openInputDialog": 1
    },
    "protyle/wysiwyg/list.ts": {
        "openInputDialog": 1
    },
    "protyle/wysiwyg/taskStatusDialog.ts": {
        "openInputDialog": 1
    },
    "ai/actions.ts": {
        "AdaptiveDialog": 2
    },
    "ai/chat.ts": {
        "openInputDialog": 1
    },
    "ai/editor.ts": {
        "confirmDialog": 1
    },
    "ai/memory/manager.ts": {
        "AdaptiveDialog": 1,
        "confirmDialog": 2
    },
    "ai/skills/manager.ts": {
        "AdaptiveDialog": 1,
        "openInputDialog": 1
    },
    "card/makeCard.ts": {
        "AdaptiveDialog": 1,
        "confirmDialog": 1,
        "openInputDialog": 1
    },
    "card/openCard.ts": {
        "openInputDialog": 1,
        "AdaptiveDialog": 1
    },
    "card/viewCards.ts": {
        "AdaptiveDialog": 1,
        "confirmDialog": 1
    },
    "protyle/render/av/richTextEditor.ts": {
        "AdaptiveDialog": 1
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
        assert.match(source, /bindBottomSheetDialog[\s\S]*?\{canStart: \(\) => !saving && !closing\}/, file);
        assert.doesNotMatch(source, /new AdaptiveDialog/, file);
    }
    for (const file of ["newItemTemplate", "subItems"]) {
        const source = readFileSync("src/protyle/render/av/" + file + ".ts", "utf8");
        assert.equal((source.match(/new AdaptiveDialog/g) || []).length, 1, file);
        assert.doesNotMatch(source, /bindBottomSheetDialog/, file);
    }
    const exports = readFileSync("src/protyle/export/index.ts", "utf8");
    assert.match(exports, /const wordDialog = new Dialog/);
    const skills = readFileSync("src/ai/skills/manager.ts", "utf8");
    assert.match(skills, /mobile \? undefined : new Dialog/);
    assert.doesNotMatch(skills, /bindSkillDialogViewport/);
    for (const file of ["card/openCard.ts", "card/viewCards.ts", "protyle/render/av/openDatabaseRow.ts"]) {
        assert.match(readFileSync("src/" + file, "utf8"), /new AdaptiveDialog/, file);
    }
});
