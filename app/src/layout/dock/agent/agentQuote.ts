import type {AIReference} from "../../../types/api";
import {Constants} from "../../../constants";
import {decodeBase64, encodeBase64} from "../../../protyle/util/clipboardData";

export type AgentQuoteSource =
    | {kind: "selection"; id: string; endID: string; start: number; end: number; startCell?: number; endCell?: number}
    | {kind: "user" | "assistant"; id: string; sessionID: string; whole: boolean};

export type AgentQuote = {source: AgentQuoteSource; text: string; markdown?: string};
export const AGENT_QUOTE_SELECTOR = '[data-type~="text"][custom-agent-quote]';

export const createAgentQuote = ({source, text, markdown}: AgentQuote) => {
    const mark = document.createElement("span");
    mark.setAttribute("data-type", "text");
    // Markdown 符号和 HTML 属性需要经过块 DOM 的解析与重建。
    mark.setAttribute("custom-agent-quote", JSON.stringify({...source, markdownBase64: markdown ? encodeBase64(markdown) : undefined}));
    mark.contentEditable = "false";
    mark.title = text;
    mark.textContent = text;
    return mark.outerHTML + Constants.ZWSP;
};

export const readAgentQuote = (element: Element): AgentQuote | undefined => {
    try {
        const data = JSON.parse(element.getAttribute("custom-agent-quote") || "null");
        const validID = (id: unknown) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,72}$/.test(id);
        if (!data || !validID(data.id) || !element.textContent) {
            return;
        }
        const {markdownBase64, ...source} = data;
        const offset = (n: number) => Number.isSafeInteger(n) && n >= 0;
        if (source.kind === "selection" && validID(source.endID) && offset(source.start) && offset(source.end) &&
            (source.startCell === undefined || offset(source.startCell)) && (source.endCell === undefined || offset(source.endCell)) ||
            (source.kind === "user" || source.kind === "assistant") && validID(source.sessionID) &&
            typeof source.whole === "boolean") {
            const quote: AgentQuote = {source, text: element.textContent};
            if (typeof markdownBase64 === "string" && /^[a-zA-Z0-9+/]+={0,2}$/.test(markdownBase64) && markdownBase64.length % 4 === 0) {
                quote.markdown = decodeBase64(markdownBase64);
            }
            return quote;
        }
    } catch {
        // 外部粘贴或旧客户端留下的无效标记按普通文字处理。
    }
};

export const quotePreview = (text: string, references: AIReference[] = []) => {
    const messages = new Map(references.filter(ref => ref.messageID).map(ref => [ref.id, ref.title]));
    return messages.size ? text.replace(/⟦([\w-]+)⟧/g, (token, id) =>
        messages.has(id) ? "“" + messages.get(id) + "”" : token) : text;
};

export const projectAgentQuotes = (root: HTMLElement, references: AIReference[]) => {
    root.querySelectorAll(AGENT_QUOTE_SELECTOR).forEach(element => {
        const quote = readAgentQuote(element);
        if (!quote) {
            element.replaceWith(document.createTextNode(element.textContent));
            return;
        }
        const source = quote.source;
        let text = "“" + (quote.markdown || quote.text) + "”";
        if (source.kind === "selection") {
            references.push({id: source.id, title: JSON.stringify({
                startOffset: source.start, endBlockID: source.endID, endOffset: source.end,
                startCell: source.startCell, endCell: source.endCell, excerpt: Array.from(quote.text).slice(0, 80).join(""),
            })});
        } else if (source.whole) {
            const id = source.id + "-" + references.length;
            references.push({id, messageID: source.id, title: quote.text});
            text = "⟦" + id + "⟧";
        }
        element.replaceWith(document.createTextNode(text));
    });
};
