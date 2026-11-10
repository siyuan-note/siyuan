import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/breadcrumb/appearance.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = () => {
    const frames: Array<() => void> = [];
    const api = {} as typeof import("./appearance");
    let layoutDirty = false;
    let layouts = 0;
    let reads = 0;
    const classes = (initial: string[] = []) => {
        const values = new Set(initial);
        return {
            contains: (value: string) => values.has(value),
            add: (value: string) => { values.add(value); layoutDirty = true; },
            remove: (value: string) => { values.delete(value); layoutDirty = true; },
        };
    };
    const measure = () => {
        reads++;
        if (layoutDirty) layouts++;
        layoutDirty = false;
    };
    runInNewContext(compiled, {
        exports: api,
        require: () => ({hasClosestByAttribute: (bar: {embed: boolean}) => bar.embed}),
        requestAnimationFrame: (callback: () => void) => frames.push(callback),
    });
    const bar = (count = 4, embed = false, fits = false) => {
        const texts = Array.from({length: count}, () => ({classList: classes()}));
        return {
            embed, texts, isConnected: true, scrollLeft: 0,
            classList: classes(["protyle-breadcrumb__bar", "protyle-breadcrumb__bar--nowrap"]),
            querySelectorAll: (selector: string) => selector === ".protyle-breadcrumb__text" ? texts : [],
            get scrollHeight() {
                measure();
                return fits || texts.filter(text => !text.classList.contains("protyle-breadcrumb__text--ellipsis")).length <= 2 ? 20 : 60;
            },
            get lastElementChild() { return {get offsetLeft() { measure(); return 160; }}; },
            get clientWidth() { measure(); return 100; },
        };
    };
    return {
        bar, frames, reads: () => reads, layouts: () => layouts,
        improve: (element: ReturnType<typeof bar>) => api.improveBreadcrumbAppearance(element as unknown as HTMLElement),
        flush: () => { frames.splice(0).forEach(callback => callback()); },
    };
};

test("expanded contexts share layout rounds and deduplicate queued breadcrumbs", () => {
    const f = fixture();
    const bars = Array.from({length: 32}, () => f.bar());
    bars.forEach(bar => { f.improve(bar); f.improve(bar); });
    assert.equal(f.reads(), 0);
    assert.equal(f.frames.length, 1);
    f.flush();
    assert.ok(f.layouts() <= 4, `breadcrumb layout rounds stay bounded: ${f.layouts()}`);
    bars.forEach(bar => {
        assert.deepEqual(bar.texts.map(text => text.classList.contains("protyle-breadcrumb__text--ellipsis")),
            [true, true, false, false]);
        assert.equal(bar.classList.contains("protyle-breadcrumb__bar--nowrap"), true);
        assert.equal(bar.scrollLeft, 74);
    });
});

test("embed breadcrumbs retain the document label and detached contexts are discarded", () => {
    const f = fixture();
    const embed = f.bar(4, true);
    const detached = f.bar();
    f.improve(embed);
    f.improve(detached);
    detached.isConnected = false;
    f.flush();
    assert.deepEqual(embed.texts.map(text => text.classList.contains("protyle-breadcrumb__text--ellipsis")),
        [false, true, true, false]);
    assert.equal(detached.scrollLeft, 0);
    assert.equal(detached.classList.contains("protyle-breadcrumb__bar--nowrap"), true);
});

test("short and fitting paths retain their labels across repeated updates", () => {
    const f = fixture();
    for (const bar of [f.bar(1), f.bar(4, false, true)]) {
        f.improve(bar);
        f.flush();
        f.improve(bar);
        f.flush();
        assert.ok(bar.texts.every(text => !text.classList.contains("protyle-breadcrumb__text--ellipsis")));
        assert.equal(bar.classList.contains("protyle-breadcrumb__bar--nowrap"), true);
    }
});
