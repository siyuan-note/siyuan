import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

type AccessibilitySetting = {enabled: boolean; override: boolean | null};
type Invoke = (channel: string, data: {cmd: string; enabled?: boolean}) => Promise<AccessibilitySetting>;
type Slot = {key: string; html: () => string; afterMount: (root: unknown) => Promise<void>};

const getAccessibilitySlot = (browser: boolean, mobile: boolean, invoke?: Invoke): Slot | undefined => {
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/appTab.ts"), "utf8");
    const processed = parse(source, {BROWSER: browser, MOBILE: mobile}, false, true);
    const code = transpileModule(processed, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const moduleExports: {registerAppTab?: (tab: unknown) => void} = {};
    runInNewContext(code, {
        exports: moduleExports,
        process: {platform: "win32"},
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
    return slots.find(slot => slot.key === "accessibilitySupport");
};

const controls = () => {
    let change: () => Promise<void>;
    const input = {
        checked: false,
        disabled: true,
        addEventListener: (_: string, listener: () => Promise<void>) => { change = listener; },
    };
    const status = {textContent: "", classList: {toggle: (): void => undefined}};
    const root = {querySelector: (selector: string) => selector === "#accessibilitySupport" ? input : status};
    return {root, input, status, change: () => change()};
};

test("accessibility preference is available in Electron but excluded from browser and mobile", () => {
    assert.ok(getAccessibilitySlot(false, false));
    assert.equal(getAccessibilitySlot(true, false), undefined);
    assert.equal(getAccessibilitySlot(true, true), undefined);
});

test("accessibility preference loads and saves through the desktop process", async () => {
    let saved = false;
    const slot = getAccessibilitySlot(false, false, async (channel, data) => {
        assert.equal(channel, "siyuan-get");
        if (data.cmd === "setAccessibilitySetting") {
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
        const slot = getAccessibilitySlot(false, false, async () => ({enabled: !override, override}));
        const view = controls();
        await slot.afterMount(view.root);
        assert.equal(view.input.checked, override);
        assert.equal(view.input.disabled, true);
        assert.equal(view.status.textContent, "accessibilitySupportOverrideTip");
    }
});

test("read failures keep the preference disabled and visible to the user", async () => {
    const slot = getAccessibilitySlot(false, false, async () => { throw new Error("Unavailable"); });
    const view = controls();
    await slot.afterMount(view.root);
    assert.equal(view.input.disabled, true);
    assert.equal(view.status.textContent, "accessibilitySupportError");
});

test("save failures restore the previous choice and allow retry", async () => {
    const slot = getAccessibilitySlot(false, false, async (_, data) => {
        if (data.cmd === "setAccessibilitySetting") {
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
    assert.equal(view.status.textContent, "accessibilitySupportError");
});
