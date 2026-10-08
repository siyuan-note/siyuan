import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const code = transpileModule(readFileSync(join(__dirname, "dailyNoteSelection.ts"), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

test("daily note insertion survives caret movement and repaint without overwriting changed input", () => {
    for (const scenario of ["unchanged", "moved", "repaint", "markers", "edited", "deleted", "other-document", "closed"]) {
        let originalText = "[[today";
        const original = {available: true, toString: () => originalText, cloneRange() { return {...this}; }};
        const caret = {available: true, toString: () => "", cloneRange() { return {...this}; }};
        let active = scenario === "unchanged" ? original : caret;
        let inserted = false;
        let restoredCurrent = false;
        const toolbar = {range: original, setInlineMark: (_protyle: unknown, type: string, _action: string,
                                                        options: {color: string}, focus: boolean): HTMLElement[] => {
            assert.equal(type, "block-ref");
            assert.ok(options.color.includes("Daily title"));
            assert.equal(focus, false);
            assert.equal(toolbar.range.toString().replace(/\u200b/g, ""), "[[today");
            inserted = true;
            return [];
        }};
        const protyle = {block: {rootID: "root"}, notebookId: "box", toolbar, wysiwyg: {element: {isConnected: true}}};
        const mocks: Record<string, unknown> = {
            "../../constants": {Constants: {ZWSP: "\u200b"}},
            "../../util/newFile": {getBlockRefAnchorText: (title: string) => title},
            "../util/inlineElementMarker": {stripSemanticMarkersFromRangeText: (range: typeof original) => range.toString()},
            "../../util/newFileSelection": {
                isRangeInEditor: (_editor: unknown, range: {available: boolean}) => range.available,
                isSameRange: (range: {toString: () => string}, target: {toString: () => string}) => range.toString() === target.toString(),
            },
            "../util/selection": {
                getUndoFocusContext: (_editor: unknown, range: unknown) => ({id: range === caret ? "caret" : "original"}),
                focusByRange: (range: typeof original) => { active = range; restoredCurrent = range.toString() === ""; },
                restoreFocusContext: (_protyle: unknown, context: {id: string}) => {
                    if (scenario === "deleted") { return false; }
                    active = context.id === "caret" ? caret : {available: true, toString: () => originalText, cloneRange() { return {...this}; }};
                    return true;
                },
            },
        };
        const exported = {};
        runInNewContext(code, {exports: exported, require: (path: string) => mocks[path],
            document: {getSelection: () => ({rangeCount: 1, getRangeAt: () => active})}});
        const functions = exported as {
            captureDailyNoteSelection: (protyle: unknown, range: unknown) => {range: {available: boolean}},
            insertDailyNoteReference: (protyle: unknown, target: unknown, id: string, title: string, staticRef: boolean) => void,
        };
        const target = functions.captureDailyNoteSelection(protyle, original);
        if (["repaint", "deleted"].includes(scenario)) { target.range.available = false; }
        if (scenario === "edited") { originalText = "edited input"; }
        if (scenario === "markers") { originalText = "\u200b[[today\u200b"; }
        if (scenario === "other-document") { protyle.block.rootID = "another"; }
        if (scenario === "closed") { protyle.wysiwyg.element.isConnected = false; }
        functions.insertDailyNoteReference(protyle, target, "created", "Daily title", false);
        assert.equal(inserted, ["unchanged", "moved", "repaint", "markers"].includes(scenario), scenario);
        if (["moved", "repaint", "edited"].includes(scenario)) { assert.equal(restoredCurrent, true, scenario); }
    }
});
