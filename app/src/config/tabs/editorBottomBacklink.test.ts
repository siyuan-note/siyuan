import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isObjectLiteralExpression, ScriptTarget, transpileModule} from "typescript";
import {shouldResetBottomBacklinkPanel} from "./editorRuntimeState";

const {parse} = require("ifdef-loader/preprocessor");
const sourceFor = (file: string, mobile: boolean) => createSourceFile(file,
    parse(readFileSync(`src/config/tabs/${file}`, "utf8"), {BROWSER: true, MOBILE: mobile}, false, true),
    ScriptTarget.ES2021, true);
const compile = (source: string) => transpileModule(source, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

for (const mobile of [false, true]) {
    test(`bottom backlink switch uses the existing editor setting (mobile=${mobile})`, () => {
        const source = sourceFor("editorTab.ts", mobile);
        const registration = source.statements.find(node => node.getText(source).startsWith("const registerEditorBidirectionalGroup ="));
        assert.ok(registration);
        const switches: string[] = [];
        const group = new Proxy({}, {get: (_, kind: string) => (id: string) => {
            if (kind === "switch") switches.push(id);
        }});
        runInNewContext(compile(registration.getText(source)) + "\nregisterEditorBidirectionalGroup(tab);", {
            tab: {group: () => group}, isMobile: () => mobile,
            window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)})}},
        });
        assert.equal(switches.filter(id => id === "editor.backlinkShowBottom").length, 1);
    });

    test(`bottom backlink settings update the active platform and await mobile saves (mobile=${mobile})`, async () => {
        const source = sourceFor("editorRuntime.ts", mobile);
        let applySource: string;
        const visit = (node: import("typescript").Node) => {
            if (isObjectLiteralExpression(node) && node.properties.some(property =>
                property.getText(source) === 'name: "backlink-panel"')) {
                const property = node.properties.find(item => item.name?.getText(source) === "apply");
                applySource = property.getText(source).slice("apply:".length);
            }
            forEachChild(node, visit);
        };
        visit(source);
        assert.ok(applySource);
        let saved: () => void;
        const pending = new Promise<void>(resolve => { saved = resolve; });
        const calls: string[] = [];
        const apply = runInNewContext(compile(`const apply = ${applySource};`) + "\napply;", {
            shouldResetBottomBacklinkPanel,
            updateMobileBottomBacklinkPanel: (_protyle: unknown, reset: boolean) => {
                calls.push(`mobile:${reset}`);
                return pending;
            },
            getAllModels: () => ({editor: [{updateBacklinkPanel: (reset: boolean) => calls.push(`desktop:${reset}`)}]}),
        });
        const current = {backlinkExpandCount: 0, backmentionExpandCount: 0};
        const result = apply(current, {...current, backlinkExpandCount: 1});
        assert.deepEqual(calls, [mobile ? "mobile:true" : "desktop:true"]);
        if (mobile) assert.equal(result, pending);
        saved();
        await result;
    });
}
