import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {test} from "node:test";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";

const source = compileModule("src/protyle/render/av/relatedView.ts") + "\nexports.RelatedAVView = RelatedAVView;";

const fixture = () => {
    const removed: string[] = [];
    let shared = 0;
    let configured = 0;
    const columnWidthAPI = evaluateModule<typeof import("./relatedViewColumnWidth")>(
        compileModule("src/protyle/render/av/relatedViewColumnWidth.ts"), {require: () => ({})});
    const {RelatedAVView} = evaluateModule<{RelatedAVView: {prototype: object}}>(source, {
        window: {siyuan: {languages: {avTemporarySort: "Temporary sort", _attrView: {
            relatedDatabaseViewTemporarySort: "Sort in this panel",
            relatedDatabaseViewTemporaryFilter: "Additional filters in this panel",
        }}}},
        require: (id: string) => id === "./relatedViewColumnWidth" ? columnWidthAPI :
            {globalClickHideMenu() {}, openMenuPanel: () => { configured++; }},
    });
    const labels = new Map<string, string>();
    const controls = ["av-more", "av-search", "av-sort", "av-filter", "av-switcher", "set-page-size"].map(type => ({
        type, remove: () => removed.push(type),
        setAttribute: (name: string, value: string) => { if (name === "aria-label") labels.set(type, value); },
    }));
    const view = Object.assign(Object.create(RelatedAVView.prototype), {
        host: {active: true, readonly: () => false}, columnWidths: {},
        element: {querySelector: () => ({disabled: false})},
        hostElement: {
            querySelector: (selector: string) => controls.find(control => selector === `[data-type="${control.type}"]`),
            querySelectorAll: (selector: string) => controls.filter(control =>
                selector.split(",").some(part => part.trim() === `[data-type="${control.type}"]`)),
        },
        openSharedView: () => { shared++; }, definition: {keyID: "relation"},
    });
    const click = (type?: string, header = false, action?: string) => view.click({
        stopPropagation() {}, target: {closest: (selector: string) => {
            if (selector === "[data-related-action]" && action) return {dataset: {relatedAction: action}};
            if (selector === "[data-type]") return {dataset: {type}};
            if (selector === ".av__cell--header, .av__calc" && header) return {};
            return null;
        }},
    });
    return {view, removed, labels, click, shared: () => shared, configured: () => configured};
};

test("related render removes the shared settings button while retaining local controls and paging", () => {
    const f = fixture();
    f.view.rendered({viewID: "table", viewType: "table", view: {columns: [], rows: []}});
    assert.deepEqual(f.removed, ["av-more"]);
    assert.equal(f.labels.get("av-sort"), "Sort in this panel");
    assert.equal(f.labels.get("av-filter"), "Additional filters in this panel");
});

test("removed settings actions are inert while remaining shared configuration entry points stay guarded", () => {
    const f = fixture();
    f.click("av-more");
    assert.equal(f.shared(), 0);
    f.click("set-page-size");
    f.click(undefined, true);
    assert.equal(f.shared(), 2);
    f.click(undefined, false, "configure");
    assert.equal(f.configured(), 1, "invalid related view retains its source relation repair control");
    f.view.host.active = false;
    f.click("set-page-size");
    assert.equal(f.shared(), 2);
});

test("shared configuration warning remains available in every language for retained safety guards", () => {
    const languages = readdirSync("appearance/langs").filter(file => file.endsWith(".json"));
    assert.equal(languages.length, 22);
    for (const file of languages) {
        const language = JSON.parse(readFileSync(`appearance/langs/${file}`, "utf8"));
        assert.ok(language._attrView.relatedDatabaseViewSharedTip, file);
    }
    for (const path of ["src/protyle/render/av/cell.ts", "src/protyle/render/av/openMenuPanel.ts",
        "src/protyle/wysiwyg/transaction.ts"]) {
        assert.match(readFileSync(path, "utf8"), /languages\._attrView\.relatedDatabaseViewSharedTip/);
    }
});
