import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getTabsTitleMarkdown, renderTabsTitleMarkdown} from "./tabsTitle";

test("serializes the existing tab title as Markdown", () => {
    assert.equal(getTabsTitleMarkdown({
        BlockDOM2Md: () => "",
        BlockDOM2StdMd: html => html === '<span data-type="strong">foo</span>' ? "**foo**\n" : "",
        InlineMd2BlockDOM: () => "",
        Md2BlockDOM: () => "",
    }, {
        innerHTML: '<span data-type="strong">foo</span>',
        querySelector: (): Element | null => null,
    } as unknown as HTMLElement), "**foo**");
});

test("serializes combined font styles as reversible Kramdown", () => {
    const markdown = '<span data-type="strong text">foo</span>{: style="color: red;"}';
    assert.equal(getTabsTitleMarkdown({
        BlockDOM2Md: html => html.includes('data-type="strong text"') ? markdown + "\n" : "",
        BlockDOM2StdMd: () => {
            throw new Error("unexpected standard Markdown serializer");
        },
        InlineMd2BlockDOM: () => "",
        Md2BlockDOM: () => "",
    }, {
        innerHTML: '<span data-type="strong text" style="color: red;">foo</span>',
        querySelector: (selector: string): Element | null =>
            selector === "span[style]" ? {} as Element : null,
    } as unknown as HTMLElement), markdown);
});

test("parses regular inline Markdown without block interpretation", () => {
    let inline = "";
    const html = renderTabsTitleMarkdown({
        BlockDOM2Md: () => "",
        BlockDOM2StdMd: () => "",
        InlineMd2BlockDOM: markdown => {
            inline = markdown;
            return '<div data-type="NodeParagraph"><div contenteditable="true"><span data-type="strong">foo</span></div></div>';
        },
        Md2BlockDOM: () => {
            throw new Error("unexpected block parser");
        },
    }, "**foo**", {
        content: {querySelector: () => ({innerHTML: '<span data-type="strong">foo</span>'})},
    } as unknown as HTMLTemplateElement);
    assert.equal(inline, "**foo**");
    assert.equal(html, '<span data-type="strong">foo</span>');
});

test("restores serialized combined font styles with the block Markdown parser", () => {
    const markdown = '<span data-type="strong text">foo</span>{: style="color: red;"}';
    let block = "";
    const html = renderTabsTitleMarkdown({
        BlockDOM2Md: () => "",
        BlockDOM2StdMd: () => "",
        InlineMd2BlockDOM: () => {
            throw new Error("unexpected inline parser");
        },
        Md2BlockDOM: value => {
            block = value;
            return '<div data-type="NodeParagraph"><div contenteditable="true"><span data-type="strong text" style="color: red;">foo</span></div></div>';
        },
    }, markdown, {
        content: {querySelector: () => ({innerHTML: '<span data-type="strong text" style="color: red;">foo</span>'})},
    } as unknown as HTMLTemplateElement);
    assert.equal(block, markdown + "\n");
    assert.equal(html, '<span data-type="strong text" style="color: red;">foo</span>');
});
