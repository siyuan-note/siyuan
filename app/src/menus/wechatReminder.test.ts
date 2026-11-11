import * as assert from "node:assert/strict";
import {test} from "node:test";
import dayjs from "dayjs";
import {loadModule} from "../testSupport/loadModule";

const setup = (mobile: boolean) => {
    class Control {
        value = "";
        attributes: Record<string, string> = {};
        listeners: Record<string, () => void> = {};
        addEventListener(type: string, listener: () => void) { this.listeners[type] = listener; }
        getAttribute(name: string) { return this.attributes[name]; }
        setAttribute(name: string, value: string) { this.attributes[name] = value; }
        click() { this.listeners.click?.(); }
    }
    class ReminderDialog {
        input = new Control();
        buttons = [new Control(), new Control(), new Control()];
        closed = false;
        pending = false;
        dateValid = true;
        dateDestroyed = false;
        options: {destroyCallback?: () => void};
        element = {
            setAttribute() {},
            querySelector: () => this.input,
            querySelectorAll: () => this.buttons,
        };
        constructor(options: {destroyCallback?: () => void}) { this.options = options; dialogs.push(this); }
        destroy() { this.closed = true; this.options.destroyCallback?.(); }
        async runPending(action: () => Promise<boolean>) {
            if (this.pending) return;
            this.pending = true;
            try { if (await action()) this.destroy(); } finally { this.pending = false; }
        }
    }
    const dialogs: ReminderDialog[] = [];
    const bound: Control[] = [];
    const activated: Control[] = [];
    const writes: {id: string; timed: string}[] = [];
    const messages: string[] = [];
    let release: (result: {code: number}) => void;
    const attrs = new Map([["data-node-id", "block"], ["reminder", "20261111120000"]]);
    const node = {getAttribute: (name: string) => attrs.get(name),
        setAttribute: (name: string, value: string) => attrs.set(name, value),
        removeAttribute: (name: string) => attrs.delete(name)};
    const methods = loadModule<typeof import("./commonMenuItem")>("src/menus/commonMenuItem.ts", {
        window: {siyuan: {languages: {
            reminderTip: "Future time required", notEmpty: "Required", wechatTip: "Reminder delivery notice",
        }}},
        document: {createElement: () => ({
            textContent: "",
            get innerHTML() {
                return this.textContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            },
        })},
        require: (name: string) => ({
            "dayjs": dayjs,
            "../dialog/mobileDialog": {MobileDialog: ReminderDialog},
            "../datePicker/inline": {getInlineDateValue: (input: Control) => input.value.replace(" ", "T"), bindInlineDatePicker: (_host: unknown, input: Control) => {
                bound.push(input);
                const dialog = dialogs.at(-1);
                return {activate: (target: Control) => activated.push(target),
                    validate: () => dialog.dateValid, destroy: () => { dialog.dateDestroyed = true; }};
            }},
            "../constants": {Constants: {CUSTOM_REMINDER_WECHAT: "reminder"}},
            "../util/functions": {isMobile: () => mobile},
            "../util/pathName": {isEncryptedBox: () => false},
            "../protyle/util/selection": {getEditorRange: () => ({})},
            "../protyle/util/selectionOffsets": {focusByRange() {}},
            "../dialog/message": {showMessage: (message: string) => messages.push(message)},
            "../util/fetch": {
                fetchPost: (path: string, data: {id: string; timed: string}, callback: (value?: unknown) => void) => {
                    if (path.endsWith("getDocInfo")) callback({data: {ial: {}}});
                    else { writes.push(data); callback(); }
                },
                fetchSyncPost: (_path: string, data: {id: string; timed: string}) => {
                    writes.push(data);
                    return new Promise(resolve => { release = resolve; });
                },
            },
        })[name] || {},
    });
    return {methods, dialogs, writes, bound, activated, messages, attrs,
        node: node as unknown as Element, release: (code: number) => release({code})};
};

test("existing WeChat reminders keep picker changes local until explicit future-time confirmation", () => {
    for (const file of [false, true]) {
        const f = setup(false);
        if (file) f.methods.openFileWechatNotify("document", "notebook");
        else f.methods.openWechatNotify(f.node);
        const dialog = f.dialogs[0];
        assert.deepEqual(f.bound, [dialog.input]);
        assert.deepEqual(f.activated, [dialog.input]);
        assert.equal(f.writes.length, 0, "initial calendar activation sends no reminder");
        dialog.dateValid = false;
        dialog.input.value = "2099-12-31T23:59";
        dialog.buttons[2].click();
        assert.equal(f.writes.length, 0, "invalid calendar drafts block host confirmation");
        dialog.dateValid = true;
        dialog.input.value = "2000-01-01T00:00";
        dialog.buttons[2].click();
        assert.equal(f.writes.length, 0);
        assert.deepEqual(f.messages, ["Future time required"]);
        dialog.input.value = "";
        dialog.buttons[2].click();
        assert.equal(f.writes.length, 0, "clearing the picker does not remove a reminder");
        assert.equal(f.messages.at(-1), "Required");
        dialog.input.value = "2099-12-31T23:59";
        assert.equal(f.writes.length, 0, "selecting a date does not send a reminder request");
        dialog.buttons[2].click();
        assert.deepEqual(JSON.parse(JSON.stringify(f.writes)), [{id: file ? "document" : "block", timed: "20991231235900"}]);
        assert.equal(dialog.closed, true);
        assert.equal(dialog.dateDestroyed, true);
    }
});

test("mobile WeChat reminder confirmation and explicit removal retain pending protection", async () => {
    for (const remove of [false, true]) {
        const f = setup(true);
        f.methods.openWechatNotify(f.node);
        const dialog = f.dialogs[0];
        dialog.input.value = "2099-12-31T23:59";
        dialog.buttons[remove ? 1 : 2].click();
        dialog.buttons[remove ? 1 : 2].click();
        assert.equal(f.writes.length, 1);
        assert.equal(f.writes[0].timed, remove ? "0" : "20991231235900");
        assert.equal(dialog.closed, false);
        f.release(0);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(dialog.closed, true);
        assert.equal(dialog.dateDestroyed, true);
        assert.equal(f.attrs.get("reminder"), remove ? undefined : "20991231235900");
    }
});

test("reminder cancel destroys the embedded editor without sending", () => {
    for (const file of [false, true]) {
        const f = setup(false);
        if (file) f.methods.openFileWechatNotify("document", "notebook");
        else f.methods.openWechatNotify(f.node);
        const dialog = f.dialogs[0];
        dialog.input.value = "2099-12-31T23:59";
        dialog.buttons[0].click();
        assert.equal(f.writes.length, 0);
        assert.equal(dialog.dateDestroyed, true);
    }
});
