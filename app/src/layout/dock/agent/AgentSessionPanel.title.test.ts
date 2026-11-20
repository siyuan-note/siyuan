import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {parseFragment, type DefaultTreeAdapterMap} from "parse5";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeHtml, escapeHtmlTextAndAttr} from "../../../util/escape";
import type {SessionIndexItem} from "./SessionStore";

const compiled = transpileModule(readFileSync("src/layout/dock/agent/AgentSessionPanel.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

type Child = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
type Parent = DefaultTreeAdapterMap["parentNode"];

const isElement = (node: Child): node is Element => "tagName" in node;

const findElement = (parent: Parent, predicate: (element: Element) => boolean): Element | undefined => {
    for (const node of parent.childNodes) {
        if (isElement(node)) {
            if (predicate(node)) {
                return node;
            }
            const found = findElement(node, predicate);
            if (found) {
                return found;
            }
        }
    }
    return undefined;
};

const attribute = (element: Element, name: string) => element.attrs.find(attr => attr.name === name)?.value;

const textContent = (element: Element) =>
    element.childNodes.map(node => "value" in node ? node.value : "").join("");

type Panel = {
    renderItems: (container: unknown, items: SessionIndexItem[], append: boolean) => void;
};

// 与浏览器一致的片段解析：属性名和实体解码后再断言；标题未转义时，注入的属性会出现在真实的属性节点上。
const renderTitles = (titles: string[]) => {
    const exports = {} as {AgentSessionPanel: new (...args: unknown[]) => Panel};
    const container = {
        dataset: {} as Record<string, string>,
        html: "",
        set innerHTML(html: string) {
            this.html = html;
        },
        get innerHTML() {
            return this.html;
        },
        addEventListener() {},
        querySelector: () => ({classList: {add() {}}}),
    };
    runInNewContext(compiled, {
        exports,
        require: (id: string) => {
            if (id === "../../../util/escape") {
                return {escapeHtml, escapeHtmlTextAndAttr};
            }
            if (id === "../../../util/hostCapabilities") {
                return {getHostCapabilities: () => ({localFileSystem: false})};
            }
            return {};
        },
        window: {siyuan: {languages: {
            pinDoc: "Pin", unpinDoc: "Unpin", rename: "Rename", more: "More", delete: "Delete", emptyContent: "Empty",
        }, zIndex: 10}},
    });
    const panel = new exports.AgentSessionPanel({}, {}, () => "", () => "Untitled", {}, false);
    panel.renderItems(container, titles.map((title, index) => ({
        id: "2026010100000" + index + "-abcdefg", title, createdAt: index, updatedAt: index,
    })), false);
    return container.html;
};

const textSpan = (html: string) => {
    const span = findElement(parseFragment(html), node =>
        (attribute(node, "class") || "").split(" ").includes("b3-list-item__text"));
    assert.ok(span, "the session row renders its title span");
    return span;
};

test("a generated session title cannot inject attributes into the session row", () => {
    const title = 'Session " onmouseover="alert(1)';
    const html = renderTitles([title]);
    const span = textSpan(html);
    assert.deepEqual(span.attrs.map(attr => attr.name).sort(), ["aria-label", "class", "data-position"]);
    assert.equal(attribute(span, "aria-label"), title);
    assert.equal(textContent(span), title);
    assert.ok(html.includes('aria-label="Session &quot; onmouseover=&quot;alert(1)"'));
});

test("session titles keep their literal text instead of rendering markup", () => {
    const title = 'A & B <img src=x onerror="alert(1)"> "quoted"';
    const html = renderTitles([title]);
    const span = textSpan(html);
    assert.deepEqual(span.attrs.map(attr => attr.name).sort(), ["aria-label", "class", "data-position"]);
    assert.equal(attribute(span, "aria-label"), title);
    assert.equal(textContent(span), title);
    assert.equal(html.includes("<img"), false);
});
