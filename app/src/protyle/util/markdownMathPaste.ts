// The shared editor engine must never retain external-input syntax after a paste conversion.
export const markdownMathPaste = (lute: Lute, markdown: string, compatible: boolean, autoLink = false) => {
    lute.SetLatexMath(compatible);
    try {
        return autoLink ? lute.Md2BlockDOMWithAutoLink(markdown) : lute.Md2BlockDOM(markdown);
    } finally {
        lute.SetLatexMath(false);
    }
};
