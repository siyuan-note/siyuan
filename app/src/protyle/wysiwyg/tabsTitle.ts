interface ITabsTitleLute {
    BlockDOM2Md(html: string): string;
    BlockDOM2StdMd(html: string): string;
    InlineMd2BlockDOM(markdown: string): string;
    Md2BlockDOM(markdown: string): string;
}

export const getTabsTitleMarkdown = (lute: ITabsTitleLute, title: HTMLElement) => {
    // 标准 Markdown 会丢弃 strong text 等组合文本标记上的字体样式，含样式时使用可逆的 Kramdown。
    const serialize = title.querySelector("span[style]") ?
        lute.BlockDOM2Md.bind(lute) : lute.BlockDOM2StdMd.bind(lute);
    return serialize(title.innerHTML).trim();
};

export const renderTabsTitleMarkdown = (lute: ITabsTitleLute, markdown: string,
                                        template = document.createElement("template")) => {
    // 字体颜色等文本标记使用带 span 属性的 Kramdown，块解析器可将其还原为原文本标记。
    const hasKramdownStyle = /<span\b[^>]*\bdata-type=["'][^"']*\btext\b/i.test(markdown) ||
        /\{:\s*style\s*=/.test(markdown);
    template.innerHTML = hasKramdownStyle ?
        lute.Md2BlockDOM(markdown + "\n") : lute.InlineMd2BlockDOM(markdown);
    return template.content.querySelector<HTMLElement>('[contenteditable="true"]')?.innerHTML || "";
};
