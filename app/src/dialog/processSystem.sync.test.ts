import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const createSync = (mobile: boolean, result?: number) => {
    const source = readFileSync("src/dialog/processSystem.ts", "utf8");
    const start = source.indexOf("let lastSyncResult:");
    const end = source.indexOf("\n};", start) + 4;
    const code = transpileModule(parse(source.slice(start, end).replace("export const", "const"),
        {MOBILE: mobile}, false, true), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const classes = new Set<string>();
    const classList = {contains: (name: string) => classes.has(name),
        add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name)};
    const icons: Record<string, string> = {};
    const icon = (name: string) => ({parentElement: {classList},
        setAttribute: (_key: string, value: string) => { icons[name] = value; }});
    const desktop = icon("desktop");
    const config = {sync: {enabled: true, provider: 3, lastResult: result}};
    const process = new Function("window", "document", "needSubscribe", "emitToPlugins", "CustomEvent", code + ";return processSync;")(
        {siyuan: {config}, dispatchEvent() {}},
        {querySelector: (selector: string) => selector === "#barSync" ?
            {classList, firstElementChild: {classList}, querySelector: () => desktop} : icon(selector)},
        () => false, () => {}, class {},
    ) as (data?: {code: number}) => void;
    const check = (value: string) => {
        for (const name of mobile ? ["#menuSyncNow use", "#toolbarSync use"] : ["desktop"]) {
            assert.equal(icons[name], value, name);
        }
    };
    return {process, config, check, classes};
};

for (const mobile of [false, true]) {
    test(`sync errors survive stale configuration reads and recover after success (${mobile ? "mobile" : "desktop"})`, () => {
        const h = createSync(mobile, 1);
        h.process({code: 2});
        h.check("#iconCloudError");
        h.process();
        h.check("#iconCloudError");
        h.config.sync.enabled = false;
        h.process();
        h.check("#iconCloudOff");
        h.config.sync.enabled = true;
        h.process({code: 0});
        h.check("#iconRefresh");
        h.process();
        h.check("#iconRefresh");
        h.process({code: 1});
        h.check("#iconCloudSucc");
        h.config.sync.lastResult = 2;
        h.process();
        h.check("#iconCloudSucc");
    });

    test(`startup restores structured results and treats legacy state as unknown (${mobile ? "mobile" : "desktop"})`, () => {
        for (const [result, icon] of [[undefined, "#iconCloud"], [0, "#iconCloud"], [1, "#iconCloudSucc"], [2, "#iconCloudError"]] as const) {
            const h = createSync(mobile, result);
            h.process();
            h.check(icon);
        }
    });
}
