import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const forms = readFileSync("src/card/flashcardV2Form.ts", "utf8");
const operation = forms.slice(forms.indexOf("export const createFlashcardV2Operation ="), forms.indexOf("// 展开错误字段"))
    .replace("export const", "const");
const submission = source.slice(source.indexOf("const setFlashcardV2ReviewSetMembership ="),
    source.indexOf("const openFlashcardV2Membership ="));
const js = (s: string) => transpileModule(s, {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText;
const setup = () => {
    let id = 0;
    const requests: Array<{payload: {operationID: string, changedAt: number, cardIDs: string[], mode: string},
        succeed: () => void, finish: () => void, reject: (error: Error) => void}> = [];
    const factory = runInNewContext(js(`${operation}\n${submission}\ncreateFlashcardV2MembershipSubmission;`), {
        genUUID: () => `op-${++id}`,
        fetchPost: (_url: string, payload: typeof requests[number]["payload"], succeed: () => void) =>
            new Promise<void>((finish, reject) => { requests.push({payload, succeed, finish, reject}); }),
    }) as () => {pending: boolean, submit: (deck: string, cards: string | string[], mode: string, cb: () => void) => Promise<boolean>};
    return {requests, factory};
};

test("membership submissions block duplicate single and batch actions until settlement", async () => {
    const {requests, factory} = setup();
    const submitter = factory();
    let changes = 0;
    const first = submitter.submit("deck", "card", "exclude", () => changes++);
    assert.equal(submitter.pending, true);
    assert.equal(await submitter.submit("deck", ["card", "other"], "exclude", () => changes++), false);
    assert.equal(requests.length, 1);
    requests[0].succeed(); requests[0].finish();
    assert.equal(await first, true);
    assert.equal(submitter.pending, false);
    assert.equal(changes, 1);
});

test("business failure and transport rejection retain normalized retry identity", async () => {
    const {requests, factory} = setup();
    const submitter = factory();
    let changes = 0;
    const failed = submitter.submit("deck", ["b", "a", "a"], "include", () => changes++);
    requests[0].finish();
    assert.equal(await failed, false);
    const rejected = submitter.submit("deck", ["a", "b"], "include", () => changes++);
    assert.equal(requests[1].payload.operationID, requests[0].payload.operationID);
    assert.equal(requests[1].payload.changedAt, requests[0].payload.changedAt);
    requests[1].reject(new Error("network"));
    await assert.rejects(rejected, /network/);
    assert.equal(submitter.pending, false);
    const retry = submitter.submit("deck", ["b", "a"], "include", () => changes++);
    assert.equal(requests[2].payload.operationID, requests[0].payload.operationID);
    requests[2].succeed(); requests[2].finish();
    assert.equal(await retry, true);
    assert.equal(changes, 1);
    const later = submitter.submit("deck", ["a", "b"], "include", () => changes++);
    assert.notEqual(requests[3].payload.operationID, requests[0].payload.operationID);
    requests[3].finish(); await later;
});

test("different mode or target gets a new identity without retaining an unbounded cache", async () => {
    const {requests, factory} = setup();
    const submitter = factory();
    for (const [deck, mode] of [["one", "include"], ["one", "automatic"], ["two", "automatic"], ["one", "include"]]) {
        const result = submitter.submit(deck, "card", mode, () => {});
        requests.at(-1).finish(); await result;
    }
    assert.equal(new Set(requests.map(r => r.payload.operationID)).size, 4);
});

test("dialog submission freezes controls, retries failure, and keeps data refresh after closing", async () => {
    const form = forms.slice(forms.indexOf("export const submitFlashcardV2Form ="), forms.indexOf("// 多选使用"))
        .replace("export const", "const");
    const start = source.indexOf("const openFlashcardV2Membership =");
    const dialogSource = source.slice(start, source.indexOf("const basicSourceDirection =", start));
    for (const closing of [false, true]) {
        const {requests, factory} = setup();
        const listeners: Array<() => void> = [];
        const controls = [0, 1].map(i => ({disabled: false, addEventListener: (_event: string, cb: () => void) => { listeners[i] = cb; }}));
        const attrs = new Map<string, string>();
        let changed = 0;
        let destroyed = 0;
        let failures = 0;
        const element = {isConnected: true, dataset: {} as Record<string, string>,
            getAttribute: (key: string) => attrs.get(key), setAttribute: (key: string, value: string) => attrs.set(key, value),
            removeAttribute: (key: string) => attrs.delete(key), querySelectorAll: () => controls,
            querySelector: (key: string) => ({value: key.includes("reviewSet") ? "deck" : "include",
                addEventListener: () => {}, classList: {toggle: () => {}}})};
        runInNewContext(js(`${form}\n${dialogSource}\nopenFlashcardV2Membership("card", changed);`), {
            window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)})}},
            isMobile: () => false, escapeHtml: (s: string) => s, escapeAttr: (s: string) => s,
            fetchPost: (_url: string, _data: unknown, cb: (response: unknown) => void) => cb({data: {entities: [{entityID: "deck", payload: {name: "Deck"}}]}}),
            readFlashcardV2Revision: (r: unknown) => r, isFlashcardReviewSet: () => true,
            createFlashcardV2MembershipSubmission: factory,
            Dialog: class {element = element; destroy() { destroyed++; }},
            changed: () => changed++, showMessage: () => failures++, console,
        });
        listeners[1](); listeners[1]();
        assert.equal(requests.length, 1);
        assert.ok(controls.every(control => control.disabled));
        requests[0].finish();
        for (let i = 0; i < 10; i++) { await Promise.resolve(); }
        assert.ok(controls.every(control => !control.disabled));
        assert.equal(failures, 1);
        listeners[1]();
        assert.equal(requests[1].payload.operationID, requests[0].payload.operationID);
        if (closing) { element.dataset.dialogClosing = "true"; }
        requests[1].succeed(); requests[1].finish();
        for (let i = 0; i < 10; i++) { await Promise.resolve(); }
        assert.equal(changed, 1);
        assert.equal(destroyed, closing ? 0 : 1);
    }
});

test("single and batch removals share the owner submission across page refreshes", () => {
    const management = source.slice(source.indexOf("const openFlashcardV2ReviewSetCards ="));
    assert.match(management, /owner\.membershipSubmission \|\|= createFlashcardV2MembershipSubmission\(\)/);
    assert.match(management, /void removeMembership\(selected, target\)/);
    assert.match(management, /void removeMembership\(item\.dataset\.id, target\)/);
    assert.match(management, /owner\.membershipSubmission\.pending \|\| listenerOptions\.signal\.aborted/);
});

test("rerendered direct actions share the pending lock without touching unrelated controls", async () => {
    const {requests, factory} = setup();
    const start = source.indexOf("            owner.membershipSubmission ||=");
    const end = source.indexOf('            dialog.element.addEventListener("click"', start);
    const code = js(`${source.slice(start, end)}\nremoveMembership;`);
    const owner = {};
    let refreshes = 0;
    let failures = 0;
    class Button {
        disabled = false;
        isConnected = true;
        dataset = {type: "exclude"};
        attrs = new Map<string, string>();
        setAttribute(key: string, value: string) { this.attrs.set(key, value); }
        removeAttribute(key: string) { this.attrs.delete(key); }
    }
    const unrelated = new Button();
    unrelated.disabled = true;
    const bind = () => {
        const controller = new AbortController();
        const element = {isConnected: true, dataset: {} as Record<string, string>};
        const remove = runInNewContext(code, {owner, createFlashcardV2MembershipSubmission: factory,
            listenerOptions: {signal: controller.signal}, dialog: {element}, HTMLButtonElement: Button,
            reviewSetID: "deck", reloadPage: () => refreshes++, console,
            window: {siyuan: {languages: {flashcardSaveFailed: "Failed"}}},
            showMessage: () => failures++, refreshSelection: () => {},
        }) as (ids: string | string[], target: Button) => Promise<void>;
        return {controller, element, remove};
    };
    const firstPage = bind();
    const firstButton = new Button();
    const first = firstPage.remove("card", firstButton);
    assert.equal(firstButton.disabled, true);
    firstPage.controller.abort();
    firstButton.isConnected = false;
    const secondPage = bind();
    const batch = new Button();
    await secondPage.remove(["card", "other"], batch);
    assert.equal(requests.length, 1);
    assert.equal(batch.disabled, false);
    requests[0].finish(); await first;
    assert.equal(failures, 0);
    assert.equal(firstButton.disabled, true);
    const retry = secondPage.remove("card", batch);
    assert.equal(requests[1].payload.operationID, requests[0].payload.operationID);
    requests[1].finish(); await retry;
    assert.equal(batch.disabled, false);
    assert.equal(unrelated.disabled, true);
    assert.equal(failures, 1);
    const last = secondPage.remove("card", batch);
    secondPage.element.dataset.dialogClosing = "true";
    requests[2].succeed(); requests[2].finish(); await last;
    assert.equal(refreshes, 1);
    assert.equal(batch.disabled, true);
    assert.equal(unrelated.disabled, true);
});
