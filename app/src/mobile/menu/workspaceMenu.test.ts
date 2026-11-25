import * as assert from "node:assert/strict";
import {posix} from "node:path";
import {test} from "node:test";
import type {IConfirmDialogOptions} from "../../dialog/confirmDialog";
import {loadModule} from "../../testSupport/loadModule";
import {escapeHtmlTextAndAttr} from "../../util/escape";

test("workspace menu refreshes its rows and switching requires confirmation", async () => {
    const currentPath = "/workspaces/Current";
    const targetPath = '/workspaces/Next "${x}" & notes';
    const requests: Array<{signal: AbortSignal; publish: (paths: string[]) => void}> = [];
    const switches: string[] = [];
    const confirmations: IConfirmDialogOptions[] = [];
    let rendered = 0;
    let eligible = true;
    const list = {innerHTML: ""} as Element;
    const element = {querySelector: () => list} as unknown as HTMLElement;
    const sandbox = {
        AbortController,
        window: {siyuan: {
            get isPublish() { return !eligible; },
            config: {system: {workspaceDir: currentPath}},
            languages: {
                mobileWorkspaceSwitchTitle: "Switch to “${x}”?",
                mobileWorkspaceSwitchTip: "Reopen the app",
                mobileWorkspaceSwitch: "Switch",
            },
        }},
        require: () => ({
            canManageMobileWorkspaces: () => eligible,
            isInMobileApp: () => true,
            getHostCapabilities: () => ({workspaces: true}),
            confirmDialog: (options: IConfirmDialogOptions) => { confirmations.push(options); },
            switchWorkspace: async (path: string) => { switches.push(path); },
            escapeHtmlTextAndAttr,
            pathPosix: () => posix,
            fetchPost: (url: string, _body: unknown, callback: (response: unknown) => void,
                        _headers: unknown, _fail: unknown, signal: AbortSignal) => {
                assert.equal(url, "/api/system/getWorkspaces");
                requests.push({signal, publish: paths => callback({data: paths.map(path => ({path}))})});
            },
        }),
    };
    const workspace = loadModule<typeof import("./workspaceMenu")>("src/mobile/menu/workspaceMenu.ts", sandbox);
    const manager = loadModule<typeof import("./workspaceManager")>("src/mobile/menu/workspaceManager.ts", sandbox);

    const refresh = workspace.mountMobileWorkspaceMenu(element, () => { rendered++; });
    assert.match(list.innerHTML, /aria-current="true"[\s\S]*Current/);
    refresh();
    refresh();
    assert.equal(requests[0].signal.aborted, true);
    requests[1].publish([targetPath, currentPath]);
    assert.equal(list.innerHTML.match(/aria-current="true"/g)?.length, 1);
    assert.ok(list.innerHTML.includes(`data-workspace-path="${escapeHtmlTextAndAttr(targetPath)}"`));
    requests[1].publish([targetPath, currentPath]);
    assert.equal(rendered, 2);

    manager.confirmMobileWorkspaceSwitch(currentPath);
    assert.equal(confirmations.length, 0);
    manager.confirmMobileWorkspaceSwitch(targetPath);
    const [confirmation] = confirmations;
    assert.equal(confirmation.title, "Switch to “Next &quot;${x}&quot; &amp; notes”?");
    assert.equal(confirmation.confirmLabel, "Switch");
    assert.deepEqual(switches, []);
    await confirmation.confirm();
    assert.deepEqual(switches, [targetPath]);

    eligible = false;
    assert.equal(workspace.mountMobileWorkspaceMenu(element, () => {}), undefined);
    manager.confirmMobileWorkspaceSwitch(targetPath);
    assert.equal(confirmations.length, 1);
});
