import * as capabilities from "./capabilities";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const createPanel = (mobile: boolean) => {
    const siyuan = {config: {readonly: false, editor: {readOnly: true, databaseAttrShow: true}},
        isPublish: false, languages: {}, dialogs: [] as unknown[]};
    const source = {app: {}, disabled: false, block: {rootID: "document"}, options: {history: {}}} as IProtyle;
    const target = {disabled: true, block: {rootID: "document"}, highlight: {}, hint: {}, id: "row"} as IProtyle;
    let permanent = false;
    let loaded: () => void;
    const rendered: boolean[] = [];
    const listeners = new Map<string, (event: {detail: Partial<IProtyle>}) => void>();
    const body = {style: {}};
    const element = {
        dataset: {}, clientWidth: 800,
        querySelector: () => body,
        addEventListener: (name: string, listener: (event: {detail: Partial<IProtyle>}) => void) => listeners.set(name, listener),
        dispatchEvent: (event: {type: string, detail: Partial<IProtyle>}) => listeners.get(event.type)?.(event),
        append() {},
    };
    class Custom {
        public data: Record<string, unknown>;
        public element = element;
        public update: () => void;

        constructor(options: {data: Record<string, unknown>, update: () => void, init: (model: Custom) => void}) {
            this.data = options.data;
            this.update = options.update;
            options.init(this);
        }
    }
    class Protyle {
        constructor(_app: unknown, _element: unknown, options: {after: (editor: {protyle: IProtyle}) => void}) {
            loaded = () => options.after({protyle: target});
        }
    }
    let model: Custom;
    const dependencies: Record<string, unknown> = {
        "../../util/onGet": {
            disabledProtyle: (protyle: IProtyle) => { protyle.disabled = true; },
            enableProtyle: (protyle: IProtyle) => { if (!permanent) { protyle.disabled = false; } },
        },
        "../layout/dock/Custom": {Custom},
        "../../../layout/dock/Custom": {Custom},
        "../protyle": {Protyle},
        "../../index": {Protyle},
        "../../../dialog": {Dialog: class { public element = {querySelector: () => element}; }},
        "../protyle/ui/padding": {getEditorHorizontalPadding: () => ({left: 0, right: 0})},
        "../../../layout/util": {saveLayout() {}},
        "./databaseRowNavigation": {getDatabaseRowNavigation: (): undefined => undefined, mountDatabaseRowNavigation() {}},
    };
    const load = <T>(file: string) => {
        const exports = {} as T;
        runInNewContext(transpileModule(parse(readFileSync("src/" + file + ".ts", "utf8"),
            {MOBILE: mobile, BROWSER: false}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
        }).outputText, {
            exports, window: {siyuan}, document: {createElement: () => ({})},
            ResizeObserver: class { observe() {} },
            CustomEvent: class {
                public detail: unknown;
                constructor(public type: string, options: {detail: unknown}) { this.detail = options.detail; }
            },
            require: (name: string) => {
            if (name === "./capabilities" || name === "../capabilities") { return capabilities; }

                if (name.endsWith("/blockAttr")) {
                    return {renderAVAttribute: (_element: unknown, _id: string, protyle: IProtyle) => rendered.push(protyle.disabled)};
                }
                if (name.endsWith("/databaseRowRefresh")) {
                    return {registerDatabaseRowRefresh() {}};
                }
                return dependencies[name] || {};
            },
        });
        return exports;
    };
    const readonly = load<typeof import("./rowReadonly")>("protyle/render/av/rowReadonly");
    dependencies["./rowReadonly"] = readonly;
    dependencies["../protyle/render/av/rowReadonly"] = readonly;
    const desktop = load<typeof import("../../../editor/databaseRow")>("editor/databaseRow");
    dependencies["../../../editor/util"] = {openFile: async (options: {
        custom: {data: Record<string, unknown>}, afterOpen: (model: Custom) => void,
    }) => {
        if (!model) {
            model = desktop.newDatabaseRowModel({app: source.app,
                tab: {} as Parameters<typeof desktop.newDatabaseRowModel>[0]["tab"],
                data: options.custom.data as Parameters<typeof desktop.newDatabaseRowModel>[0]["data"]}) as unknown as Custom;
        }
        options.afterOpen(model);
        return {};
    }};
    const api = load<typeof import("./openDatabaseRow")>("protyle/render/av/openDatabaseRow");
    const open = () => api.openDatabaseRowByData(source, {
        avID: "database", databaseBlockID: "carrier", notebookID: "notebook", itemID: "row", valueID: "value",
        title: "Entry", isDetached: true,
    });
    return {source, target, siyuan, rendered, open, load: () => loaded(), lockForever: () => { permanent = true; },
        savedData: () => JSON.stringify(model.data)};
};

for (const mobile of [false, true]) {
    test(`database row inherits temporary document unlock after loading (${mobile ? "mobile" : "desktop"})`, async () => {
        const panel = createPanel(mobile);
        assert.equal(await panel.open(), true);
        assert.equal(panel.rendered.length, 0);
        panel.load();
        assert.equal(panel.rendered.at(-1), false);
        panel.source.disabled = true;
        await panel.open();
        if (mobile) {
            panel.load();
        }
        assert.equal(panel.rendered.at(-1), true);
        panel.source.disabled = false;
        await panel.open();
        if (mobile) {
            panel.load();
        }
        assert.equal(panel.rendered.at(-1), false);
        if (!mobile) {
            assert.doesNotMatch(panel.savedData(), /disabled|sourceProtyle|rootID/);
        }
    });

    test(`database row retains readonly boundaries (${mobile ? "mobile" : "desktop"})`, async () => {
        for (const mode of ["workspace", "publish", "history", "snapshot", "permanent", "other-document", "no-context"]) {
            const panel = createPanel(mobile);
            panel.siyuan.config.readonly = mode === "workspace";
            panel.siyuan.isPublish = mode === "publish";
            if (mode === "history") { panel.source.options.history.created = "archive"; }
            if (mode === "snapshot") { panel.source.options.history.snapshot = "snapshot"; }
            if (mode === "permanent") { panel.lockForever(); }
            if (mode === "other-document") { panel.target.block.rootID = "another-document"; }
            if (mode === "no-context") { delete panel.source.block; }
            await panel.open();
            panel.load();
            assert.equal(panel.rendered.at(-1), true, mode);
        }
    });
}
