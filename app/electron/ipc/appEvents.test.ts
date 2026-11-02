import {test} from "node:test";
import {EventEmitter} from "node:events";
import type {App, BrowserWindow, IpcMain} from "electron";
import type {MarkdownWindows} from "../markdown/windows";
import {createMarkdownLifecycle} from "../markdown/lifecycle";
import {resetRuntimeState, state} from "../shared/runtime";
import {Channel} from "../shared/channels";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
const assert = require("node:assert/strict");

const setup = (t: any) => {
    resetRuntimeState();
    resetElectronStub();
    const events: string[] = [];
    const ipcMain = new EventEmitter();
    const app = Object.assign(new EventEmitter(), {
        quit() {
            events.push("quit");
            let prevented = false;
            app.emit("before-quit", {preventDefault() { prevented = true; }});
            if (!prevented) events.push("terminated");
        },
        exit() { events.push("exit"); },
    });
    mockElectron(t, {app: app as unknown as App, ipcMain: ipcMain as unknown as IpcMain});
    const {registerAppEventIpc} = require("./appEvents");
    const {registerAppLifecycle} = require("../startup/appLifecycle");
    registerAppEventIpc();
    registerAppLifecycle({initMainWindow: () => {}, settingsWindowPolicy: () => undefined});
    t.after(() => {
        resetRuntimeState();
        resetElectronStub();
    });
    return {events, app, closeStartupPage: () => ipcMain.emit(Channel.SIYUAN_FIRST_QUIT)};
};

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

const addWorkspace = (send: (channel: string, exiting: boolean) => void) => {
    state.workspaces.push({
        webContentsId: 1, port: "6806", ownsKernel: true,
        kernelTarget: {mode: "local", origin: "http://127.0.0.1:6806", port: "6806", ownsKernel: true},
        browserWindow: {
            isDestroyed: () => false,
            webContents: {isDestroyed: () => false, getURL: () => "http://127.0.0.1/stage/build/app/", send},
        } as unknown as BrowserWindow,
    });
};

test("closing a startup page quits when no editors have pending work", t => {
    const fixture = setup(t);
    fixture.closeStartupPage();
    assert.deepEqual(fixture.events, ["quit", "terminated"]);
});

test("closing a startup page waits for Markdown saving before quitting", async t => {
    const fixture = setup(t);
    let pending = true;
    let finishSave: (closed: boolean) => void;
    const manager = {
        hasPendingWork: () => pending,
        closeAll: () => {
            fixture.events.push("markdown-save");
            return new Promise<boolean>(resolve => {
                finishSave = closed => { pending = !closed; resolve(closed); };
            });
        },
    } as MarkdownWindows;
    state.markdown.lifecycle = createMarkdownLifecycle({getManager: () => manager, quit: () => fixture.app.quit()});

    fixture.closeStartupPage();
    assert.deepEqual(fixture.events, ["quit", "markdown-save"]);
    finishSave(true);
    await settle();
    assert.deepEqual(fixture.events, ["quit", "markdown-save", "quit", "terminated"]);
});

test("canceling Markdown close or failing to save keeps the app and workspaces open", async t => {
    const fixture = setup(t);
    for (const fails of [false, true]) {
        fixture.events.length = 0;
        state.workspaces.length = 0;
        addWorkspace(() => assert.fail("workspace must remain open"));
        const manager = {
            hasPendingWork: () => true,
            closeAll: async () => {
                fixture.events.push("markdown-save");
                if (fails) throw new Error("save failed");
                return false;
            },
        } as MarkdownWindows;
        state.markdown.lifecycle = createMarkdownLifecycle({getManager: () => manager, quit: () => fixture.app.quit()});

        fixture.closeStartupPage();
        await settle();
        assert.deepEqual(fixture.events, ["quit", "markdown-save"]);
        assert.equal(state.markdown.lifecycle.busy(), false);
        assert.equal(state.workspaces.length, 1);
    }
});

test("closing a startup page requests workspace saving after Markdown windows close", async t => {
    const fixture = setup(t);
    let pending = true;
    const manager = {
        hasPendingWork: () => pending,
        closeAll: async () => { fixture.events.push("markdown-save"); pending = false; return true; },
    } as MarkdownWindows;
    state.markdown.lifecycle = createMarkdownLifecycle({getManager: () => manager, quit: () => fixture.app.quit()});
    addWorkspace((channel, exiting) => {
        assert.equal(channel, Channel.SIYUAN_SAVE_CLOSE);
        assert.equal(exiting, true);
        fixture.events.push("workspace-save");
    });

    fixture.closeStartupPage();
    await settle();
    assert.deepEqual(fixture.events, ["quit", "markdown-save", "quit", "workspace-save"]);
});
