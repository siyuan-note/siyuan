import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeAttr, escapeHtml} from "../util/escape";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const start = source.indexOf("export const openFlashcardV2Statistics =");
const end = source.indexOf("\n};", start) + 4;
assert.ok(start > 0 && end > start);
const compiled = transpileModule(source.slice(start, end), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const harness = () => {
    const handlers = new Map<string, () => void>();
    const datePickers: unknown[] = [];
    const control = (name: string, value = "") => ({value, disabled: false,
        addEventListener: (event: string, handler: () => void) => handlers.set(`${name}:${event}`, handler)});
    let writes = 0;
    const content = {innerHTML: "", busy: "false", setAttribute(_key: string, value: string) {
        this.busy = value; writes++;
    }, querySelector: () => control("retry")};
    const controls = {statisticsFrom: control("from", "2026-10-01"), statisticsTo: control("to", "2026-10-30"),
        statisticsRange: control("range", "30"), statisticsBucket: control("bucket", "day"),
        statisticsApply: control("apply"), statisticsContent: content};
    const element = {isConnected: true, dataset: {dialogClosing: "false"},
        querySelector: (selector: string) => controls[selector.match(/"([^"]+)"/)[1] as keyof typeof controls]};
    let options: {content: string, destroyCallback: () => void};
    const requests: Array<{data: Record<string, unknown>, success: (response: unknown) => void, resolve: () => void,
        reject: (error: Error) => void}> = [];
    const exports: Record<string, () => void> = {};
    const languages = {flashcardStatisticsRange: 'Range "<&', startDate: 'Start "<&',
        endDate: 'End "<&', group: 'Group "<&', flashcardLoadFailed: "Load failed", retry: "Retry",
        flashcardStatisticsScopeTip: 'History only; current snapshot and 30 days "<&'};
    runInNewContext(compiled, {exports, escapeAttr, escapeHtml, console,
        ensureFlashcardV2: (callback: () => void) => callback(),
        Dialog: class {element = element; constructor(value: typeof options) { options = value; }},
        window: {siyuan: {languages}}, isMobile: () => false,
        bindDatePicker: (input: unknown) => datePickers.push(input),
        flashcardV2StatisticsDate: () => "2026-10-01",
        reportFlashcardV2Field: () => assert.fail("unexpected invalid dates"),
        renderFlashcardV2Statistics: (value: {name: string}) => value.name,
        fetchPost: (_url: string, data: Record<string, unknown>, success: (response: unknown) => void) =>
            new Promise<void>((resolve, reject) => requests.push({data, success, resolve, reject})),
    });
    exports.openFlashcardV2Statistics();
    return {requests, controls, content, element, handlers, languages, datePickers,
        get options() { return options; }, get writes() { return writes; }};
};

test("statistics filters have distinct escaped accessible names without layout changes", () => {
    const h = harness();
    assert.deepEqual(h.datePickers, [h.controls.statisticsFrom, h.controls.statisticsTo]);
    for (const [control, key] of [["statisticsRange", "flashcardStatisticsRange"], ["statisticsFrom", "startDate"],
        ["statisticsTo", "endDate"], ["statisticsBucket", "group"]]) {
        assert.ok(h.options.content.includes(`data-type="${control}" aria-label="${escapeAttr(h.languages[key as keyof typeof h.languages])}"`));
    }
});

test("scope explanation is below controls, translated completely and safely escaped", () => {
    const h = harness();
    assert.ok(h.options.content.includes(`<div class="b3-label__text ft__on-surface">${escapeHtml(h.languages.flashcardStatisticsScopeTip)}</div>`));
    assert.ok(h.options.content.indexOf(escapeHtml(h.languages.flashcardStatisticsScopeTip)) >
        h.options.content.indexOf('data-type="statisticsApply"'));
    const files = readdirSync("appearance/langs").filter(name => name.endsWith(".json"));
    assert.ok(files.includes("en.json"));
    for (const file of files) {
        const language = JSON.parse(readFileSync(`appearance/langs/${file}`, "utf8"));
        assert.ok(language.flashcardStatisticsRange.length > 0);
        assert.ok(language.flashcardStatisticsScopeTip.includes("30"));
    }
});

test("custom past dates only change history bounds, not current time or the future horizon", () => {
    const before = Date.now();
    const h = harness();
    h.controls.statisticsRange.value = "custom";
    h.controls.statisticsFrom.value = "2020-01-01";
    h.controls.statisticsTo.value = "2020-01-07";
    h.handlers.get("apply:click")();
    const request = h.requests.at(-1).data;
    assert.equal(request.from, new Date("2020-01-01T00:00:00").getTime());
    assert.equal(request.to, new Date("2020-01-08T00:00:00").getTime());
    assert.ok(Number(request.now) >= before && Number(request.now) <= Date.now());
    assert.equal(request.futureDays, 30);
    assert.equal(request.bucket, "day");
});

for (const state of ["closing", "detached", "destroyed"]) {
    for (const outcome of ["success", "failure"]) {
        test(`statistics ${outcome} after ${state} does not update the old dialog or start retry`, async () => {
            const h = harness();
            if (state === "closing") { h.element.dataset.dialogClosing = "true"; }
            if (state === "detached") { h.element.isConnected = false; }
            if (state === "destroyed") { h.element.isConnected = false; h.options.destroyCallback(); }
            const before = h.writes;
            if (outcome === "success") { h.requests[0].success({data: {name: "late"}}); }
            h.requests[0].resolve(); await flush();
            h.handlers.get("apply:click")();
            assert.equal(h.requests.length, 1);
            assert.equal(h.writes, before);
            assert.equal(h.content.innerHTML, "");
            assert.equal(h.controls.statisticsApply.disabled, true);
        });
    }
}

test("newest statistics request wins and older completion does not unlock it", async () => {
    const h = harness();
    h.handlers.get("range:change")();
    h.requests[0].success({data: {name: "old"}}); h.requests[0].resolve(); await flush();
    assert.equal(h.content.innerHTML, "");
    assert.equal(h.controls.statisticsApply.disabled, true);
    h.requests[1].success({data: {name: "new"}}); h.requests[1].resolve(); await flush();
    assert.equal(h.content.innerHTML, "new");
    assert.equal(h.controls.statisticsApply.disabled, false);
    assert.equal(h.content.busy, "false");
});

test("statistics transport failure offers retry and retry can succeed", async () => {
    const h = harness();
    h.requests[0].reject(new Error("network")); await flush();
    assert.match(h.content.innerHTML, /Load failed/);
    assert.equal(h.controls.statisticsApply.disabled, false);
    assert.equal(h.content.busy, "false");
    h.handlers.get("retry:click")();
    assert.equal(h.requests.length, 2);
    h.requests[1].success({data: {name: "recovered"}}); h.requests[1].resolve(); await flush();
    assert.equal(h.content.innerHTML, "recovered");
});
