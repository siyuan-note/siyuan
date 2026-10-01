import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as escape from "../../../util/escape";
import {getAVHeaderEditingState} from "./headerEditing";

before(() => {
    Object.assign(globalThis, {
        window: {
            siyuan: {
                languages: {
                    delete: "Delete",
                    editFields: "Edit fields",
                    new: "New",
                    template: "Template",
                },
            },
        },
    });
});

describe("database header editing controls", () => {
    it("keeps editing controls in the DOM when the editor is read-only", () => {
        const state = getAVHeaderEditingState(false);

        assert.equal(state.contenteditable, "false");
        assert.match(state.newItemHTML, /class="av__new fn__flex"/);
        assert.match(state.selectionHTML, /data-type="av-selection-edit"/);
    });

    it("omits editing controls in a context that does not support editing", () => {
        const state = getAVHeaderEditingState(false, false);

        assert.equal(state.newItemHTML, "");
        assert.equal(state.selectionHTML, "");
    });
});

describe("database default item templates", () => {
    const compiled = ts.transpileModule(readFileSync(join(__dirname, "render.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
    const renderHeader = (mobile: boolean, layout: TAVView, itemTemplate?: IAVNewItemTemplate,
                          defaultTemplateID = itemTemplate?.id || "") => {
        const module = {exports: {}};
        const mocks: Record<string, unknown> = {
            "../../../util/escape": escape,
            "../../../util/functions": {isMobile: () => mobile},
            "./view": {getFieldsByData: (): IAVColumn[] => [], getViewIcon: () => "iconTable"},
            "./viewVisibility": {
                getAVVisibleViewIDs: () => ["view"], serializeAVViewPageSizes: () => "{}",
            },
            "./headerEditing": {getAVHeaderEditingState},
            "./contextFilterState": {getContextFilterKeyID: () => ""},
        };
        runInNewContext(compiled, {
            module, exports: module.exports, require: (id: string) => mocks[id] || {},
            window: {siyuan: {languages: {_kernel: {}}, config: {editor: {spellcheck: false}}}},
        });
        const data = {
            viewID: "view", views: [{id: "view", type: layout, name: "View"}],
            view: {filters: [], sorts: []}, newItemTemplates: itemTemplate ? [itemTemplate] : [],
            defaultTemplateID,
        } as IAV;
        const block = {classList: {contains: () => true}} as unknown as Element;
        return (module.exports as typeof import("./render")).genTabHeaderHTML(data, false, true, block);
    };

    it("keeps icon-only default templates available to creation buttons on desktop and mobile", () => {
        for (const mobile of [false, true]) {
            for (const layout of ["table", "list", "gallery", "kanban", "calendar"] as TAVView[]) {
                for (const icon of ["1f600", "/emojis/custom.svg"]) {
                    const html = renderHeader(mobile, layout, {
                        id: "icon-template", name: "Icon", targetType: "detached", icon,
                    });
                    assert.match(html, /data-default-template-id="icon-template"/);
                    assert.match(html, /data-type="av-add-more"/);
                }
            }
        }
    });

    it("keeps blank creation available for empty, missing or unselected templates", () => {
        const empty: IAVNewItemTemplate = {id: "empty", name: "Empty", targetType: "detached", icon: ""};
        for (const mobile of [false, true]) {
            assert.match(renderHeader(mobile, "table", empty), /data-default-template-id=""/);
            assert.match(renderHeader(mobile, "table", undefined, "missing"), /data-default-template-id=""/);
            assert.match(renderHeader(mobile, "table", {...empty, icon: "1f600"}, ""), /data-default-template-id=""/);
        }
    });
});
