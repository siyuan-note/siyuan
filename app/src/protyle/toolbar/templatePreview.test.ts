import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {withFetchTimeout} from "../../util/fetchTimeout";

const loadPreview = () => {
    const requests: Array<{resolve: (response: Response) => void, reject: (error: Error) => void}> = [];
    const messages: string[] = [];
    let destroyed = 0;
    const loadModule = (path: string, dependencies: Record<string, unknown>) => {
        const exports: Record<string, any> = {};
        const source = ts.transpileModule(readFileSync(join(__dirname, path), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText;
        runInNewContext(source, {
            exports,
            require: (name: string) => dependencies[name] || {},
            fetch: () => new Promise<Response>((resolve, reject) => requests.push({resolve, reject})),
            FormData,
            console,
            window: {siyuan: {languages: {tabItem: "Tab", newSubDoc: "New document"}}},
        });
        return exports;
    };
    const messagesModule = loadModule("../../util/processMessage.ts", {
        "../dialog/message": {showMessage: (message: string) => messages.push(message)},
    });
    const fetchModule = loadModule("../../util/fetch.ts", {
        "./processMessage": messagesModule,
        "./fetchTimeout": {withFetchTimeout},
    });
    const previewModule = loadModule("util.ts", {
        "../../util/fetch": fetchModule,
        "../../asset/html": {normalizeHTMLAssetIFrameBlockDOM: (html: string) => html},
        "../render/tabsRender": {tabsRender: () => {}, destroyTabsRender: () => destroyed++},
    });
    const element = {
        innerHTML: "previous template",
        isConnected: true,
        closest: (): Element => null,
        get firstElementChild() {
            return this.innerHTML ? {} : null;
        },
    };
    const respond = async (index: number, code = 0, content = "current template") => {
        requests[index].resolve(new Response(JSON.stringify({
            code, msg: code ? "template parse failed" : "", data: code ? null : {content},
        }), {headers: {"Content-Type": "application/json"}}));
        await new Promise(resolve => setImmediate(resolve));
    };
    return {
        element, requests, messages, respond,
        preview: () => previewModule.previewTemplate("template", element, "parent"),
        clear: () => previewModule.clearTemplatePreview(element),
        destroyed: () => destroyed,
    };
};

it("keeps the preview while loading and clears it when template parsing fails", async () => {
    const fixture = loadPreview();
    fixture.preview();
    assert.equal(fixture.element.innerHTML, "previous template");
    assert.equal(fixture.destroyed(), 0);
    await fixture.respond(0, -1);
    assert.equal(fixture.element.innerHTML, "");
    assert.equal(fixture.destroyed(), 1);
    assert.deepEqual(fixture.messages, ["template parse failed"]);

    fixture.preview();
    await fixture.respond(1);
    assert.match(fixture.element.innerHTML, /current template/);
});

it("clears failed network requests without letting stale responses overwrite a newer preview", async () => {
    const fixture = loadPreview();
    fixture.preview();
    fixture.requests[0].reject(new Error("Failed to fetch"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.element.innerHTML, "");

    fixture.preview();
    fixture.preview();
    fixture.preview();
    fixture.preview();
    await fixture.respond(4);
    const current = fixture.element.innerHTML;
    await fixture.respond(1, -1);
    fixture.requests[2].reject(new Error("Failed to fetch"));
    await fixture.respond(3, 0, "stale template");
    assert.equal(fixture.element.innerHTML, current);
    assert.match(current, /current template/);
});

it("does not restore a preview after it has been closed", async () => {
    const fixture = loadPreview();
    fixture.preview();
    fixture.clear();
    await fixture.respond(0);
    assert.equal(fixture.element.innerHTML, "");
});
