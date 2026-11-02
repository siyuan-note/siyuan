import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const fixture = () => {
    let now = 1000;
    let revoked = 0;
    const timers = new Map<() => void, number>();
    const exports: Record<string, (...args: any[]) => any> = {};
    runInNewContext(transpileModule(readFileSync("src/template/httpConfirmHandoff.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, Date: {now: () => now},
        setTimeout: (callback: () => void, delay: number) => {timers.set(callback, now + delay); return callback;},
        clearTimeout: (callback: () => void) => timers.delete(callback),
    });
    const element = {isConnected: true, closest: (): Element => null};
    return {exports, element, timers, revoked: () => revoked,
        epoch: () => exports.templateHTTPConfirmEpoch(),
        retain: (epoch = exports.templateHTTPConfirmEpoch()) => exports.retainTemplateHTTPConfirmation(element,
            "template", "document", "token", epoch, () => {revoked++;}),
        take: (path = "template", target = "document") => exports.takeTemplateHTTPConfirmation(element, path, target),
        clear: () => exports.clearTemplateHTTPConfirmation(element),
        advance: (elapsed: number) => {now += elapsed;},
    };
};

test("a matching preview transfers its token only once without revoking the insertion handoff", () => {
    const state = fixture();
    state.retain();
    assert.equal(state.take(), "token");
    assert.equal(state.take(), undefined);
    state.clear();
    assert.equal(state.revoked(), 0);
    assert.equal(state.timers.size, 0);
});

test("close, replacement, target changes and detached previews revoke unused tokens", () => {
    for (const action of ["close", "replacement", "path", "target", "detach", "hidden"]) {
        const state = fixture();
        state.retain();
        if (action === "close") state.clear();
        if (action === "replacement") {state.retain(); state.take();}
        if (action === "path") assert.equal(state.take("other"), undefined);
        if (action === "target") assert.equal(state.take("template", "other"), undefined);
        if (action === "detach") {state.element.isConnected = false; assert.equal(state.take(), undefined);}
        if (action === "hidden") {state.element.closest = () => state.element as unknown as Element; assert.equal(state.take(), undefined);}
        assert.equal(state.revoked(), 1);
        assert.equal(state.take(), undefined);
    }
});

test("thirty seconds is a hard local handoff limit even before the expiration timer runs", () => {
    const state = fixture();
    state.retain();
    state.advance(30000);
    assert.equal(state.take(), undefined);
    assert.equal(state.timers.size, 0);
});

test("disconnect or notebook lock clears tokens and rejects late preview responses from the old epoch", () => {
    const state = fixture();
    const epoch = state.epoch();
    state.retain();
    state.exports.clearTemplateHTTPConfirmations();
    assert.equal(state.take(), undefined);
    state.retain(epoch);
    assert.equal(state.take(), undefined);
    assert.equal(state.revoked(), 2);
    assert.equal(state.timers.size, 0);
});

test("a delayed old-epoch preview cannot clear a newer confirmed preview", () => {
    const state = fixture();
    const oldEpoch = state.epoch();
    state.exports.clearTemplateHTTPConfirmations();
    state.retain();
    state.retain(oldEpoch);
    assert.equal(state.revoked(), 1);
    assert.equal(state.take(), "token");
});

test("keyboard and pointer insertion both take the exact preview token before starting rendering", () => {
    const source = readFileSync("src/protyle/toolbar/index.ts", "utf8");
    const start = source.indexOf("public showTpl(");
    const end = source.indexOf("public showWidget(", start);
    const picker = source.slice(start, end);
    assert.equal((picker.match(/takeTemplateHTTPConfirmation\(previewElement, path, protyle.block.parentID\)/g) || []).length, 2);
    assert.match(picker, /subElementCloseCB = \(\) => \{[\s\S]*?clearTemplatePreview\(previewElement\)/);
});

test("shared notebook close events invalidate preview tokens on desktop and mobile", () => {
    for (const cmd of ["closeBox", "removeBox"]) {
        const state = fixture();
        state.retain();
        const exports: Record<string, (...args: any[]) => any> = {};
        runInNewContext(transpileModule(readFileSync("src/util/processMessage.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText, {exports, require: (path: string) =>
            path === "../template/httpConfirmHandoff" ? state.exports : {}});
        exports.processMessage({cmd, code: 0, data: {box: "notebook"}});
        assert.equal(state.take(), undefined);
        assert.equal(state.revoked(), 1);
    }
});
