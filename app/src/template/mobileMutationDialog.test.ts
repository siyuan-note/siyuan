import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {getFileRenameTarget} from "../util/fileTree";

const source = readFileSync("src/template/manager.ts", "utf8");
const dialogSource = readFileSync("src/dialog/mobileDialog.ts", "utf8");
const between = (text: string, start: string, end: string) => {
    const first = text.indexOf(start);
    const last = text.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `Missing source boundary: ${start}`);
    return text.slice(first, last);
};
const evaluate = (body: string, context: object) => runInNewContext(transpileModule(body, {
    compilerOptions: {target: ScriptTarget.ES2020},
}).outputText, context);
const pendingContext = {Pending: undefined as any};
evaluate(`class Pending {
${between(dialogSource, "        public async runPending(", "        public focusWhenReady(")}
}\nthis.Pending = Pending;`, pendingContext);

type Action = "move" | "remove" | "rename" | "new" | "mkdir";
type Outcome = "success" | "false" | "reject";
const setup = (action: Action) => {
    const requests: Record<string, unknown>[] = [];
    const refreshes: unknown[][] = [];
    const messages: unknown[][] = [];
    let outcome: Outcome = "success";
    let refresh: () => Promise<void> = async () => {};
    let prompt: Prompt;
    const setPrompt = (value: Prompt) => { prompt = value; };
    let confirm: () => void;
    let toolbar: (event: unknown) => void;
    class Prompt extends pendingContext.Pending {
        pending = false;
        checking = false;
        disposed = false;
        locked = false;
        closes = 0;
        promise: Promise<boolean>;
        input = {value: "", focus() {}, setCustomValidity() {}, reportValidity() {}, addEventListener() {}};
        destination = {value: "", add() {}};
        element = {dataset: {} as Record<string, string>, querySelector: (selector: string) => {
            if (selector === "input") return this.input;
            if (selector === "select") return this.destination;
            return {addEventListener: (_event: string, callback: () => void) => {
                if (selector === "[data-action=confirm]") confirm = callback;
            }};
        }};
        constructor() {
            super();
            setPrompt(this);
        }
        lockEditing() {
            this.locked = true;
            return () => { this.locked = false; };
        }
        destroy() {
            this.closes++;
            this.disposed = true;
            this.element.dataset.dialogClosing = "true";
        }
        async requestClose() {
            this.destroy();
            return true;
        }
        runPending(task: () => Promise<boolean>) {
            this.promise = super.runPending(task);
            return this.promise;
        }
    }
    const context = {
        busy: false, closed: false, mobile: true,
        selected: {path: "templates/original.md", isDir: false},
        entries: [{path: "destination", isDir: true}],
        lang: {untitled: "Untitled"}, update() {}, dirty: () => false,
        guard: (callback: () => void) => callback(),
        getTemplateActionState: () => ({ariaDisabled: false}),
        getFileRenameTarget, replaceFileName: (value: string) => value,
        escapeHtml: (value: string) => value.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        showMessage: (...args: unknown[]) => messages.push(args),
        api: async (request: Record<string, unknown>) => {
            requests.push(request);
            if (outcome === "reject") throw Error("mutation failed");
            return outcome === "success" ? {} : undefined;
        },
        reload: async (...args: unknown[]) => {
            refreshes.push(args);
            await refresh();
        },
        MobileDialog: Prompt,
        Option: class {},
        mobileInputDialog: (options: any) => {
            assert.equal(options.awaitConfirm, true);
            const dialog = new Prompt();
            dialog.input.value = options.value;
            confirm = () => { void dialog.runPending(() => options.onConfirm(dialog.input.value, dialog)); };
            return dialog;
        },
        mobileConfirmDialog: (_title: string, _content: string, callback: () => Promise<boolean>,
                              _cancel: unknown, _remove: boolean, _width: unknown, _id: unknown, options: any) => {
            assert.equal(options.awaitConfirm, true);
            const dialog = new Prompt();
            confirm = () => { void dialog.runPending(callback); };
            return dialog;
        },
        element: {addEventListener: (_event: string, callback: typeof toolbar) => { toolbar = callback; }},
        preview: {contains: () => false},
        actOnEntry: undefined as (action: string, target: unknown) => void,
    };
    evaluate([
        between(source, "    const run =", "    const api ="),
        between(source, "    const refreshAfterMutation =", "    const inputPath ="),
        between(source, "    const inputPath =", "    const openSourceDocument ="),
        between(source, "    const actOnEntry =", "    const refreshPermissions ="),
        between(source, "    element.addEventListener(\"click\", event => {", "    update();\n    void run"),
        "this.actOnEntry = actOnEntry;",
    ].join("\n"), context);
    if (action === "new" || action === "mkdir") {
        toolbar({target: {closest: () => ({dataset: {action}, disabled: false})}});
        prompt.input.value = "templates/created";
    } else {
        context.actOnEntry(action, {entry: context.selected, revision: "original-revision"});
        if (action === "move") prompt.destination.value = "destination";
        if (action === "rename") prompt.input.value = "renamed.md";
    }
    return {
        context, prompt, requests, refreshes, messages,
        setOutcome: (value: Outcome) => { outcome = value; },
        setRefresh: (value: () => Promise<void>) => { refresh = value; },
        submit: () => { confirm(); return prompt.promise; },
    };
};

for (const action of ["move", "remove", "rename", "new", "mkdir"] as Action[]) {
    test(`mobile template ${action} closes after committed mutation even when awaited refresh rejects`, async () => {
        const f = setup(action);
        let rejectRefresh: (error: Error) => void;
        let started: () => void;
        const refreshing = new Promise<void>(resolve => { started = resolve; });
        f.setRefresh(() => {
            started();
            return new Promise<void>((_resolve, reject) => { rejectRefresh = reject; });
        });
        const pending = f.submit();
        await refreshing;
        assert.equal(f.context.busy, true);
        assert.equal(f.prompt.locked, true);
        assert.equal(f.prompt.closes, 0);
        assert.equal(await f.submit(), false);
        assert.equal(f.requests.length, 1);
        rejectRefresh(Error("<refresh failed>"));
        assert.equal(await pending, true);
        assert.equal(f.context.busy, false);
        assert.equal(f.prompt.closes, 1);
        assert.deepEqual(f.messages, [["Error: &lt;refresh failed&gt;", 5000, "error"]]);
        assert.equal(await f.submit(), false);
        assert.equal(f.requests.length, 1, "closed dialogs cannot repeat the committed request");
        const expectedPath = {move: "destination/original.md", remove: "", rename: "templates/renamed.md",
            new: "templates/created.md", mkdir: "templates/created"}[action];
        assert.deepEqual(f.refreshes, [[expectedPath, action !== "remove"]]);
        assert.equal(f.requests[0].action, action === "rename" ? "move" : action === "new" ? "write" : action);
        assert.equal(f.requests[0].path, action === "new" || action === "mkdir" ? expectedPath : "templates/original.md");
        if (action === "move" || action === "rename" || action === "remove") {
            assert.equal(f.requests[0].revision, "original-revision");
        }
    });

    for (const outcome of ["false", "reject"] as Outcome[]) {
        test(`mobile template ${action} retains failed ${outcome} mutation for a successful retry`, async () => {
            const f = setup(action);
            f.setOutcome(outcome);
            assert.equal(await f.submit(), false);
            assert.equal(f.prompt.closes, 0);
            assert.equal(f.prompt.locked, false);
            assert.equal(f.context.busy, false);
            assert.equal(f.refreshes.length, 0);
            assert.equal(f.messages.length, outcome === "reject" ? 1 : 0);
            f.setOutcome("success");
            assert.equal(await f.submit(), true);
            assert.equal(f.prompt.closes, 1);
            assert.equal(f.refreshes.length, 1);
            assert.equal(f.requests.length, 2);
            assert.deepEqual(f.requests[0], f.requests[1]);
        });
    }
}

test("mobile template unchanged rename closes without mutation or refresh", async () => {
    const f = setup("rename");
    f.prompt.input.value = "original.md";
    assert.equal(await f.submit(), true);
    assert.equal(f.prompt.closes, 1);
    assert.equal(f.requests.length, 0);
    assert.equal(f.refreshes.length, 0);
    assert.equal(f.messages.length, 0);
});
