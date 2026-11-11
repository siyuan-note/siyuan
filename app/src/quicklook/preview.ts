import {createMarkdownResourcePolicy, isRelativeMarkdownResource} from "../markdown/resourcePolicy";
import {MARKDOWN_RENDER_BYTES, markdownByteLength} from "../markdown/limits";
import {createQuickLookFonts} from "./fonts";

interface IPreviewMessages {
    limit: string;
    resource: string;
}
interface IPreviewDependencies {
    html(markdown: string): Promise<string>;
    math(expression: string, display: boolean): string;
    highlight(code: string, language: string): string | undefined;
    images(id: string, references: string[]): Promise<Array<string | null>>;
}

export const createReadOnlyMarkdownPreview = (content: HTMLElement, warning: HTMLElement,
                                              dependencies: IPreviewDependencies) => {
    const doc = content.ownerDocument;
    let generation = 0;
    let policy: ReturnType<typeof createMarkdownResourcePolicy>;
    const fonts = createQuickLookFonts(doc.body);
    const cancel = () => { generation++; policy?.destroy(); fonts.clear(); content.replaceChildren(); warning.textContent = ""; };
    const block = (event: Event) => {
        if ((event.target as Element)?.closest("a, input, button, form")) { event.preventDefault(); }
    };
    content.addEventListener("click", block, true);
    content.addEventListener("submit", block, true);
    return {
        cancel,
        async render(id: string, markdown: string, messages: IPreviewMessages, appearance?: unknown): Promise<boolean> {
            cancel();
            const ticket = generation;
            if (markdownByteLength(markdown) > MARKDOWN_RENDER_BYTES) { throw new Error(messages.limit); }
            const fontsReady = fonts.apply(id, appearance);
            policy = createMarkdownResourcePolicy(doc);
            const currentPolicy = policy;
            const html = await dependencies.html(markdown);
            if (ticket !== generation) { return false; }
            const template = doc.createElement("template");
            template.innerHTML = currentPolicy.sanitize(html);
            if (template.content.querySelectorAll("*").length > 20000) { throw new Error(messages.limit); }
            template.content.querySelectorAll<HTMLInputElement>("input, button, select, textarea").forEach(input => {input.disabled = true;});
            template.content.querySelectorAll("[contenteditable], [autofocus], [tabindex]").forEach(element => {
                element.removeAttribute("contenteditable"); element.removeAttribute("autofocus"); element.removeAttribute("tabindex");
            });
            template.content.querySelectorAll("a").forEach(link => {
                link.removeAttribute("href"); link.removeAttribute("target"); link.removeAttribute("download");
            });
            content.replaceChildren(template.content);
            const codes = Array.from(content.querySelectorAll<HTMLElement>("pre > code"));
            const maths = Array.from(content.querySelectorAll<HTMLElement>(".language-math"));
            if (codes.length > 512 || maths.length > 256) { throw new Error(messages.limit); }
            for (const element of codes) {
                if (element.classList.contains("language-math") || element.textContent.length > 32768) { continue; }
                const language = element.className.match(/(?:^|\s)language-([\w+-]+)/)?.[1];
                const highlighted = language && dependencies.highlight(element.textContent, language);
                if (highlighted) { element.innerHTML = highlighted; element.classList.add("hljs"); }
            }
            for (const element of maths) {
                const expression = element.textContent;
                if (expression.length > 8192) { warning.textContent = messages.limit; continue; }
                const replacement = doc.createElement(element.parentElement?.tagName === "PRE" ? "div" : "span");
                replacement.innerHTML = dependencies.math(expression, replacement.tagName === "DIV");
                (replacement.tagName === "DIV" ? element.parentElement : element).replaceWith(replacement);
            }
            const images = Array.from(content.querySelectorAll<HTMLImageElement>("img"));
            const references = images.slice(0, 256).map(image => currentPolicy.originalAttribute(image, "src"));
            const relative = references.map(reference => isRelativeMarkdownResource(reference || "") ? reference : "");
            const urls = await dependencies.images(id, relative);
            if (ticket !== generation) { return false; }
            images.forEach((image, index) => {
                const url = urls[index];
                if (url && new RegExp(`^siyuan-preview://image/${id}/[a-f0-9-]+$`).test(url)) {
                    image.src = url;
                    image.addEventListener("error", () => { if (ticket === generation) warning.textContent = messages.resource; }, {once: true});
                } else {
                    const placeholder = doc.createElement("span");
                    placeholder.textContent = image.alt ? `[${image.alt}]` : messages.resource;
                    image.replaceWith(placeholder);
                    warning.textContent = messages.resource;
                }
            });
            await fontsReady;
            if (ticket !== generation) { return false; }
            await doc.fonts.ready;
            await Promise.all(Array.from(content.querySelectorAll<HTMLImageElement>("img")).map(image =>
                image.decode().catch(() => { if (ticket === generation) warning.textContent = messages.resource; })));
            return ticket === generation;
        },
        destroy() { cancel(); content.removeEventListener("click", block, true); content.removeEventListener("submit", block, true); },
    };
};
