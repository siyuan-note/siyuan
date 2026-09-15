import {describe, it} from "node:test";
import * as assert from "node:assert/strict";

(globalThis as any).SIYUAN_VERSION = "test";
(globalThis as any).NODE_ENV = "test";

// 记录 createTopLevelItem 写入模板的 HTML，用于断言最终进入 innerHTML 的内容
let capturedHTML = "";

const fakeElement = () => ({
    innerHTML: "",
    querySelector: (): null => null,
    querySelectorAll: (): unknown[] => [],
    getAttribute: (): null => null,
    setAttribute: (): void => undefined,
    addEventListener: (): void => undefined,
});

(globalThis as any).document = {
    getElementById: (): null => null,
    querySelectorAll: (): unknown[] => [],
    // 真实浏览器的 HTMLTemplateElement.innerHTML 会转发到 content，这里按同样语义模拟
    createElement: () => {
        const content = {
            get innerHTML(): string {
                return capturedHTML;
            },
            set innerHTML(value: string) {
                capturedHTML = value;
            },
            // createTopLevelItem 会取回列表项节点交给 mathRender，这里返回一个可用的替身
            querySelector: () => fakeElement(),
        };
        return {
            content,
            get innerHTML(): string {
                return capturedHTML;
            },
            set innerHTML(value: string) {
                capturedHTML = value;
            },
        };
    },
};

// 空数据构造时会读取 window.siyuan.languages，这里仅提供必需的取词
(globalThis as any).window = {
    siyuan: {languages: {emptyContent: "empty"}},
};

// 大纲条目会调用全局 Lute 生成 aria-label，这里提供最小替身
(globalThis as any).Lute = {
    BlockDOM2Content: (value: string) => value,
    EscapeHTMLStr: (value: string) => value,
};

type TreeInstance = { createTopLevelItem: (item: IBlockTree) => unknown };

const renderItem = async (item: IBlockTree) => {
    capturedHTML = "";
    const {Tree} = await import("./Tree");
    const tree = new Tree({element: fakeElement() as unknown as HTMLElement, data: []}) as unknown as TreeInstance;
    tree.createTopLevelItem(item);
    return capturedHTML;
};

describe("tree item name escaping", () => {
    it("escapes backlink document titles so they cannot inject markup", async () => {
        const html = await renderItem({
            id: "20260101120000-abcdefg",
            name: "<img src=x onerror=alert(document.domain)>",
            type: "backlink",
            depth: 0,
            count: 0,
        });
        assert.ok(!html.includes("<img"), `raw img tag reached innerHTML: ${html}`);
        // escapeHtml 只处理 & 和 <，转义 < 已足以让标签无法成立
        assert.ok(html.includes("&lt;img src=x onerror=alert(document.domain)>"), `actual: ${JSON.stringify(html)}`);
    });

    it("escapes ampersands and angle brackets in plain names", async () => {
        const html = await renderItem({
            name: "a&b<c",
            type: "backlink",
            depth: 0,
            count: 0,
        });
        assert.ok(html.includes("a&amp;b&lt;c"), html);
    });

    it("preserves intentional HTML when the producer marks the name as HTML", async () => {
        const html = await renderItem({
            id: "20260101120000-abcdefg",
            name: "<span style=\"color: red;\">标题</span>",
            nameIsHTML: true,
            type: "outline",
            depth: 0,
            count: 0,
        });
        assert.ok(html.includes("<span style=\"color: red;\">标题</span>"), html);
        assert.ok(!html.includes("&lt;span"), html);
    });

    it("escapes quotes in the data-label attribute so tag names cannot break out", async () => {
        const html = await renderItem({
            id: "20260101120000-abcdefg",
            label: "x' onmouseenter='alert(1)",
            name: "tag",
            type: "tag",
            depth: 0,
            count: 0,
        });
        assert.ok(!html.includes("onmouseenter='alert(1)'"), `attribute broke out: ${html}`);
        assert.ok(html.includes("data-label='x&apos; onmouseenter=&apos;alert(1)'"), `actual: ${JSON.stringify(html)}`);
    });
});
