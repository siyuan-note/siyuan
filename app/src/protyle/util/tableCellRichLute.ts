// 单元格内的软换行属于行内内容，重新解析时不能作为 Markdown 段落分隔符。
export const getTableCellEditorLute = (lute: Lute): Lute => new Proxy(lute, {
    get(target, property) {
        if (property !== "SpinBlockDOM") {
            return Reflect.get(target, property);
        }
        return (html: string) => {
            const template = document.createElement("template");
            template.innerHTML = html;
            let token = "SYTABLECELLSOFTBREAK";
            while (html.includes(token)) {
                token += "X";
            }
            const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
            let node: Node;
            while ((node = walker.nextNode())) {
                const element = node.parentElement;
                if (element?.closest('[contenteditable="true"]') &&
                    !element.closest('[data-type="NodeCodeBlock"], [data-type="NodeMathBlock"], .img')) {
                    node.textContent = node.textContent.replace(/\n/g, token);
                }
            }
            return target.SpinBlockDOM(template.innerHTML).split(token).join("&#10;");
        };
    },
});
