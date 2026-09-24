import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {getCommandRegistry} from "./service";
import {queryCommandPalette, recordPaletteCommand} from "./paletteCore";
import type {ICommandContextSnapshot} from "./types";

const source = ts.transpileModule(readFileSync(join(process.cwd(), "src/command/insertCommands.ts"), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;

test("insert commands search and execute existing insertion actions at the saved cursor on mobile and desktop", async () => {
    const languages = new Proxy({template: "模板", assets: "资源", callout: "提示"} as Record<string, string>, {
        get: (target, key: string) => target[key] || key,
    });
    const siyuan = {config: {readonly: false}, isPublish: false, languages};
    const fills: string[] = [];
    const focused: unknown[] = [];
    let keyboards = 0;
    let picked = false;
    let uploadBound = false;
    const input = {
        type: "", className: "", multiple: false, accept: "", capture: "",
        addEventListener() {}, click() { picked = true; },
    };
    const uploadHost = {hidden: false, append() {}, remove() {}};
    const document = {createElement: (tag: string) => tag === "input" ? input : uploadHost,
        body: {append: (host: unknown) => assert.equal(host, uploadHost)}};
    const module = {exports: {}};
    const mocks: Record<string, unknown> = {
        "./service": {getCommandRegistry},
        "./english": {getEnglishCommandLabel: (key: string) => key},
        "../protyle/hint/extend": {getBuiltinSlashMenuItems: () => [
            {id: "template", value: "template-value"}, {id: "ref", value: "(("},
        ]},
        "../protyle/toolbar/inlineStyle": {isBuiltinInlineStyleVisible: () => true},
        "../protyle/util/selection": {focusByRange: (range: unknown) => focused.push(range)},
        "../protyle/util/compatibility": {isDisabledFeature: () => false, isInAndroid: () => false},
        "../util/hostCapabilities": {getHostCapabilities: () => ({widgets: true, remoteKernel: false})},
        "../mobile/util/mobileAppUtil": {callMobileAppShowKeyboard: () => keyboards++},
    };
    runInNewContext(source, {module, exports: module.exports, require: (id: string) => mocks[id] || {},
        window: {siyuan}, document});
    const {ensureInsertCommands} = module.exports as typeof import("./insertCommands");
    const app = {};
    ensureInsertCommands(app, true);
    const registry = getCommandRegistry(app);
    const container = {isConnected: true};
    const range = {startContainer: container, endContainer: container, cloneRange() { return {...this}; }};
    const protyle = {
        lite: false, disabled: false, wysiwyg: {element: {contains: (node: unknown) => node === container}},
        options: {upload: {accept: "image/*"}}, toolbar: {range: undefined as unknown},
        hint: {splitChar: "", lastIndex: 2, fill: (value: string) => fills.push(value),
            bindUploadEvent: (_protyle: unknown, host: unknown) => { uploadBound = host === uploadHost; }},
    };
    const context = {
        app, source: "commandPanel", environment: "mobile", focus: "editor", selectedBlocks: [], protyle, range,
    } as unknown as ICommandContextSnapshot;
    const visible = registry.list(context).map(command => command.id);
    assert.ok(visible.includes("core.mobile.insert.template"));
    assert.ok(visible.includes("core.mobile.insert.insertAsset"));
    assert.ok(visible.includes("core.mobile.insert.mindmap"));
    assert.ok(!visible.includes("core.mobile.insert.insertPhoto"));
    assert.equal(queryCommandPalette(registry, context, "模板")[0].id, "core.mobile.insert.template");
    const recent = recordPaletteCommand([], "core.mobile.insert.assets");
    assert.equal(queryCommandPalette(registry, context, "", recent)[0].id, "core.mobile.insert.assets");
    assert.equal((await registry.execute("core.mobile.insert.template", context)).status, "executed");
    assert.deepEqual(fills, ["template-value"]);
    assert.equal(protyle.hint.splitChar, "/");
    assert.equal(protyle.hint.lastIndex, -1);
    assert.equal(focused.length, 1);
    assert.ok(protyle.toolbar.range);
    await registry.execute("core.mobile.insert.ref", context);
    assert.deepEqual(fills, ["template-value", "(("]);
    assert.equal(keyboards, 1);
    await registry.execute("core.mobile.insert.insertAsset", context);
    assert.equal(uploadBound, true);
    assert.equal(picked, true);
    assert.equal(input.accept, "image/*");
    assert.equal(uploadHost.hidden, true);
    assert.equal(registry.list({...context, environment: "desktop"}).length, 0);
    const desktopApp = {};
    ensureInsertCommands(desktopApp, false);
    const desktopRegistry = getCommandRegistry(desktopApp);
    const desktopContext = {...context, app: desktopApp, environment: "desktop"} as ICommandContextSnapshot;
    const desktopVisible = desktopRegistry.list(desktopContext).map(command => command.id);
    assert.ok(desktopVisible.includes("core.insert.template"));
    assert.ok(desktopVisible.includes("core.insert.mindmap"));
    assert.ok(!desktopVisible.includes("core.insert.insertPhoto"));
    assert.equal(queryCommandPalette(desktopRegistry, desktopContext, "模板")[0].id, "core.insert.template");
    assert.equal((await desktopRegistry.execute("core.insert.template", desktopContext)).status, "executed");
    assert.deepEqual(fills, ["template-value", "((", "template-value"]);
    assert.equal(keyboards, 1);
    siyuan.config.readonly = true;
    assert.equal(registry.list(context).length, 0);
    siyuan.config.readonly = false;
    siyuan.isPublish = true;
    assert.equal(registry.list(context).length, 0);
    siyuan.isPublish = false;
    container.isConnected = false;
    assert.equal(registry.list(context).length, 0);
});
