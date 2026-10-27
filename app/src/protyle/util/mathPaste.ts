// 共享编辑器引擎只在同步粘贴转换期间启用外部公式语法。
const withLatexMath = (lute: Lute, compatible: boolean, convert: () => string) => {
    lute.SetLatexMath(compatible);
    try {
        return convert();
    } finally {
        lute.SetLatexMath(false);
    }
};

export const markdownMathPaste = (lute: Lute, markdown: string, compatible: boolean, autoLink = false) =>
    withLatexMath(lute, compatible, () => autoLink ? lute.Md2BlockDOMWithAutoLink(markdown) : lute.Md2BlockDOM(markdown));

export const htmlMathPaste = (lute: Lute, html: string, compatible: boolean) =>
    withLatexMath(lute, compatible, () => lute.HTML2BlockDOM(html));
