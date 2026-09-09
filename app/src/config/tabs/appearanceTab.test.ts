import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [true, false]) {
    test(`appearance registration includes toolbar settings on first load (mobile=${mobile})`, () => {
        const source = readFileSync(resolve(process.cwd(), "src/config/tabs/appearanceTab.ts"), "utf8");
        const processed = parse(source, {MOBILE: mobile, BROWSER: true}, false, true);
        const code = transpileModule(processed, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
        let mounted = false;
        const toolbarSettings = {
            genEntryVisibilityHtml: () => "toolbar-settings",
            mountEntryVisibility: () => {
                mounted = true;
            },
        };
        const moduleExports: {registerAppearanceTab?: (tab: unknown) => void} = {};
        runInNewContext(code, {
            exports: moduleExports,
            window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)}), config: {langs: []}}},
            require: (name: string) => name === "../entryVisibility/ui" ? toolbarSettings :
                new Proxy({}, {get: () => () => ({})}),
        });
        const groups: string[] = [];
        const slots: Array<{key: string; html: () => string; afterMount: () => void}> = [];
        const group = new Proxy({}, {
            get: (_, method) => (...args: unknown[]) => {
                if (method === "slot") {
                    slots.push(args[0] as typeof slots[number]);
                }
            },
        });
        moduleExports.registerAppearanceTab({group: (name: string) => {
            groups.push(name);
            return group;
        }});
        assert.deepEqual(groups, ["content", "interface", "controls"]);
        const entry = slots.find(item => item.key === "entryVisibility");
        assert.ok(entry);
        assert.equal(entry.html(), "toolbar-settings");
        entry.afterMount();
        assert.equal(mounted, true);
        assert.equal(slots.some(item => item.key === "mobileBottomBar"), mobile);
    });
}
