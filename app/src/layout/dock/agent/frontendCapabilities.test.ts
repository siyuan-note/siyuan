import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {App} from "../../../index";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [false, true]) {
    test(`frontend capabilities keep platform actions and shared validation (${mobile ? "mobile" : "desktop"})`, async () => {
        const actions: string[] = [];
        const delayed: (() => void)[] = [];
        const block = {scrollIntoView: () => actions.push("scroll"),
            classList: {add: () => actions.push("highlight"), remove: () => actions.push("unhighlight")}};
        const editor = {protyle: {wysiwyg: {element: {querySelector: () => block}}}};
        const input = {value: "", dispatchEvent: () => actions.push("filter")};
        const dialog = {element: {querySelector: () => input}};
        const constants = {CB_GET_FOCUS: "focus", DIALOG_GLOBALSEARCH: "search"};
        const dependencies: Record<string, unknown> = {
            "../../../config": {openSetting: () => { actions.push("settings"); return dialog; }},
            "../../getAll": {getAllEditor: () => [{protyle: {wysiwyg: {element: {querySelector: (): null => null}}}}, editor]},
            "../../../mobile/editor": {getCurrentEditor: () => editor,
                openMobileFileById: (_app: unknown, id: string, flags: string[]) => actions.push("document:" + id + ":" + flags[0])},
            "../../../mobile/agent/MobileAgentChat": {hideMobileAgent: () => actions.push("hide"), reopenMobileAgent: () => {}},
            "../../../mobile/menu": {openMobileSetting: () => actions.push("settings")},
            "../../../editor/util": {openFileById: (options: {id: string, action: string[]}) =>
                actions.push("document:" + options.id + ":" + options.action[0])},
            "../../../constants": {Constants: constants},
            "../../../search/spread": {openSearch: (options: {key: string}) => actions.push("search:" + options.key)},
            "../../../mobile/menu/search": {popSearch: () => actions.push("search")},
        };
        const source = parse(readFileSync("src/layout/dock/agent/frontendCapabilities.ts", "utf8"),
            {MOBILE: mobile, BROWSER: true}, false, true, "frontendCapabilities.ts");
        const code = transpileModule(source, {compilerOptions: {
            module: ModuleKind.CommonJS, target: ScriptTarget.ES2021,
        }}).outputText;
        const exports = {} as typeof import("./frontendCapabilities");
        runInNewContext(code, {exports, require: (name: string) => {
            assert.ok(name in dependencies, name);
            return dependencies[name];
        }, window: {siyuan: {dialogs: [dialog]}}, document: {getElementById: () => input},
        Event: class {}, InputEvent: class {}, setTimeout: (callback: () => void) => delayed.push(callback)});
        const capability = (name: string) => exports.lookupCapability("native/frontend/" + name);
        assert.equal(exports.listCapabilityManifests().length, 4);
        for (const name of ["focus_block", "open_document"]) {
            assert.equal((await capability(name).handler({}, {} as App)).error, "missing required argument: id");
        }
        assert.deepEqual(actions, []);
        await capability("open_setting").handler({query: "  option  "}, {} as App);
        assert.deepEqual(actions, mobile ? ["hide", "settings"] : ["filter"]);
        actions.length = 0;
        assert.equal((await capability("focus_block").handler({id: "block"}, {} as App)).result,
            "Focused block block in the active editor.");
        assert.deepEqual(actions, mobile ? ["hide", "scroll", "highlight"] : ["scroll", "highlight"]);
        delayed[0]();
        assert.equal(actions.at(-1), "unhighlight");
        actions.length = 0;
        await capability("open_document").handler({id: "doc"}, {} as App);
        assert.deepEqual(actions, mobile ? ["hide", "document:doc:focus"] : ["document:doc:focus"]);
        actions.length = 0;
        await capability("open_search").handler({query: "  foo  "}, {} as App);
        assert.deepEqual(actions, mobile ? ["hide", "search", "filter"] : ["search:foo"]);
        if (mobile) assert.equal(input.value, "foo");
    });
}
