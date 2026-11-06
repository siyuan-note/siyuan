import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

for (const kind of ["secret", "variable"]) {
    test(`mobile ${kind} deletion returns persistence failure and supports retry`, async () => {
        const namespace = kind === "secret" ? "secrets" : "variables";
        const items = [{name: "remove", value: "test"}, {name: "keep", value: "test"}];
        let click: (event: unknown) => void;
        let confirm: () => Promise<boolean>;
        let options: {awaitConfirm: boolean};
        let fail = true;
        let saved: unknown;
        const root = {querySelector: (selector: string) => selector.endsWith("Block")
            ? {addEventListener: (_event: string, handler: typeof click) => { click = handler; }}
            : {innerHTML: ""}};
        const exports = {} as Record<string, (root: unknown) => void>;
        const compiled = transpileModule(readFileSync("src/config/tabs/secretsVariablesUi.ts", "utf8"),
            {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
        runInNewContext(compiled, {
            exports,
            window: {siyuan: {config: {[namespace]: {items}}, languages: {confirmDeleteTip: "${x}"}}},
            require: () => ({
                isMobile: () => true,
                escapeHtmlTextAndAttr: (value: string) => value,
                [`${namespace}ConfigApi`]: {patch: async (_key: string, next: unknown) => {
                    if (fail) throw new Error("delete failed");
                    saved = next;
                }},
                mobileConfirmDialog: (...args: unknown[]) => {
                    confirm = args[2] as typeof confirm;
                    options = args[7] as typeof options;
                },
            }),
        });
        exports[kind === "secret" ? "mountSecretsBlock" : "mountVariablesBlock"](root);
        const action = {dataset: {type: kind === "secret" ? "deleteSecret" : "deleteVariable"},
            closest: () => ({dataset: {secretName: "remove", variableName: "remove"}})};
        click({target: {closest: () => action}, preventDefault() {}, stopPropagation() {}});
        assert.equal(options.awaitConfirm, true);
        await assert.rejects(confirm(), /delete failed/);
        assert.equal(saved, undefined);
        assert.equal(items.length, 2);
        fail = false;
        assert.equal(await confirm(), true);
        assert.deepEqual(JSON.parse(JSON.stringify(saved)), kind === "secret"
            ? [{name: "keep", value: "test", allowedHosts: []}] : [{name: "keep", value: "test"}]);
    });

    test(`mobile ${kind} editor waits for persistence and keeps its draft on failure`, async () => {
        const values = {itemName: {value: "draft"}, itemValue: {value: "unsaved"}, itemAllowedHosts: {value: "api.example.com"}};
        const clicks: (() => void)[] = [];
        const buttons = [0, 1].map(index => ({addEventListener: (_event: string, callback: () => void) => { clicks[index] = callback; }}));
        const writes: {items: unknown, resolve: () => void, reject: () => void}[] = [];
        let closed = false;
        let pending = false;
        let settled: Promise<boolean>;
        let focusScheduled = false;
        const patch = (_path: string, items: unknown) => new Promise<void>((resolve, reject) => {
            writes.push({items, resolve, reject: () => reject(new Error("save failed"))});
        });
        const exports = {} as {open: (options: unknown) => void};
        const compiled = transpileModule(readFileSync("src/config/tabs/secretsVariablesUi.ts", "utf8") +
            "\nexports.open = openItemDialog;", {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
        runInNewContext(compiled, {
            exports,
            window: {siyuan: {config: {secrets: {items: []}, variables: {items: []}}, languages: {}}},
            require: () => ({
                isMobile: () => true,
                Constants: {DIALOG_AIPROVIDER: "provider"},
                escapeHtmlTextAndAttr: (value: string) => value,
                bindPasswordIconaToggle: () => {},
                secretsConfigApi: {patch}, variablesConfigApi: {patch},
                MobileDialog: class {
                    element = {setAttribute() {}, querySelector: (selector: string) => values[selector.slice(1) as keyof typeof values],
                        querySelectorAll: () => buttons};
                    focusWhenReady() { focusScheduled = true; }
                    destroy() { if (!pending) closed = true; }
                    runPending(task: () => Promise<boolean>, options: {close: boolean}) {
                        if (pending) return Promise.resolve(false);
                        pending = true;
                        settled = task().then(success => { if (success && options.close) closed = true; return success; }, () => false)
                            .finally(() => { pending = false; });
                        return settled;
                    }
                },
            }),
        });
        exports.open({root: {}, existingName: null, kind});
        assert.equal(focusScheduled, true);
        clicks[1]();
        clicks[1]();
        clicks[0]();
        assert.equal(writes.length, 1);
        assert.equal(closed, false);
        writes[0].reject();
        assert.equal(await settled, false);
        assert.equal(closed, false);
        assert.equal(values.itemValue.value, "unsaved");
        clicks[1]();
        assert.equal(writes.length, 2);
        writes[1].resolve();
        assert.equal(await settled, true);
        assert.equal(closed, true);
    });
}
