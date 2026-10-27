import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isIfStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeHtml} from "../../util/escape";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [false, true]) {
    test(`embed popover menus preserve result targets in the ${mobile ? "mobile" : "desktop"} build`, () => {
        const panels: Array<{targetElement: HTMLElement; refDefs: Array<{refID: string}>}> = [];
        const opens: unknown[][] = [];
        const constants = {CB_GET_HL: 1, CB_GET_CONTEXT: 2, CB_GET_ROOTSCROLL: 3};
        const owner = {app: {}} as IProtyle;
        const api = {} as typeof import("./embedOpenMenu");
        const dependencies = {
            Constants: constants, escapeHtml,
            BlockPanel: class {constructor(options: typeof panels[number]) { panels.push(options); }},
            openMobileFileById: (...args: unknown[]) => opens.push(args),
        };
        const window = {siyuan: {languages: {refPopover: "Open in popover"}, blockPanels: [] as unknown[]}};
        runInNewContext(transpileModule(parse(readFileSync("src/protyle/gutter/embedOpenMenu.ts", "utf8"),
            {MOBILE: mobile, BROWSER: true}, false, true), {compilerOptions: {module: ModuleKind.CommonJS}}).outputText,
        {exports: api, window, require: () => dependencies});
        const result = (id: string, text: string) => ({dataset: {id}, querySelector: () => ({textContent: text})}) as unknown as HTMLElement;
        const first = result("first", "<script> & first");
        const second = result("second", "Second");
        let results: HTMLElement[] = [];
        const embed = {querySelectorAll: () => results} as unknown as Element;
        assert.equal(api.embedOpenMenu(owner, embed).disabled, true);
        api.openEmbedBlock(owner, first, "");
        assert.equal(opens.length + panels.length, 0);
        results = [first];
        const single = api.embedOpenMenu(owner, embed);
        assert.equal(single.id, "refPopover");
        assert.equal(single.disabled, false);
        assert.equal(single.submenu, undefined);
        single.click(undefined, undefined);
        results = [first, second];
        const menu = api.embedOpenMenu(owner, embed);
        assert.equal(menu.click, undefined);
        assert.deepEqual(Array.from(menu.submenu, item => item.id), ["first", "second"]);
        assert.equal(menu.submenu[0].label, "&lt;script> &amp; first");
        menu.submenu[1].click(undefined, undefined);
        if (mobile) {
            assert.equal(panels.length, 0);
            assert.deepEqual(Array.from(opens, args => [args[0], args[1], Array.from(args[2] as number[]), args[3]]), [
                [owner.app, "first", [1, 2, 3], "start"], [owner.app, "second", [1, 2, 3], "start"],
            ]);
        } else {
            assert.equal(opens.length, 0);
            assert.deepEqual(panels.map(panel => panel.targetElement), [first, second]);
            assert.deepEqual(panels.map(panel => panel.refDefs[0].refID), ["first", "second"]);
        }
    });
}

test("the shared block menu exposes popovers in editable and read-only embeds", () => {
    const source = createSourceFile("index.ts", readFileSync("src/protyle/gutter/index.ts", "utf8"), ScriptTarget.Latest, true);
    let branch = "";
    const visit = (node: import("typescript").Node) => {
        if (isIfStatement(node) && node.expression.getText(source) === 'type === "NodeBlockQueryEmbed"') {
            branch = node.thenStatement.getText(source);
        }
        node.forEachChild(visit);
    };
    visit(source);
    assert.ok(branch);
    const owner = {disabled: false};
    const embed = {getAttribute: () => ""};
    const items: IMenu[] = [];
    const window = {siyuan: {languages: {}, menus: {menu: {append: (item: IMenu) => items.push(item)}}}};
    const dependencies = {window,
        MenuItem: class {public element: IMenu; constructor(item: IMenu) { this.element = item; }},
        embedOpenMenu: () => ({id: "refPopover"}), embedBreadcrumbMenu: (): IMenu[] => [],
        isHeadingEmbed: () => false, getEmbedHeadingLevel: () => 0,
    };
    const render = new Function("protyle", "nodeElement", ...Object.keys(dependencies),
        transpileModule(branch, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText);
    for (const readonly of [false, true]) {
        owner.disabled = readonly;
        items.length = 0;
        render(owner, embed, ...Object.values(dependencies));
        const children = items.find(item => item.id === "blockEmbed").submenu;
        assert.ok(children.some(item => item.id === "refPopover"));
        assert.equal(children.some(item => item.id === "update"), !readonly);
        assert.deepEqual(children.slice(0, readonly ? 1 : 3).map(item => item.id),
            readonly ? ["refPopover"] : ["refresh", "update", "refPopover"]);
    }
});
