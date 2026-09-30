import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isMethodDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getBlockTypeOptions, isSameTextRange} from "./blockTypeCore";

const source = transpileModule(readFileSync(resolve(process.cwd(), "src/protyle/toolbar/BlockType.ts"), "utf8"),
    {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;

const menuSource = createSourceFile("Menu.ts", readFileSync("src/menus/Menu.ts", "utf8"), ScriptTarget.ES2021, true);
const menuClass = menuSource.statements.find(statement => isClassDeclaration(statement) && statement.name?.text === "Menu");
const closeSheet = isClassDeclaration(menuClass) && menuClass.members.find(member =>
    isMethodDeclaration(member) && member.name.getText(menuSource) === "closeSheet").getText(menuSource);
const sheetExports = {} as {close: (this: object) => void};
runInNewContext(transpileModule(`class Sheet { ${closeSheet} } exports.close = Sheet.prototype.closeSheet;`,
    {compilerOptions: {target: ScriptTarget.ES2021}}).outputText, {
    exports: sheetExports,
    window: {setTimeout: () => { throw new Error("Keyboard restoration must stay in the close gesture"); }},
});

const setup = (mobile = false) => {
    const classes = new Set<string>();
    const block = {dataset: {nodeId: "target", type: "NodeParagraph", subtype: ""},
        style: {width: "", flex: ""}, closest: (): Element => null,
        parentElement: {classList: {contains: (value: string) => classes.has(value)}, querySelectorAll: () => [block]},
    } as unknown as HTMLElement;
    const range = {startContainer: {}, endContainer: {}, startOffset: 1, endOffset: 5,
        collapsed: false} as Range;
    const editorFocus = {};
    const protyle = {block: {rootID: "doc"}, wysiwyg: {element: {contains: (element: unknown) => element === editorFocus}}, toolbar: {range,
        element: {classList: {add: (): void => undefined}}, subElement: {classList: {add: (): void => undefined}}},
        disabled: false, lite: false} as unknown as IProtyle;
    const snapshot = {block, range};
    const items: IMenu[] = [];
    const transactions: Record<string, unknown>[] = [];
    const listeners = new Map<string, (event?: {target: unknown}) => void>();
    const state = {valid: true, current: true, mobile, readonly: false, restored: 0, closed: 0, mobileOpened: 0,
        selection: {rangeCount: 1, isCollapsed: false, getRangeAt: () => range},
        embed: undefined as {allowChildOperation: boolean, targetElement?: HTMLElement} | undefined};
    const menu = {close: (): void => undefined};
    const commonMenu = {
        restoreKeyboard: undefined as (() => void) | undefined,
        element: {classList: {contains: () => true}},
        fullscreen: (_position: string, restore: () => void) => {
            state.mobileOpened++;
            commonMenu.restoreKeyboard = restore;
        },
        removeImmediately: () => {
            menu.close();
            commonMenu.restoreKeyboard = undefined;
        },
    };
    class FakeMenu {
        isOpen = false;
        element = {contains: (): boolean => false};
        constructor(_id: string, private onClose: () => void) {
            menu.close = () => this.close();
        }
        addItem(item: IMenu) { items.push(item); }
        open() { return; }
        fullscreen() { state.mobileOpened++; }
        close() {
            state.closed++;
            this.onClose();
        }
    }
    const exports = {} as typeof import("./BlockType");
    const modules: Record<string, unknown> = {
        "../../plugin/Menu": {Menu: FakeMenu},
        "./ToolbarItem": {ToolbarItem: class {}},
        "./blockTypeCore": {
            getTextSelectionBlock: (context: {disabled: boolean, lite: boolean}) =>
                context.disabled || context.lite || !state.valid ? undefined : block,
            captureTextBlockSelection: () => snapshot,
            isTextBlockSelectionValid: () => state.valid,
            getBlockTypeOptions, isSameTextRange,
        },
        "../wysiwyg/getBlock": {getEmbedGutterOperationContext: () => state.embed},
        "../wysiwyg/transaction": {
            turnsIntoTransaction: (options: Record<string, unknown>) => transactions.push(options),
            turnsIntoOneTransaction: (options: Record<string, unknown>) => transactions.push(options),
        },
        "../util/selection": {focusByRange: () => state.restored++},
        "./subElementLifecycle": {closeSubElement: (): void => undefined},
        "../../util/escape": {escapeHtml: (value: string) => value},
        "../../util/functions": {isMobile: () => state.mobile},
    };
    const document = {
        activeElement: undefined as unknown,
        body: {},
        addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
        removeEventListener: (name: string) => listeners.delete(name),
    };
    runInNewContext(source, {exports,
        require: (name: string) => {
            assert.ok(modules[name], name);
            return modules[name];
        },
        document,
        window: {getSelection: () => state.selection,
            siyuan: {config: {get readonly() { return state.readonly; }},
                menus: {menu: commonMenu},
                languages: new Proxy({blockTypeParentChange: "Changes outer block"} as Record<string, string>,
                    {get: (target, key: string) => target[key] || key})}},
    });
    const button = {isConnected: true, contains: (): boolean => false,
        getBoundingClientRect: () => ({left: 0, bottom: 30, height: 30, width: 60})} as unknown as HTMLElement;
    const open = () => exports.openBlockTypeMenu(protyle, button, snapshot as Parameters<typeof exports.openBlockTypeMenu>[2],
        {isCurrent: () => state.current, onClose: () => state.restored++});
    const click = (key: string) => items.find(item => item.label.startsWith(key)).click({} as HTMLElement, {} as MouseEvent);
    return {block, protyle, snapshot, items, transactions, listeners, state, menu, classes, button, open, click,
        document, editorFocus, closeSheet: () => sheetExports.close.call(commonMenu)};
};

test("selecting the current type is a no-op including an existing heading", () => {
    for (const heading of [false, true]) {
        const fixture = setup();
        if (heading) {
            fixture.block.dataset.type = "NodeHeading";
            fixture.block.dataset.subtype = "h2";
        }
        fixture.open();
        fixture.click(heading ? "heading2" : "paragraph");
        assert.equal(fixture.transactions.length, 0);
    }
});

test("type actions pass exactly one explicit child and never invoke shortcut or batch selection", () => {
    for (const [key, type] of [["heading2", "Blocks2Hs"], ["list", "Blocks2ULs"], ["ordered-list", "Blocks2OLs"],
        ["check", "Blocks2TLs"], ["quote", "Blocks2Blockquote"], ["callout", "Blocks2Callout"]]) {
        const fixture = setup();
        fixture.open();
        fixture.click(key);
        assert.equal(fixture.transactions.length, 1);
        const operation = fixture.transactions[0];
        assert.equal(operation.type, type);
        assert.equal((operation.selectsElement as Element[]).length, 1);
        assert.equal((operation.selectsElement as Element[])[0], fixture.block);
        assert.equal(operation.nodeElement, undefined);
        assert.equal(operation.getOperations, undefined);
        assert.equal(fixture.state.restored, 0);
        assert.equal(fixture.listeners.size, 0);
    }
});

test("unsafe wrappers are disabled with a persistent reason and cannot send operations", () => {
    const fixture = setup(true);
    fixture.classes.add("sb");
    fixture.open();
    assert.equal(fixture.state.mobileOpened, 1);
    const option = fixture.items.find(item => item.label.startsWith("quote"));
    assert.equal(option.disabled, true);
    assert.match(option.label, /Changes outer block/);
    let accessibleLabel = "";
    option.bind({setAttribute: (_name: string, value: string) => { accessibleLabel = value; }} as HTMLElement);
    assert.match(accessibleLabel, /Changes outer block/);
    fixture.click("quote");
    assert.equal(fixture.transactions.length, 0);
});

test("execution rechecks safety after the menu opens", () => {
    for (const change of ["readonly", "disabled", "lite", "disconnected", "document", "selection", "superblock", "embed"]) {
        const fixture = setup();
        fixture.open();
        if (change === "readonly") { fixture.state.readonly = true; }
        if (change === "disabled") { fixture.protyle.disabled = true; }
        if (change === "lite") { fixture.protyle.lite = true; }
        if (change === "disconnected") { fixture.state.valid = false; }
        if (change === "document") { fixture.state.current = false; }
        if (change === "selection") {
            fixture.state.selection.getRangeAt = () => ({...fixture.snapshot.range, startOffset: 2});
        }
        if (change === "superblock") { fixture.classes.add("sb"); }
        if (change === "embed") {
            fixture.block.closest = () => ({}) as Element;
            fixture.state.embed = {allowChildOperation: false};
        }
        fixture.click("quote");
        assert.equal(fixture.transactions.length, 0, change);
    }
});

test("cancel restores a valid selection but does not revive an invalid or replaced selection", () => {
    for (const changed of [false, true]) {
        const fixture = setup(true);
        fixture.open();
        if (changed) {
            fixture.state.selection.getRangeAt = () => ({...fixture.snapshot.range, endOffset: 6});
            fixture.listeners.get("selectionchange")();
        }
        fixture.menu.close();
        assert.equal(fixture.state.restored, changed ? 0 : 1);
        assert.equal(fixture.listeners.size, 0);
        assert.equal(fixture.transactions.length, 0);
    }
});

test("closing the menu does not steal focus from a new caret, another input or an outside pointer", () => {
    for (const change of ["caret", "input", "pointer"]) {
        const fixture = setup();
        fixture.open();
        if (change === "caret") {
            fixture.document.activeElement = fixture.editorFocus;
            fixture.state.selection.isCollapsed = true;
            fixture.state.selection.getRangeAt = () => ({...fixture.snapshot.range, endOffset: 1, collapsed: true});
        } else if (change === "input") {
            fixture.document.activeElement = {};
        } else {
            fixture.listeners.get("pointerdown")({target: {}});
        }
        fixture.menu.close();
        assert.equal(fixture.state.restored, 0, change);
        assert.equal(fixture.listeners.size, 0);
    }
});

test("tapping the mobile scrim restores once through the real synchronous sheet close path", () => {
    const fixture = setup(true);
    fixture.open();
    fixture.listeners.get("pointerdown")({target: {closest: () => ({id: "commonMenuScrim"})}});
    fixture.closeSheet();
    assert.equal(fixture.state.restored, 1);
    assert.equal(fixture.listeners.size, 0);
    assert.equal(fixture.transactions.length, 0);
});
