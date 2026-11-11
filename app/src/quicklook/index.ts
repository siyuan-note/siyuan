import {createReadOnlyMarkdownPreview} from "./preview";

interface IQuickLookWindow {
    webkit: {messageHandlers: {preview: {postMessage(value: unknown): void}}};
    Vditor: {md2html(markdown: string, options: Record<string, unknown>): Promise<string>};
    katex: {renderToString(expression: string, options: Record<string, unknown>): string};
    hljs: {getLanguage(language: string): unknown; highlight(code: string, options: {language: string}): {value: string}};
    preview: {render(id: string, markdown: string, messages: {limit: string; resource: string}, appearance?: unknown): Promise<void>;
        images(id: string, urls: Array<string | null>): void; cancel(): void};
}
const host = window as unknown as IQuickLookWindow;
const send = (value: unknown) => host.webkit.messageHandlers.preview.postMessage(value);
let images: {id: string; resolve(value: Array<string | null>): void};
const view = createReadOnlyMarkdownPreview(document.getElementById("content"), document.getElementById("warning"), {
    html: markdown => host.Vditor.md2html(markdown, {cdn: "siyuan-preview://bundle/vditor", markdown: {sanitize: true}}),
    math: (expression, displayMode) => host.katex.renderToString(expression, {displayMode, throwOnError: false,
        trust: false, strict: "error", maxExpand: 1000, maxSize: 20}),
    highlight: (code, language) => host.hljs.getLanguage(language) ? host.hljs.highlight(code, {language}).value : undefined,
    images: (id, references) => new Promise(resolve => {
        images?.resolve([]); images = {id, resolve}; send({type: "images", id, references});
    }),
});
host.preview = {
    async render(id, markdown, messages, appearance) {
        try { if (await view.render(id, markdown, messages, appearance)) { send({type: "rendered", id}); } }
        catch { send({type: "failed", id}); }
    },
    images(id, urls) { if (images?.id === id) {images.resolve(urls); images = undefined;} },
    cancel() {view.cancel(); images?.resolve([]); images = undefined;},
};
window.addEventListener("pagehide", () => {host.preview.cancel(); view.destroy();}, {once: true});
send({type: "ready"});
