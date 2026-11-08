import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {isBazaarBatchUpdateExcluded} from "./batchUpdatePreference";

const types: TBazaarType[] = ["plugins", "themes", "icons", "widgets", "templates"];
const createController = (save?: (path: string, value: Record<string, boolean>) => Promise<void>) => {
    const source = createSourceFile("bazaar.ts", readFileSync("src/config/bazaar.ts", "utf8"), ScriptTarget.Latest, true);
    const declaration = source.statements.filter(isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations]).find(item => item.name.getText(source) === "bazaar");
    const config: Config.IBazaar = {trust: true, petalDisabled: false, batchUpdateExcluded: {plugins: {same: true}}};
    const messages: string[] = [];
    const controller = runInNewContext(transpileModule(`const bazaar = ${declaration.initializer.getText(source)}; bazaar;`, {}).outputText, {
        window: {siyuan: {config: {bazaar: config}, languages: {bazaarSkipBatchUpdate: "Skip Update all"}}},
        isBazaarBatchUpdateExcluded, getBazaarBatchUpdate: (): undefined => undefined,
        bazaarConfigApi: {patch: async (path: string, value: Record<string, boolean>) => {
            await save?.(path, value);
            const type = path.split(".")[1] as TBazaarType;
            config.batchUpdateExcluded[type] = {...config.batchUpdateExcluded[type], ...value};
        }},
        showMessage: (message: string) => messages.push(message),
        Map, Set, WeakMap,
    }) as typeof import("../bazaar").bazaar;
    controller._refreshBatchUpdatePreferences = () => {};
    controller._isUpdatePanelActive = () => false;
    controller._getUpdatedItems = () => types.map(type => ({type,
        item: {installed: {name: "same"}, available: {outdated: true}} as IUpdatedBazaarItem}));
    return {controller, config, messages};
};

test("batch exclusions are type-specific and do not remove discovered updates", () => {
    const {controller} = createController();
    assert.deepEqual(Array.from(controller._getBatchUpdateItems(), item => item.type), types.slice(1));
    assert.equal(controller._getUpdatedItems().length, 5);
    assert.equal(isBazaarBatchUpdateExcluded(undefined, "plugins", "same"), false);
    for (const type of types) {
        assert.equal(isBazaarBatchUpdateExcluded({[type]: {same: true}}, type, "same"), true);
        assert.equal(isBazaarBatchUpdateExcluded({[type]: {same: false}}, type, "same"), false);
    }
});

test("switch persists per-type exclusions and can restore batch updates", async () => {
    const {controller, config} = createController();
    await controller._toggleBatchUpdatePreference("themes", "same");
    assert.equal(config.batchUpdateExcluded.themes.same, true);
    assert.match(controller._genBatchUpdatePreferenceHTML("themes", "same"), /aria-checked="true"/);
    await controller._toggleBatchUpdatePreference("themes", "same");
    assert.equal(config.batchUpdateExcluded.themes.same, false);
    assert.match(controller._genBatchUpdatePreferenceHTML("themes", "same"), /aria-checked="false"/);
    assert.equal(config.batchUpdateExcluded.plugins.same, true);
});

test("failed saves preserve prior preferences and release pending state", async () => {
    const {controller, config, messages} = createController(async () => {throw new Error("save failed");});
    await controller._toggleBatchUpdatePreference("plugins", "same");
    assert.equal(config.batchUpdateExcluded.plugins.same, true);
    assert.equal(controller._batchUpdatePreferenceSaving, false);
    assert.equal(messages.length, 1);
});

test("a pending save blocks competing toggles until confirmed", async () => {
    let done: () => void;
    const {controller, config} = createController(() => new Promise<void>(resolve => {done = resolve;}));
    const first = controller._toggleBatchUpdatePreference("plugins", "same");
    await controller._toggleBatchUpdatePreference("themes", "same");
    assert.equal(config.batchUpdateExcluded.themes, undefined);
    assert.equal(controller._batchUpdatePreferenceSaving, true);
    done();
    await first;
    assert.equal(config.batchUpdateExcluded.plugins.same, false);
});

test("all excluded packages remain visible with manual update controls", async () => {
    const {controller} = createController();
    for (const type of types.slice(1)) await controller._toggleBatchUpdatePreference(type, "same");
    assert.equal(controller._getBatchUpdateItems().length, 0);
    assert.equal(controller._getUpdatedItems().length, 5);
    for (const type of types) {
        const html = controller._genUpdateButtonHTML({name: "same", outdated: true} as IBazaarItem, type);
        assert.match(html, /data-type="install-t"/);
        assert.doesNotMatch(html, /disabled/);
    }
});

test("saving sends only the changed package key, never a stale complete snapshot", async () => {
    const patches: Array<{path: string, value: Record<string, boolean>}> = [];
    const {controller} = createController(async (path, value) => {patches.push({path, value});});
    await controller._toggleBatchUpdatePreference("plugins", "different.name");
    assert.equal(patches[0].path, "batchUpdateExcluded.plugins");
    assert.deepEqual(Object.keys(patches[0].value), ["different.name"]);
    assert.equal(patches[0].value["different.name"], true);
});
