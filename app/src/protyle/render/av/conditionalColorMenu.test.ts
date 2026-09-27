import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {moveConditionalColorRule} from "./conditionalColor";

test("returning from the color menu during field loading does not restore or bind a detached panel", async () => {
    let finishLoading: () => void;
    const loading = new Promise<void>(resolve => { finishLoading = resolve; });
    const methods = {} as typeof import("./conditionalColorMenu");
    const content = {
        isConnected: true,
        querySelector: () => ({}),
        addEventListener: () => assert.fail("must not bind a closed panel"),
    };
    const menu = {
        innerHTML: "view settings", classList: {add() {}, remove() {}},
        querySelector: () => content,
    };
    let resized = 0;
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/conditionalColorMenu.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        window: {siyuan: {config: {}, languages: {conditionalColors: "Colors"}}},
        require: (name: string) => name === "./filter" ? {prepareFilterColumns: () => loading} : {},
    });
    const pending = methods.openConditionalColorsMenu({
        protyle: {options: {}} as IProtyle,
        blockElement: {} as HTMLElement,
        data: {view: {conditionalColors: []}} as IAV,
        menuElement: menu as unknown as HTMLElement,
        onResize: () => { resized++; },
    });
    assert.match(menu.innerHTML, /data-type="go-config"/);
    content.isConnected = false;
    menu.innerHTML = "view settings";
    finishLoading();
    await pending;
    assert.equal(menu.innerHTML, "view settings");
    assert.equal(resized, 1);
});

test("dropping a rule saves the new priority with an undo snapshot and SVG deletion remains clickable", async () => {
    const methods = {} as typeof import("./conditionalColorMenu");
    const listeners = new Map<string, (event: unknown) => void>();
    const transactions: Array<{perform: IOperation[], undo: IOperation[]}> = [];
    const source = {dataset: {ruleId: "a"}, style: {opacity: ".38"}};
    const target = {dataset: {ruleId: "c"}, getBoundingClientRect: () => ({top: 100, height: 40})};
    const root = {
        innerHTML: "", contains: (element: unknown) => element === source || element === target,
        querySelectorAll: (): HTMLElement[] => [],
        addEventListener: (type: string, callback: (event: unknown) => void) => listeners.set(type, callback),
    };
    const content = {
        isConnected: true,
        querySelector: (selector: string) => selector === "[data-rules]" ? root : {disabled: false},
        addEventListener: (type: string, callback: (event: unknown) => void) => listeners.set(type, callback),
    };
    const window = {siyuan: {config: {}, languages: {}, dragElement: source}};
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/conditionalColorMenu.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods, window,
        require: (name: string) => ({
            "./filter": {prepareFilterColumns: async () => {}},
            "./view": {getFieldsByData: () => [{id: "text", type: "text"}]},
            "../../../util/escape": {escapeAttr: String},
            "./conditionalColor": {getConditionalBackground: () => "", moveConditionalColorRule},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[]) => {
                transactions.push({perform, undo});
            }},
        })[name] || {},
    });
    const rules: IAVConditionalColorRule[] = ["a", "b", "c"].map(id => ({id, target: "item", color: null,
        matchOption: false, filter: {column: "text", operator: "Is not empty"}}));
    await methods.openConditionalColorsMenu({
        protyle: {options: {}} as IProtyle,
        blockElement: {dataset: {nodeId: "carrier"}} as unknown as HTMLElement,
        data: {id: "database", viewID: "view", view: {conditionalColors: rules}} as IAV,
        menuElement: {classList: {add() {}, remove() {}}, querySelector: () => content} as unknown as HTMLElement,
        onResize() {},
    });
    assert.match(root.innerHTML, /draggable="true" data-conditional-drag/);
    assert.match(root.innerHTML, /b3-menu__action b3-menu__action--show/);
    assert.match(root.innerHTML, /b3-menu__action--warning/);
    assert.doesNotMatch(root.innerHTML, /data-action="(?:up|down)"/);
    const event = {target: {closest: () => target}, clientY: 139, preventDefault() {}, stopPropagation() {}};
    listeners.get("drop")(event);
    const ids = (operation: IOperation) => {
        assert.equal(operation.action, "setAttrViewConditionalColors");
        return Array.from(operation.data as IAVConditionalColorRule[], item => item.id);
    };
    assert.deepEqual(ids(transactions[0].perform[0]), ["b", "c", "a"]);
    assert.deepEqual(ids(transactions[0].undo[0]), ["a", "b", "c"]);
    assert.equal(source.style.opacity, "");
    assert.equal(window.siyuan.dragElement, undefined);
    const remove = {dataset: {action: "remove"}, tagName: "svg", closest: () => source};
    listeners.get("click")({...event, target: {closest: () => remove}});
    assert.deepEqual(ids(transactions[1].perform[0]), ["b", "c"]);
    assert.deepEqual(ids(transactions[1].undo[0]), ["b", "c", "a"]);
});
