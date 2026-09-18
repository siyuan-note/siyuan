import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

type LinuxInputMethodSetting = {enabled: boolean; override: boolean | null};
type Invoke = (channel: string, data: {cmd: string; enabled?: boolean}) => Promise<LinuxInputMethodSetting>;
type Slot = {key: string; html: () => string; afterMount: (root: unknown) => Promise<void>};

const getLinuxInputMethodSlot = (browser: boolean, mobile: boolean, invoke?: Invoke, platform = "linux"): Slot | undefined => {
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/appTab.ts"), "utf8");
    const processed = parse(source, {BROWSER: browser, MOBILE: mobile}, false, true);
    const code = transpileModule(processed, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const moduleExports: {registerAppTab?: (tab: unknown) => void} = {};
    runInNewContext(code, {
        exports: moduleExports,
        process: {platform},
        console: {warn: (): void => undefined},
        window: {siyuan: {
            languages: new Proxy({}, {get: (_, key) => String(key)}),
            config: {system: {isMicrosoftStore: true}},
        }},
        require: (name: string) => {
            if (name === "electron") {
                assert.equal(browser, false);
                return {ipcRenderer: {invoke}};
            }
            if (name === "../../constants") {
                return {Constants: {SIYUAN_GET: "siyuan-get"}};
            }
            if (name === "../../util/hostCapabilities") {
                return {getHostCapabilities: () => ({importExport: false, workspaces: false})};
            }
            return new Proxy({}, {get: () => () => ""});
        },
    });
    const slots: Slot[] = [];
    const group = new Proxy({}, {
        get: (_, method) => (value: Slot) => {
            if (method === "slot") {
                slots.push(value);
            }
        },
    });
    moduleExports.registerAppTab({group: () => group});
    return slots.find(slot => slot.key === "linuxInputMethod");
};

const controls = () => {
    let change: () => Promise<void>;
    const input = {
        checked: false,
        disabled: true,
        addEventListener: (_: string, listener: () => Promise<void>) => { change = listener; },
    };
    const status = {textContent: "", classList: {toggle: (): void => undefined}};
    const root = {querySelector: (selector: string) => selector === "#linuxInputMethod" ? input : status};
    return {root, input, status, change: () => change()};
};

test("Linux input method preference is available in Electron but excluded from browser and mobile", () => {
    assert.ok(getLinuxInputMethodSlot(false, false));
    assert.equal(getLinuxInputMethodSlot(true, false), undefined);
    assert.equal(getLinuxInputMethodSlot(true, true), undefined);
});

test("Linux input method preference loads and saves through the desktop process", async () => {
    let saved = false;
    const slot = getLinuxInputMethodSlot(false, false, async (channel, data) => {
        assert.equal(channel, "siyuan-get");
        if (data.cmd === "setLinuxInputMethodSetting") {
            saved = data.enabled;
        }
        return {enabled: saved, override: null};
    });
    const view = controls();
    await slot.afterMount(view.root);
    assert.equal(view.input.checked, false);
    assert.equal(view.input.disabled, false);
    view.input.checked = true;
    await view.change();
    assert.equal(saved, true);
    const reopened = controls();
    await slot.afterMount(reopened.root);
    assert.equal(reopened.input.checked, true);
});

test("startup overrides display their effective state and explain the locked control", async () => {
    for (const override of [false, true]) {
        const slot = getLinuxInputMethodSlot(false, false, async () => ({enabled: !override, override}));
        const view = controls();
        await slot.afterMount(view.root);
        assert.equal(view.input.checked, override);
        assert.equal(view.input.disabled, true);
        assert.equal(view.status.textContent, "linuxInputMethodOverrideTip");
    }
});

test("read failures keep the preference disabled and visible to the user", async () => {
    const slot = getLinuxInputMethodSlot(false, false, async () => { throw new Error("Unavailable"); });
    const view = controls();
    await slot.afterMount(view.root);
    assert.equal(view.input.disabled, true);
    assert.equal(view.status.textContent, "linuxInputMethodError");
});

test("save failures restore the previous choice and allow retry", async () => {
    const slot = getLinuxInputMethodSlot(false, false, async (_, data) => {
        if (data.cmd === "setLinuxInputMethodSetting") {
            throw new Error("Unable to save");
        }
        return {enabled: false, override: null};
    });
    const view = controls();
    await slot.afterMount(view.root);
    view.input.checked = true;
    await view.change();
    assert.equal(view.input.checked, false);
    assert.equal(view.input.disabled, false);
    assert.equal(view.status.textContent, "linuxInputMethodError");
});

test("Linux input method preference is hidden on other desktop platforms", () => {
    for (const platform of ["win32", "darwin"]) {
        assert.equal(getLinuxInputMethodSlot(false, false, undefined, platform), undefined);
    }
});
