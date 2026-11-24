import {Constants} from "../constants";

export const rangeMarkdown = (lute: Lute, range: Range, root: Element) => {
    const text = range.toString().replaceAll(Constants.ZWSP, "");
    let fragment: Node = range.cloneContents();
    const common = range.commonAncestorContainer;
    let ancestor = common.nodeType === Node.ELEMENT_NODE ? common as Element : common.parentElement;
    while (ancestor && ancestor !== root && root.contains(ancestor)) {
        if (ancestor.matches("span[data-type], span[style], code, strong, em, b, i, s, del, ins, u, mark, sub, sup, kbd, a")) {
            const clone = ancestor.cloneNode(false) as Element;
            clone.append(fragment);
            fragment = clone;
        }
        ancestor = ancestor.parentElement;
    }
    const element = root.ownerDocument.createElement("div");
    element.append(fragment);
    return lute.BlockDOM2StdMd(element.innerHTML).trimEnd() || text;
};
