import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [false, true]) {
    test(`exit sync failure offers retry and explicit force exit (mobile=${mobile})`, async () => {
        for (const installPkgPath of ["", "update.dmg"]) {
            const source = createSourceFile("processSystem.ts", parse(readFileSync("src/dialog/processSystem.ts", "utf8"),
                {MOBILE: mobile, BROWSER: true}, false, true), ScriptTarget.ES2021, true);
            const declaration = source.statements.filter(isVariableStatement)
                .flatMap(item => Array.from(item.declarationList.declarations))
                .find(item => item.name.getText(source) === "exitSiYuan");
            const requests: any[] = [];
            const dialogs: any[][] = [];
            const installs: unknown[][] = [];
            let quits = 0;
            const context: any = {
                getSettingsWindowHost: (): undefined => undefined,
                hideAllElements: () => {},
                saveMobileLayout: async () => true,
                getHostCapabilities: () => ({ownsKernel: true}),
                forceQuit: () => quits++,
                escapeHtml: (text: string) => text,
                showMessage: () => assert.fail("sync failure must use a dialog"),
                confirmDialog: (...args: any[]) => dialogs.push(args),
                installNewVersion: (...args: unknown[]) => installs.push(args),
                requestSystemExit: async (options: unknown, callback: (response: unknown) => void) => {
                    requests.push(options);
                    callback(requests.length === 1 ? {code: 1, data: {installPkgPath}} : {code: 0});
                },
                window: {siyuan: {languages: {sync: "Sync", retry: "Retry", _kernel: {96: "Sync failed", 97: "Force exit"}}}},
            };
            context.exitSiYuan = runInNewContext(transpileModule(`const exitSiYuan = ${declaration.initializer.getText(source)}; exitSiYuan;`, {
                compilerOptions: {target: ScriptTarget.ES2021},
            }).outputText, context);
            await context.exitSiYuan(false);
            assert.equal(quits, 0);
            assert.equal(dialogs.length, 1);
            const dialog = dialogs[0];
            assert.equal(dialog[1], "Sync failed");
            assert.equal(dialog[3], undefined);
            assert.equal(dialog[5].label, "Force exit");
            assert.equal(dialog[6], "Retry");
            dialog[2]();
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(requests[1].force, false);
            assert.equal(requests[1].setCurrentWorkspace, false);
            assert.equal(quits, 1);
            dialog[5].callback();
            if (installPkgPath) {
                assert.deepEqual(installs, [[installPkgPath, false]]);
                assert.equal(requests.length, 2);
            } else {
                assert.equal(requests[2].force, true);
                assert.equal(requests[2].setCurrentWorkspace, false);
                assert.equal(quits, 2);
            }
        }
    });
}
