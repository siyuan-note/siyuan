import * as assert from "node:assert/strict";
import {test} from "node:test";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";

for (const [initialLayout, resolvedLayout] of [["gallery", "gallery"], ["kanban", "kanban"],
    ["gallery", "kanban"], ["kanban", "gallery"]] as const) {
    test(`${initialLayout} HTTP preview resolves to ${resolvedLayout} without restarting its render owner`, async () => {
        let token: symbol;
        let starts = 0;
        let header = false;
        let finished = 0;
        const attributes = new Map<string, string>([["data-av-type", initialLayout]]);
        const block = {isConnected: true, firstElementChild: {innerHTML: "loading"}, style: {},
            getAttribute: (key: string) => attributes.get(key) || "",
            querySelector: (query: string) => query === ".av__header" ? header : {after() {}},
            querySelectorAll: (): [] => [],
            setAttribute: (key: string, value: string) => attributes.set(key, value),
            removeAttribute: (key: string) => attributes.delete(key),
        } as unknown as HTMLElement;
        const rendered: IAV[] = [];
        const requests: Array<{automaticRefresh?: boolean; deferHTTPTemplates?: boolean}> = [];
        const data = {id: "database", viewID: "view", viewType: resolvedLayout,
            view: {cards: [], fields: [], groups: [], sorts: [], pageSize: 50}, views: []} as unknown as IAV;
        let complete: (value: unknown) => void;
        const final = new Promise(resolve => { complete = resolve; });
        const methods: Record<string, typeof import("./gallery/render").renderGallery> = {};
        const imports = {
            beginAVRender: () => { starts++; token = Symbol(); return token; },
            isCurrentAVRender: (_element: unknown, current: symbol) => token === current,
            guardTemplateHTTPRequest: () => ({signal: new AbortController().signal, dispose() {}}),
            captureAVCardRenderState: () => ({query: "", virtualData: {}}),
            getPageSize: () => ({}), Constants: {},
            isAVRenderData: (value: {view?: unknown}) => !!value?.view,
            genTabHeaderHTML: () => "<div></div>",
            getAVCardHTML: () => "", getCardStyle: () => "", escapeAttr: (value: string) => value,
            replaceAVContainer: () => { header = true; },
            applyAVRenderContext: (_element: unknown, next: IAV) => attributes.set("data-av-type", next.viewType),
            afterRenderCards: (options: {data: IAV; cb?: (data: IAV) => void}) => {
                rendered.push(options.data); options.cb?.(options.data);
            },
            avRender: (element: HTMLElement, protyle: IProtyle, cb: (data: IAV) => void, renderAll: boolean,
                       preview: IAV, automaticRefresh: boolean, renderToken: symbol) =>
                methods[attributes.get("data-av-type")]({blockElement: element, protyle, cb, renderAll,
                    data: preview, automaticRefresh, renderToken}),
            fetchSyncPost: async (_url: string, request: typeof requests[number]) => {
                requests.push(request);
                return request.deferHTTPTemplates ? {code: 0, data: {...data, pendingHTTPTemplates: ["template"]}} : final;
            },
        } as Record<string, unknown>;
        const environment = {CSS: {escape: (id: string) => id},
            window: {siyuan: {languages: {}, config: {}}},
            document: {activeElement: null as Element | null, createElement: () => ({setAttribute() {}, remove() {}})},
            require: () => new Proxy(imports, {get: (target, key: string) => target[key] || ((): undefined => undefined)}),
        };
        const http = evaluateModule<typeof import("./httpRender")>(compileModule("src/protyle/render/av/httpRender.ts"), environment);
        imports.fetchAVRender = http.fetchAVRender;
        for (const layout of ["gallery", "kanban"] as const) {
            const api = evaluateModule<Record<string, typeof methods[string]>>(
                compileModule(`src/protyle/render/av/${layout}/render.ts`), environment);
            methods[layout] = api[layout === "gallery" ? "renderGallery" : "renderKanban"];
        }
        imports.renderGallery = methods.gallery;
        imports.renderKanban = methods.kanban;
        const rendering = methods[initialLayout]({blockElement: block,
            protyle: {options: {}, block: {}} as IProtyle, renderAll: true, cb: () => { finished++; }});
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(rendered.length, 1);
        assert.equal(rendered[0].pendingHTTPTemplates.length, 1);
        assert.equal(starts, 1);
        assert.equal(requests.length, 2);
        assert.equal(requests[1].automaticRefresh, false);
        complete({code: 0, data});
        await rendering;
        assert.equal(rendered.length, 2);
        assert.equal(rendered[1], data);
        assert.equal(finished, 1);
        assert.equal(starts, 1);
    });
}
