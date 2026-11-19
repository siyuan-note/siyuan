import {parseFragment, type DefaultTreeAdapterMap} from "parse5";

type Child = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
type Renderer = {
    Lute: {New(): {SetSanitize(value: boolean): void; Md2HTML(markdown: string): string}};
    katex: {renderToString(expression: string, options: Record<string, unknown>): string};
    hljs: {getLanguage(language: string): unknown; highlight(code: string, options: {language: string}): {value: string}};
};
const host = globalThis as unknown as Renderer;

const allowed = new Set("a abbr b blockquote br caption code dd del div dl dt em h1 h2 h3 h4 h5 h6 hr i kbd li mark ol p pre s samp small span strong sub sup table tbody td th thead tfoot tr u ul var".split(" "));
const discarded = new Set("audio base button embed form iframe link meta noscript object script select source style template textarea track video".split(" "));
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const isElement = (node: Child): node is Element => "tagName" in node;
const attr = (node: Element, name: string) => node.attrs.find(item => item.name === name && !item.namespace)?.value || "";
const children = (node: Element) => node.childNodes;
const textContent = (node: Element): string => children(node).map(child =>
    "value" in child ? child.value : isElement(child) ? textContent(child) : "").join("");

const renderPreview = (markdown: string, messages: {resource: string; limit: string},
                       image: (reference: string) => string | null, active: () => boolean) => {
    const lute = host.Lute.New();
    lute.SetSanitize(true);
    const root = parseFragment(lute.Md2HTML(markdown));
    let nodes = 0;
    let images = 0;
    let codes = 0;
    let maths = 0;
    let length = 0;
    let limit = false;
    let unavailable = false;
    const output: string[] = [];
    const append = (value: string) => {
        length += value.length;
        if (length > 8 * 1024 * 1024) throw new RangeError("preview limit");
        output.push(value);
    };
    const render = (node: Child, depth: number) => {
        if ("value" in node) { append(escape(node.value)); return; }
        if (!isElement(node)) return;
        if (++nodes > 20000 || depth > 128) throw new RangeError("preview limit");
        if (nodes % 64 === 0 && !active()) throw new Error("preview cancelled");
        const tag = node.tagName;
        if (node.namespaceURI !== htmlNamespace || discarded.has(tag)) return;
        const classes = attr(node, "class").split(/\s+/);
        if ((tag === "code" || tag === "div" || tag === "span") && classes.includes("language-math")) {
            if (++maths > 256) throw new RangeError("preview limit");
            const expression = textContent(node);
            const display = tag === "div" || node.parentNode?.nodeName === "pre";
            if (expression.length > 8192) {
                limit = true;
                append(`<${tag}>${escape(expression)}</${tag}>`);
            } else {
                append(host.katex.renderToString(expression, {displayMode: display, throwOnError: false,
                    trust: false, strict: "error", maxExpand: 1000, maxSize: 20}));
            }
            return;
        }
        if (tag === "img") {
            const source = attr(node, "src");
            const alt = escape(attr(node, "alt"));
            const id = ++images <= 256 && source && source.length <= 2048 && !/^[\\/#]|^[a-z][a-z\d+.-]*:/i.test(source) ?
                image(source) : "";
            if (id && /^image-\d+$/.test(id)) append(`<img src="cid:${id}" alt="${alt}">`);
            else {
                append(`<span>${alt ? `[${alt}]` : escape(messages.resource)}</span>`);
                unavailable = true;
            }
            return;
        }
        if (tag === "input" && attr(node, "type") === "checkbox") {
            append(node.attrs.some(item => item.name === "checked") ?
                '<input type="checkbox" disabled checked>' : '<input type="checkbox" disabled>');
            return;
        }
        if (tag === "br" || tag === "hr") { append(`<${tag}>`); return; }
        if (tag === "code" && node.parentNode?.nodeName === "pre") {
            if (++codes > 512) throw new RangeError("preview limit");
            const code = textContent(node);
            const language = classes.find(name => /^language-[\w+-]+$/.test(name))?.slice(9);
            if (code.length <= 32768 && language && host.hljs.getLanguage(language)) {
                append(`<code class="hljs">${host.hljs.highlight(code, {language}).value}</code>`);
            } else append(`<code>${escape(code)}</code>`);
            return;
        }
        let attributes = "";
        if (tag === "li" && classes.includes("vditor-task")) attributes = ' class="vditor-task"';
        if (tag === "td" || tag === "th") {
            const align = attr(node, "align") || /^text-align:\s*(left|center|right);?$/i.exec(attr(node, "style"))?.[1];
            if (align && /^(left|center|right)$/.test(align)) attributes += ` align="${align}"`;
            for (const name of ["rowspan", "colspan"]) {
                const count = attr(node, name);
                if (/^[1-9]\d{0,2}$/.test(count)) attributes += ` ${name}="${count}"`;
            }
        }
        if (tag === "ol" && /^-?\d{1,9}$/.test(attr(node, "start"))) attributes = ` start="${attr(node, "start")}"`;
        const safe = allowed.has(tag);
        if (safe) append(`<${tag}${attributes}>`);
        for (const child of children(node)) render(child, depth + 1);
        if (safe) append(`</${tag}>`);
    };
    try {
        for (const node of root.childNodes) render(node, 0);
    } catch (error) {
        if (error instanceof RangeError) return {error: "limit"};
        throw error;
    }
    const warnings = [limit ? messages.limit : "", unavailable ? messages.resource : ""].filter(Boolean);
    return {html: output.join(""), warning: warnings.map(escape).join(" ")};
};

Object.assign(globalThis, {quickLookRender: renderPreview});
