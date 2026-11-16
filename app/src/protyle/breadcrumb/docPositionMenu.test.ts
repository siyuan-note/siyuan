import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import test from "node:test";
import {getEntryCatalogChildren, getEntryCatalogNode} from "../../config/entryVisibility/catalog";

const {parse} = require("ifdef-loader/preprocessor");
const source = readFileSync(join(__dirname, "index.ts"), "utf8");
const attr = "custom-sy-restore-doc-position";
for (const mobile of [false, true]) {
    test(`document position menu persists three states with checked items (${mobile ? "mobile" : "desktop"})`, () => {
        const compiled = parse(source, {MOBILE: mobile, BROWSER: true}, false, true);
        const start = compiled.indexOf("                    if (!protyle.disabled) {\n                        const position =");
        assert.ok(start >= 0);
        const end = compiled.indexOf("\n                    }", start) + "\n                    }".length;
        const snippet = compiled.slice(start, end);
        for (const value of [null, "", "true", "false", "unknown"]) {
            const items: IMenu[] = [];
            const writes: unknown[] = [];
            const protyle = {disabled: false, block: {rootID: "doc"},
                wysiwyg: {element: {getAttribute: () => value}}};
            const globals = {protyle, Constants: {CUSTOM_SY_RESTORE_DOC_POSITION: attr},
                window: {siyuan: {languages: {docOpenPosition: "Position", default: "Default", restoreDocPosition: "Restore", docOpenAtStart: "Start"},
                    menus: {menu: {append: (item: IMenu) => items.push(item)}}}},
                MenuItem: class {element: IMenu; constructor(options: IMenu) { this.element = options; }},
                fetchPost: (...args: unknown[]) => writes.push(args)};
            runInNewContext(snippet, globals);
            assert.equal(items.length, 1);
            const menu = items[0];
            assert.equal(menu.type, "submenu");
            assert.equal(menu.submenu[0].label, "Default");
            assert.deepEqual(Array.from(menu.submenu, item => item.id), ["default", "restore", "start"]);
            const selected = value === "true" ? "restore" : value === "false" ? "start" : "default";
            assert.deepEqual(Array.from(menu.submenu.filter(item => item.current), item => item.id), [selected]);
            menu.submenu.forEach(item => item.click(null, null));
            assert.deepEqual(JSON.parse(JSON.stringify(writes)), ["", "true", "false"].map(setting =>
                ["/api/attr/setBlockAttrs", {id: "doc", attrs: {[attr]: setting}}]));
            protyle.disabled = true;
            items.length = 0;
            runInNewContext(snippet, globals);
            assert.equal(items.length, 0);
        }
        const path = "document.more.docOpenPosition";
        assert.equal(getEntryCatalogNode(path).simple, true);
        assert.deepEqual(getEntryCatalogChildren(path).map(item => item.key), ["default", "restore", "start"]);
        const siblings = getEntryCatalogChildren("document.more").map(item => item.key);
        assert.equal(siblings[siblings.indexOf("docOpenPosition") + 1], "fullWidth");
    });
}
