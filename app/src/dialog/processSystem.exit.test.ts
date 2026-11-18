import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeHtml, escapeHtmlTextAndAttr} from "../util/escape";

const {parse} = require("ifdef-loader/preprocessor");
const question = "Install new version?";
const warning = "<span class='ft__on-surface'>Wait for SiYuan to exit</span>";
const installMessage = `${question}<br><br>${warning}`;
const confirmSource = transpileModule(readFileSync("src/dialog/confirmDialog.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const mobile of [false, true]) {
    for (const releaseURL of [undefined, "javascript:alert(1)",
        "https://ld246.com/article/123?lang=zh-CN&title=\"$&<release>\"",
        "https://github.com/siyuan-note/siyuan/releases/tag/v3.8.11-beta.3"]) {
        test(`downloaded update prompt uses the package announcement (${releaseURL}, mobile=${mobile})`, async () => {
            const source = createSourceFile("processSystem.ts", parse(readFileSync("src/dialog/processSystem.ts", "utf8"),
                {MOBILE: mobile, BROWSER: true}, false, true), ScriptTarget.ES2021, true);
            const declaration = source.statements.filter(isVariableStatement)
                .flatMap(item => Array.from(item.declarationList.declarations))
                .find(item => item.name.getText(source) === "exitSiYuan");
            const dialogs: (import("./confirmDialog").IConfirmDialogOptions & {confirm: () => void, cancel: () => void})[] = [];
            const rendered: string[] = [];
            const installs: unknown[][] = [];
            const requests: any[] = [];
            let quits = 0;
            const context = {
                clearReloadSnapshot() {}, getSettingsWindowHost: (): undefined => undefined,
                hideAllElements() {}, hideMessage() {}, saveMobileLayout: async () => true,
                getHostCapabilities: () => ({ownsKernel: true}),
                forceQuit: () => quits++, escapeHtml, escapeHtmlTextAndAttr,
                installNewVersion: (...args: unknown[]) => installs.push(args),
                requestSystemExit: async (options: unknown, callback: (response: unknown) => void) => {
                    requests.push(options);
                    callback(requests.length === 1 ? {code: 2, msg: installMessage, data: {installPkgPath: "update.dmg", releaseURL}} : {code: 0});
                },
                window: {siyuan: {config: {system: {}}, languages: {
                    updateVersion: "Update", updateReleaseAnnouncement: "Release announcement: ${link}",
                    updateInstallNow: "Install now", updateInstallLater: "Not now",
                }}},
            };
            const exports = {} as typeof import("./confirmDialog");
            class TestDialog {
                element = {addEventListener() {}, setAttribute() {}, querySelector: () => ({focus() {}})};
                constructor({content}: {content: string}) { rendered.push(content); }
                focusWhenReady() {}
            }
            runInNewContext(confirmSource, {
                exports, window: context.window, document: {activeElement: null},
                require: () => ({isMobile: () => mobile, Constants: {}, Dialog: TestDialog, AdaptiveDialog: TestDialog}),
            });
            const exit = runInNewContext(transpileModule(`const exitSiYuan = ${declaration.initializer.getText(source)}; exitSiYuan;`, {
                compilerOptions: {target: ScriptTarget.ES2021},
            }).outputText, {...context, confirmDialog: (options: (typeof dialogs)[number]) => {
                dialogs.push(options);
                return exports.confirmDialog(options);
            }});
            await exit(false);
            assert.equal(installs.length, 0);
            assert.equal(quits, 0);
            assert.equal(rendered.length, 1);
            assert.match(rendered[0], /id="confirmDialogConfirmBtn">Install now<\/button>/);
            assert.match(rendered[0], /id="cancelDialogConfirmBtn">Not now<\/button>/);
            if (releaseURL?.startsWith("https://")) {
                const escapedURL = escapeHtmlTextAndAttr(releaseURL);
                assert.equal(dialogs[0].text, `${question}<br><br>Release announcement: <a href="${escapedURL}" target="_blank" rel="noopener">${escapedURL}</a><br><br>${warning}`);
            } else {
                assert.equal(dialogs[0].text, installMessage);
            }
            dialogs[0].confirm();
            assert.deepEqual(installs, [["update.dmg", false]]);
            dialogs[0].cancel();
            assert.equal(requests[1].execInstallPkg, 1);
            assert.equal(requests[1].force, true);
            assert.equal(quits, 1);
        });
    }

    test(`exit sync failure offers retry and explicit force exit (mobile=${mobile})`, async () => {
        for (const installPkgPath of ["", "update.dmg"]) {
            const source = createSourceFile("processSystem.ts", parse(readFileSync("src/dialog/processSystem.ts", "utf8"),
                {MOBILE: mobile, BROWSER: true}, false, true), ScriptTarget.ES2021, true);
            const declaration = source.statements.filter(isVariableStatement)
                .flatMap(item => Array.from(item.declarationList.declarations))
                .find(item => item.name.getText(source) === "exitSiYuan");
            const requests: any[] = [];
            const dialogs: any[] = [];
            const installs: unknown[][] = [];
            let quits = 0;
            const context: any = {
                clearReloadSnapshot: () => {},
                getSettingsWindowHost: (): undefined => undefined,
                hideAllElements: () => {},
                saveMobileLayout: async () => true,
                getHostCapabilities: () => ({ownsKernel: true}),
                forceQuit: () => quits++,
                escapeHtml: (text: string) => text,
                showMessage: () => assert.fail("sync failure must use a dialog"),
                confirmDialog: (options: any) => dialogs.push(options),
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
            assert.equal(dialog.text, "Sync failed");
            assert.equal(dialog.cancel, undefined);
            assert.equal(dialog.extraAction.label, "Force exit");
            assert.equal(dialog.confirmLabel, "Retry");
            dialog.confirm();
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(requests[1].force, false);
            assert.equal(requests[1].setCurrentWorkspace, false);
            assert.equal(quits, 1);
            dialog.extraAction.callback();
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
