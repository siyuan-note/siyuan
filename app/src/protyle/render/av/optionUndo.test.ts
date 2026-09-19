import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const selectSource = readFileSync("src/protyle/render/av/select.ts", "utf8");
const kanbanSource = readFileSync("src/protyle/render/av/kanban/groupMenu.ts", "utf8");
const compile = (source: string) => transpileModule(source, {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const selectCode = compile(selectSource.slice(selectSource.indexOf("export const setColOption ="),
    selectSource.indexOf("export const bindSelectEvent =")));
const kanbanCode = compile(kanbanSource.slice(kanbanSource.indexOf("export const openKanbanGroupMenu =")));

const setupOptionMenu = (kanban = false) => {
    const options = [{name: "A", color: "1", desc: "Original"}, {name: "B", color: "2", desc: "Target"}];
    const fields = [{id: "field", options}];
    const input = {value: "A", select: () => {}};
    const description = {value: "Original"};
    const items: any[] = [];
    const transactions: {operations: any[], inverse: any[]}[] = [];
    let closeMenu: () => void;
    const menuElement = {querySelector: (selector: string) => {
        if (selector === ".b3-chips") {
            return null;
        }
        return {scrollTop: 0, getAttribute: () => "field"};
    }};
    const blockElement = {
        getAttribute: (name: string) => ({"data-node-id": "carrier", "data-av-id": "database", "data-av-type": "table"})[name],
        querySelector: () => ({dataset: {groupOptions: JSON.stringify(options)}}),
    };
    const optionElement = {dataset: {name: "A", desc: "Original", color: "1", colId: "field", groupId: "group"}};
    const target = {
        ...optionElement,
        parentElement: optionElement,
        closest: () => optionElement,
        getBoundingClientRect: () => ({left: 0, right: 0, bottom: 0, width: 0, height: 0}),
    };
    const exports: any = {};
    runInNewContext(kanban ? kanbanCode : selectCode, {
        exports,
        Constants: {},
        window: {siyuan: {languages: {}}},
        Menu: class {
            element = {querySelector: (selector: string) => selector === "input" ? input : description};
            constructor(_id: string, onClose: () => void) {
                closeMenu = onClose;
            }
            addItem(item: any) { items.push(item); }
            addSeparator() {}
            open() {}
        },
        hasClosestByClassName: () => menuElement,
        getFieldsByData: () => fields,
        getAVData: () => ({id: "database"}),
        applyAVColorPalette: () => {},
        getAVCustomColors: (): string[] => [],
        getAVColorOrder: (): string[] => [],
        getAVColorGridHTML: () => "",
        escapeAriaLabel: (text: string) => text,
        escapeAttr: (text: string) => text,
        escapeHtml: (text: string) => text,
        dayjs: () => ({format: () => "20260916120000"}),
        confirmDialog: (_title: string, _text: string, confirm: () => void) => confirm(),
        transaction: (_protyle: any, operations: any[], inverse: any[]) => transactions.push({operations, inverse}),
        getEditHTML: () => "",
        bindEditEvent: () => {},
        isMobile: () => false,
    });
    if (kanban) {
        exports.openKanbanGroupMenu({protyle: {}, blockElement, target});
    } else {
        exports.setColOption({}, {id: "database"}, target, blockElement, false);
    }
    return {options, input, description, items, transactions, closeMenu: () => closeMenu()};
};

for (const kanban of [false, true]) {
    test(`${kanban ? "kanban group" : "select option"} deletion preserves the complete inverse and carrier`, () => {
        const menu = setupOptionMenu(kanban);
        const original = JSON.parse(JSON.stringify(menu.options));
        menu.items.find(item => item.icon === "iconTrashcan").click();
        const {operations, inverse} = menu.transactions[0];
        assert.equal(operations[0].action, "removeAttrViewColOption");
        assert.equal(inverse[0].action, "updateAttrViewColOptions");
        for (const operation of [operations[0], inverse[0]]) {
            assert.equal(operation.avID, "database");
            assert.equal(operation.id, "field");
            assert.equal(operation.blockID, "carrier");
        }
        if (!kanban) {
            assert.deepEqual(menu.options.map(option => option.name), ["B"]);
            menu.options[0].color = "3";
        }
        assert.deepEqual(JSON.parse(JSON.stringify(inverse[0].data)), original);
    });
}

test("merging an option identifies its source and destination within the same database carrier", () => {
    const menu = setupOptionMenu();
    menu.input.value = "B";
    menu.description.value = "Target";
    menu.closeMenu();
    const {operations, inverse} = menu.transactions[0];
    for (const operation of [operations[0], inverse[0]]) {
        assert.equal(operation.action, "updateAttrViewColOption");
        assert.equal(operation.avID, "database");
        assert.equal(operation.id, "field");
        assert.equal(operation.blockID, "carrier");
    }
    assert.equal(operations[0].data.oldName, "A");
    assert.equal(operations[0].data.newName, "B");
    assert.equal(inverse[0].data.oldName, "B");
    assert.equal(inverse[0].data.newName, "A");
    assert.deepEqual(menu.options.map(option => option.name), ["A", "B"]);
});
