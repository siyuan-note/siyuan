import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {describe, it} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../../../../util/escape";
import * as locationValue from "../locationValue";
import * as protocol from "./protocol";
import {getMapSettings} from "./state";
import {DOMElement, DOMFixture, requireFixture} from "./testDOM";

const compile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;

const setup = () => {
    const document = new DOMFixture();
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    document.body.append(editor);
    const otherEditor = document.createElement("div");
    otherEditor.className = "protyle-wysiwyg";
    document.body.append(otherEditor);
    const block = document.createElement("div");
    block.dataset.nodeId = "carrier";
    block.dataset.avId = "database";
    block.setAttribute("custom-sy-av-view", "map-view");
    block.setAttribute("updated", "20261010120000");
    block.setAttribute("data-render", "true");
    editor.append(block);
    const canvas = document.createElement("div");
    block.append(canvas);
    const protyle = {options: {}, notebookId: "notebook"} as IProtyle;
    const data = {id: "database", viewID: "map-view", viewType: "map", view: {
        columns: [{id: "location", name: "Location", type: "location"}], map: {locationKeyID: "location"}, rows: [],
    }} as IAV;
    const view = data.view as IAVTable;
    const sharedMenu = {data: undefined as Element, element: document.createElement("div"), remove: () => {}};
    sharedMenu.element.classList.add("fn__none");
    const context = {siyuan: {
        menus: {menu: sharedMenu},
        isPublish: false,
        config: {readonly: false},
        notebooks: [{id: "notebook", encrypted: true, closed: false}],
        languages: new Proxy<Record<string, string>>({}, {get: (_target, key: string) => key}),
    }};
    const copied: string[] = [];
    const opened: Array<Parameters<typeof import("../openDatabaseRow").openDatabaseRowByData>[1]> = [];
    const transactions: Array<{perform: IOperation[]; undo: IOperation[]; callback: () => void; resolve: () => void}> = [];
    const menus: MenuStub[] = [];
    let current = true;
    let pending = Promise.resolve();
    let nextID = 0;
    let renders = 0;
    let throwTransaction = false;
    class MenuStub {
        items: Array<{option: IMenu; element: DOMElement}> = [];
        closes = 0;
        position: IPosition;
        constructor(_id?: string, private onClose?: () => void) { sharedMenu.remove(); menus.push(this); }
        addItem(option: IMenu) {
            const element = document.createElement("button");
            element.innerHTML = option.label || "";
            document.body.append(element);
            this.items.push({option, element});
            return element;
        }
        open(position: IPosition) { this.position = position; sharedMenu.element.classList.remove("fn__none"); }
        close() {
            if (this.closes) return;
            this.closes++;
            sharedMenu.data = undefined;
            sharedMenu.element.classList.add("fn__none");
            this.items.forEach(item => item.element.remove());
            this.onClose?.();
        }
        item(label: string) { return this.items.find(item => item.option.label === label); }
        click(label: string) {
            const item = this.item(label);
            assert.ok(item, `Missing point menu item: ${label}`);
            return item.option.click?.(item.element as unknown as HTMLElement, {} as MouseEvent);
        }
    }
    sharedMenu.remove = () => {
        menus[menus.length - 1]?.close();
        sharedMenu.data = undefined;
        sharedMenu.element.classList.add("fn__none");
    };
    const menuToggle = {} as typeof import("../../../../menus/menuToggle");
    runInNewContext(compile("src/menus/menuToggle.ts"), {exports: menuToggle, window: context});
    const modules: Record<string, unknown> = {
        dayjs: () => ({format: () => "20261011090000"}),
        "../../../../plugin/Menu": {Menu: MenuStub},
        "../../../../menus/menuToggle": menuToggle,
        "../../../../menus/Menu": {MenuItem: class {}},
        "../../../../util/escape": escape,
        "../../../../util/functions": {isMobile: () => false},
        "../../../util/compatibility": {writeText: (text: string) => copied.push(text)},
        "../../../util/transactionQueue": {waitForPendingTransactions: () => pending},
        "../../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[],
            options: {callback: () => void}) => {
            if (throwTransaction) throw new Error("Transaction rejected");
            pending = new Promise(resolve => transactions.push({perform, undo, callback: options.callback, resolve}));
        }},
        "../filteredTip": {
            getAVFilteredTipContext: (scope: string, owner: IProtyle) => {
                assert.equal(scope, "target");
                assert.equal(owner, protyle);
                return {filteredTipScope: "target", filteredTipToken: "filtered-token"};
            },
            getAVViewID: (element: DOMElement) => element.getAttribute("custom-sy-av-view"),
        },
        "../locationValue": locationValue,
        "../openDatabaseRow": {openDatabaseRowByData: (_protyle: IProtyle, value: typeof opened[number]) => opened.push(value)},
        "../render": {avRender: () => { renders++; }},
        "./protocol": protocol,
        "./state": {getMapSettings},
    };
    const settings = {} as typeof import("./settings");
    runInNewContext(compile("src/protyle/render/av/map/settings.ts"), {
        exports: settings, require: requireFixture(modules), window: context,
    });
    modules["./settings"] = settings;
    const methods = {} as typeof import("./pointPicking");
    runInNewContext(compile("src/protyle/render/av/map/pointPicking.ts"), {
        exports: methods, require: requireFixture(modules), window: context, Lute: {NewNodeID: () => `generated-${++nextID}`},
    });
    const binding = methods.bindMapPointPicking({canvas: canvas as unknown as HTMLElement,
        blockElement: block as unknown as HTMLElement, protyle, data, current: () => current});
    return {binding, methods, block, canvas, data, view, context, protyle, copied, opened, transactions, menus,
        stale: () => { current = false; },
        reparent: () => otherEditor.append(block),
        setTransactionFailure: (fail: boolean) => { throwTransaction = fail; },
        renders: () => renders,
        menu: () => menus[menus.length - 1],
        settle: () => new Promise<void>(resolve => setImmediate(resolve)),
        complete: async (success = true) => {
            const batch = transactions[transactions.length - 1];
            if (success) batch.callback();
            batch.resolve();
            await new Promise<void>(resolve => setImmediate(resolve));
        },
        create: (location: IAVCellLocationValue = {longitude: 120.5, latitude: 30.25}) =>
            methods.createMapRecordAtPoint({protyle, blockElement: block as unknown as HTMLElement,
                avID: "database", viewID: "map-view", locationKeyID: "location", location, current: () => current}),
    };
};

describe("map point actions", () => {
    it("copies canonical WGS84 text and only uses escaped names already held in the parent view", () => {
        const scenario = setup();
        const location = {name: ' <img src=x onerror="alert(1)"> & Office ', longitude: 120.5, latitude: 30.25,
            originalInput: "Private source"};
        scenario.view.rows.push({id: "row", cells: [{value: {type: "location", keyID: "location", location}}]} as IAVRow);
        scenario.binding.show({longitude: 120.5, latitude: 30.25, name: "Untrusted supplier name"} as protocol.AVMapCoordinate);
        const menu = scenario.menu();
        const canonical = locationValue.getAVLocationText(location);
        assert.equal(menu.items[1].option.label, escape.escapeHtml(canonical));
        assert.equal(menu.items[1].element.children.length, 0);
        assert.equal(menu.position.target, scenario.canvas);
        menu.click("copy");
        assert.deepEqual(scenario.copied, [canonical]);
        assert.match(canonical, /30\.25, 120\.5 \[WGS84\]$/);
        assert.doesNotMatch(canonical, /Private source|Untrusted supplier/);
        assert.equal(scenario.transactions.length, 0);
    });

    it("offers copying without creation in readonly, published and history contexts", () => {
        for (const mode of ["readonly", "global-readonly", "published", "created", "snapshot"]) {
            const scenario = setup();
            if (mode === "readonly") scenario.protyle.disabled = true;
            else if (mode === "global-readonly") scenario.context.siyuan.config.readonly = true;
            else if (mode === "published") scenario.context.siyuan.isPublish = true;
            else scenario.protyle.options.history = {[mode]: "history"};
            scenario.binding.show({longitude: 0, latitude: 0});
            assert.equal(scenario.menu().item("mapCreateAtPoint"), undefined);
            scenario.menu().click("copy");
            assert.deepEqual(scenario.copied, ["0, 0 [WGS84]"]);
            assert.equal(scenario.transactions.length, 0);
        }
    });

    it("never exposes actions for invalid points or a stale, detached, reidentified, switched or locked owner", () => {
        for (const point of [{longitude: 181, latitude: 0}, {longitude: NaN, latitude: 0},
            {longitude: 0, latitude: 86}, {longitude: 0, latitude: Infinity},
            {longitude: 0, latitude: 0, coordinateSystem: "GCJ02"}]) {
            const scenario = setup();
            scenario.binding.show(point);
            assert.equal(scenario.menus.length, 0);
        }
        for (const mode of ["stale", "detached", "carrier", "database", "view", "field", "editor", "notebook", "locked"]) {
            const scenario = setup();
            if (mode === "stale") scenario.stale();
            else if (mode === "detached") scenario.block.remove();
            else if (mode === "carrier") scenario.block.dataset.nodeId = "other-carrier";
            else if (mode === "database") scenario.block.dataset.avId = "other-database";
            else if (mode === "view") scenario.block.setAttribute("custom-sy-av-view", "other-view");
            else if (mode === "field") scenario.view.map.locationKeyID = "other-field";
            else if (mode === "editor") scenario.reparent();
            else if (mode === "notebook") scenario.protyle.notebookId = "other-notebook";
            else scenario.context.siyuan.notebooks[0].closed = true;
            scenario.binding.show({longitude: 0, latitude: 0});
            assert.equal(scenario.menus.length, 0, mode);
        }
    });

    it("revalidates owner and editability before actions from an already open menu", () => {
        for (const mode of ["stale", "view", "editor", "notebook", "locked", "readonly", "global-readonly", "published", "history"]) {
            const scenario = setup();
            scenario.binding.show({longitude: 0, latitude: 0});
            if (mode === "stale") scenario.stale();
            else if (mode === "view") scenario.block.setAttribute("custom-sy-av-view", "other-view");
            else if (mode === "editor") scenario.reparent();
            else if (mode === "notebook") scenario.protyle.notebookId = "other-notebook";
            else if (mode === "locked") scenario.context.siyuan.notebooks[0].closed = true;
            else if (mode === "readonly") scenario.protyle.disabled = true;
            else if (mode === "global-readonly") scenario.context.siyuan.config.readonly = true;
            else if (mode === "published") scenario.context.siyuan.isPublish = true;
            else scenario.protyle.options.history = {created: "history"};
            scenario.menu().click("mapCreateAtPoint");
            assert.equal(scenario.transactions.length, 0, mode);
            if (["stale", "view", "editor", "notebook", "locked"].includes(mode)) {
                scenario.menu().click("copy");
                assert.equal(scenario.copied.length, 0, mode);
            }
        }
    });

    it("creates the detached row and full coordinate replacement in one transaction and one remove undo", async () => {
        const scenario = setup();
        scenario.binding.show({longitude: 120.5, latitude: 30.25});
        scenario.menu().click("mapCreateAtPoint");
        assert.equal(scenario.transactions.length, 1);
        const batch = scenario.transactions[0];
        assert.deepEqual(Array.from(batch.perform, operation => operation.action),
            ["insertAttrViewBlock", "updateAttrViewCell", "doUpdateUpdated"]);
        const [insert, update] = batch.perform;
        assert.equal(insert.avID, "database");
        assert.equal(insert.blockID, "carrier");
        assert.equal(insert.viewID, "map-view");
        assert.equal(insert.srcs.length, 1);
        assert.equal(insert.srcs[0].isDetached, true);
        assert.equal(insert.srcs[0].content, "");
        assert.equal(update.rowID, insert.srcs[0].itemID);
        assert.equal(update.keyID, "location");
        assert.deepEqual(JSON.parse(JSON.stringify(update.data)), {id: update.id, keyID: "location",
            blockID: insert.srcs[0].itemID, type: "location", location: {
                longitude: 120.5, latitude: 30.25, name: "", originalInput: "",
            }});
        assert.deepEqual(JSON.parse(JSON.stringify(batch.undo)), [
            {action: "removeAttrViewBlock", avID: "database", blockID: "carrier", srcIDs: [insert.srcs[0].itemID]},
            {action: "doUpdateUpdated", id: "carrier", data: "20261010120000"},
        ]);
        assert.equal(scenario.opened.length, 0);
        await scenario.complete();
        assert.equal(scenario.renders(), 1);
        assert.equal(scenario.block.getAttribute("updated"), "20261011090000");
        assert.equal(scenario.block.hasAttribute("data-render"), false);
        assert.equal(scenario.opened.length, 1);
        assert.equal(scenario.opened[0].itemID, insert.srcs[0].itemID);
        assert.equal(scenario.opened[0].focusPrimary, true);
        assert.equal(scenario.opened[0].isDetached, true);
    });

    it("prevents duplicate creation until the transaction settles and permits retry after failure", async () => {
        const scenario = setup();
        scenario.binding.show({longitude: 0, latitude: 0});
        const menu = scenario.menu();
        menu.click("mapCreateAtPoint");
        menu.click("mapCreateAtPoint");
        scenario.binding.show({longitude: 1, latitude: 1});
        assert.equal(scenario.menu().item("mapCreateAtPoint"), undefined);
        assert.equal(scenario.transactions.length, 1);
        await scenario.complete(false);
        assert.equal(scenario.opened.length, 0);
        assert.equal(scenario.renders(), 0);
        scenario.binding.show({longitude: 1, latitude: 1});
        scenario.menu().click("mapCreateAtPoint");
        assert.equal(scenario.transactions.length, 2);
        await scenario.complete();
        assert.equal(scenario.opened.length, 1);
    });

    it("catches immediate transaction errors and restores the creation action", async () => {
        const scenario = setup();
        scenario.setTransactionFailure(true);
        scenario.binding.show({longitude: 0, latitude: 0});
        scenario.menu().click("mapCreateAtPoint");
        await scenario.settle();
        assert.equal(scenario.transactions.length, 0);
        assert.equal(scenario.opened.length, 0);
        scenario.setTransactionFailure(false);
        scenario.binding.show({longitude: 1, latitude: 1});
        scenario.menu().click("mapCreateAtPoint");
        assert.equal(scenario.transactions.length, 1);
        await scenario.complete();
    });

    it("does not reopen a row after success when its carrier, view, editability or notebook access changed", async () => {
        for (const mode of ["detached", "carrier", "database", "view", "editor", "notebook", "readonly", "global-readonly", "history", "locked"]) {
            const scenario = setup();
            const result = scenario.create();
            assert.equal(scenario.transactions.length, 1);
            if (mode === "detached") scenario.block.remove();
            else if (mode === "carrier") scenario.block.dataset.nodeId = "other-carrier";
            else if (mode === "database") scenario.block.dataset.avId = "other-database";
            else if (mode === "view") scenario.block.setAttribute("custom-sy-av-view", "other-view");
            else if (mode === "editor") scenario.reparent();
            else if (mode === "notebook") scenario.protyle.notebookId = "other-notebook";
            else if (mode === "readonly") scenario.protyle.disabled = true;
            else if (mode === "global-readonly") scenario.context.siyuan.config.readonly = true;
            else if (mode === "history") scenario.protyle.options.history = {snapshot: "history"};
            else scenario.context.siyuan.notebooks[0].closed = true;
            await scenario.complete();
            assert.equal(await result, true);
            assert.equal(scenario.opened.length, 0, mode);
            assert.equal(scenario.renders(), 0, mode);
        }
    });

    it("still opens a successful new row when only its old map lifecycle was replaced", async () => {
        const scenario = setup();
        const result = scenario.create();
        scenario.stale();
        await scenario.complete();
        assert.equal(await result, true);
        assert.equal(scenario.opened.length, 1);
    });

    it("rejects invalid locations and unavailable owners when record creation is invoked directly", async () => {
        for (const location of [{longitude: 181, latitude: 0}, {longitude: 0}, {longitude: 0, latitude: 90},
            {longitude: 0, latitude: 0, name: 42}]) {
            const scenario = setup();
            assert.equal(await scenario.create(location as IAVCellLocationValue), false);
            assert.equal(scenario.transactions.length, 0);
        }
        for (const mode of ["stale", "detached", "database", "view", "locked", "readonly", "published", "history"]) {
            const scenario = setup();
            if (mode === "stale") scenario.stale();
            else if (mode === "detached") scenario.block.remove();
            else if (mode === "database") scenario.block.dataset.avId = "other-database";
            else if (mode === "view") scenario.block.setAttribute("custom-sy-av-view", "other-view");
            else if (mode === "locked") scenario.context.siyuan.notebooks[0].closed = true;
            else if (mode === "readonly") scenario.protyle.disabled = true;
            else if (mode === "published") scenario.context.siyuan.isPublish = true;
            else scenario.protyle.options.history = {created: "history"};
            const result = scenario.create();
            assert.equal(scenario.transactions.length, 0, mode);
            assert.equal(await result, false, mode);
        }
        const failed = setup();
        const result = failed.create();
        await failed.complete(false);
        assert.equal(await result, false);
        assert.equal(failed.opened.length, 0);
    });

    it("replaces the existing menu and closes it once on disposal, disabling old callbacks", () => {
        const scenario = setup();
        scenario.binding.show({longitude: 0, latitude: 0});
        const first = scenario.menu();
        scenario.binding.show({longitude: 1, latitude: 1});
        const second = scenario.menu();
        assert.equal(first.closes, 1);
        assert.equal(second.closes, 0);
        assert.equal(scenario.context.siyuan.menus.menu.data, scenario.canvas);
        assert.equal(scenario.canvas.hasAttribute("data-menu"), false);
        first.click("copy");
        first.click("mapCreateAtPoint");
        assert.equal(scenario.copied.length, 0);
        assert.equal(scenario.transactions.length, 0);
        scenario.binding.destroy();
        scenario.binding.destroy();
        assert.equal(second.closes, 1);
        assert.equal(scenario.context.siyuan.menus.menu.data, undefined);
        second.click("copy");
        second.click("mapCreateAtPoint");
        scenario.binding.show({longitude: 2, latitude: 2});
        assert.equal(scenario.menus.length, 2);
        assert.equal(scenario.copied.length, 0);
        assert.equal(scenario.transactions.length, 0);
    });

    it("dismissal clears shared ownership and cannot revive actions from the retired menu", () => {
        const scenario = setup();
        scenario.binding.show({longitude: 0, latitude: 0});
        const menu = scenario.menu();
        scenario.context.siyuan.menus.menu.remove();
        assert.equal(scenario.context.siyuan.menus.menu.data, undefined);
        menu.click("copy");
        menu.click("mapCreateAtPoint");
        assert.equal(scenario.copied.length, 0);
        assert.equal(scenario.transactions.length, 0);
        scenario.binding.show({longitude: 1, latitude: 1});
        assert.equal(scenario.menu().closes, 0);
        scenario.menu().click("copy");
        assert.deepEqual(scenario.copied, ["1, 1 [WGS84]"]);
        scenario.binding.destroy();
    });
});
