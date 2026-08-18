const NBSP = "\u00A0";
const ZERO_WIDTH_REGEXP = /\u200B|\u200C|\u200D|\uFEFF/g;
const UNORDERED_LIST_MARKERS = ["•", "◦", "▪", "▫"];
const INLINE_LIST_ELEMENTS = new Set([
    "A", "ABBR", "B", "BR", "CODE", "DEL", "EM", "I", "IMG", "KBD", "MARK", "S", "SMALL", "SPAN",
    "STRONG", "SUB", "SUP", "U",
]);

type TTaskState = "checked" | "unchecked" | undefined;

export interface ITableGridCell {
    colSpan: number;
    rowSpan: number;
}

const numberToLetter = (number: number, uppercase: boolean) => {
    let value = Math.max(1, number);
    let result = "";
    while (value > 0) {
        value--;
        result = String.fromCharCode((uppercase ? 65 : 97) + value % 26) + result;
        value = Math.floor(value / 26);
    }
    return result;
};

const numberToRoman = (number: number) => {
    if (number < 1 || number > 3999) {
        return number.toString();
    }
    const numerals: Array<[number, string]> = [
        [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"],
        [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
    ];
    let remaining = number;
    let result = "";
    numerals.forEach(([value, numeral]) => {
        while (remaining >= value) {
            result += numeral;
            remaining -= value;
        }
    });
    return result;
};

export const getPlatformListMarker = (ordered: boolean, number: number, depth: number, taskState?: TTaskState) => {
    if (taskState) {
        return taskState === "checked" ? "✅ " : "▢ ";
    }
    if (!ordered) {
        return `${UNORDERED_LIST_MARKERS[depth % UNORDERED_LIST_MARKERS.length]} `;
    }
    switch (depth % 6) {
        case 1:
            return `${number}) `;
        case 2:
            return `${numberToLetter(number, true)}. `;
        case 3:
            return `${numberToLetter(number, false)}. `;
        case 4:
            return `${numberToRoman(number)}. `;
        default:
            return `${number}. `;
    }
};

const preserveSpaces = (line: string) => line
    .replace(/\t/g, NBSP.repeat(4))
    .replace(/^ +| +$| {2,}/g, spaces => NBSP.repeat(spaces.length));

export const getWechatCodeLines = (text: string) => text.split(/\r\n|\r|\n/).map(preserveSpaces);

export const buildExpandedTableGrid = <T extends ITableGridCell>(rows: T[][]) => {
    const grid: Array<Array<T | undefined>> = rows.map(() => []);
    let columnCount = 0;
    rows.forEach((cells, rowIndex) => {
        let columnIndex = 0;
        cells.forEach(cell => {
            while (grid[rowIndex][columnIndex]) {
                columnIndex++;
            }
            const rowSpan = cell.rowSpan === 0 ? rows.length - rowIndex : Math.max(1, cell.rowSpan);
            const colSpan = Math.max(1, cell.colSpan);
            for (let rowOffset = 0; rowOffset < rowSpan && rowIndex + rowOffset < rows.length; rowOffset++) {
                for (let columnOffset = 0; columnOffset < colSpan; columnOffset++) {
                    grid[rowIndex + rowOffset][columnIndex + columnOffset] = cell;
                }
            }
            columnIndex += colSpan;
            columnCount = Math.max(columnCount, columnIndex);
        });
        columnCount = Math.max(columnCount, grid[rowIndex].length);
    });
    return grid.map(row => Array.from({length: columnCount}, (_, index) => row[index]));
};

const isListElement = (element: Element): element is HTMLOListElement | HTMLUListElement =>
    element.tagName === "OL" || element.tagName === "UL";

const getDirectListItems = (list: HTMLOListElement | HTMLUListElement) =>
    Array.from(list.children).filter((item): item is HTMLLIElement => item.tagName === "LI");

const getDirectNestedLists = (item: HTMLLIElement) =>
    Array.from(item.children).filter(isListElement);

const hasOwnTaskMarker = (item: HTMLLIElement) => Array.from(item.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .find(input => input.closest("li") === item);

const getListStart = (list: HTMLOListElement | HTMLUListElement) => {
    const value = list.getAttribute("start");
    if (value === null) {
        return 1;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 1 : parsed;
};

const getListItemValue = (item: HTMLLIElement, fallback: number) => {
    const value = item.getAttribute("value");
    if (value === null) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
};

const listItemNeedsFlattening = (item: HTMLLIElement, platform: "mp-wechat" | "zhihu") => {
    const nestedLists = getDirectNestedLists(item);
    const contentElements = Array.from(item.children).filter(element =>
        !isListElement(element) && !(element.tagName === "INPUT" && element.getAttribute("type") === "checkbox"));
    const hasDirectText = Array.from(item.childNodes).some(node =>
        node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
    const unsupportedSelector = platform === "zhihu" ?
        "img, pre, figure, table, blockquote, section, div[data-subtype]" :
        "pre, figure, table, blockquote, section, div[data-subtype]";
    const hasUnsupportedContent = contentElements.some(element =>
        element.matches(unsupportedSelector) || Boolean(element.querySelector(unsupportedSelector)));
    const contentCount = contentElements.length + (hasDirectText ? 1 : 0);
    return hasUnsupportedContent || (nestedLists.length > 0 && contentCount > 1);
};

const getOutermostList = (list: HTMLOListElement | HTMLUListElement, root: HTMLElement) => {
    let result = list;
    let parent = list.parentElement?.closest("ol, ul");
    while (parent && root.contains(parent)) {
        result = parent as HTMLOListElement | HTMLUListElement;
        parent = parent.parentElement?.closest("ol, ul");
    }
    return result;
};

const setListContentIndent = (element: HTMLElement, depth: number) => {
    if (depth > 0) {
        element.style.marginLeft = `${depth * 2}em`;
    }
};

const prependListMarker = (paragraph: HTMLElement, marker: string, depth: number) => {
    paragraph.querySelectorAll('input[type="checkbox"]').forEach(input => input.remove());
    const markerElement = paragraph.ownerDocument.createElement("strong");
    markerElement.textContent = marker;
    paragraph.insertBefore(markerElement, paragraph.firstChild);
    setListContentIndent(paragraph, depth);
};

const appendMarkerParagraph = (fragment: DocumentFragment, marker: string, depth: number) => {
    const paragraph = fragment.ownerDocument.createElement("p");
    prependListMarker(paragraph, marker, depth);
    fragment.appendChild(paragraph);
};

const flattenList = (list: HTMLOListElement | HTMLUListElement, depth: number, fragment: DocumentFragment) => {
    const ordered = list.tagName === "OL";
    let number = getListStart(list);
    getDirectListItems(list).forEach(item => {
        const taskMarker = hasOwnTaskMarker(item);
        const itemNumber = getListItemValue(item, number);
        const marker = getPlatformListMarker(ordered, itemNumber, depth,
            taskMarker ? (taskMarker.checked ? "checked" : "unchecked") : undefined);
        let markerAdded = false;
        let inlineParagraph: HTMLParagraphElement | undefined;
        const appendParagraph = (paragraph: HTMLParagraphElement) => {
            if (!hasParagraphContent(paragraph)) {
                return;
            }
            if (!markerAdded) {
                prependListMarker(paragraph, marker, depth);
                markerAdded = true;
            } else {
                setListContentIndent(paragraph, depth + 1);
            }
            fragment.appendChild(paragraph);
        };
        const flushInlineParagraph = () => {
            if (inlineParagraph) {
                appendParagraph(inlineParagraph);
                inlineParagraph = undefined;
            }
        };
        Array.from(item.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                if (!node.textContent?.trim() && !inlineParagraph) {
                    return;
                }
                if (!inlineParagraph) {
                    inlineParagraph = item.ownerDocument.createElement("p");
                }
                inlineParagraph.appendChild(node.cloneNode(true));
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return;
            }
            const element = node as HTMLElement;
            if (element.tagName === "INPUT" && element.getAttribute("type") === "checkbox") {
                return;
            }
            if (isListElement(element)) {
                flushInlineParagraph();
                if (!markerAdded) {
                    appendMarkerParagraph(fragment, marker, depth);
                    markerAdded = true;
                }
                flattenList(element, depth + 1, fragment);
                return;
            }
            if (INLINE_LIST_ELEMENTS.has(element.tagName)) {
                if (!inlineParagraph) {
                    inlineParagraph = item.ownerDocument.createElement("p");
                }
                inlineParagraph.appendChild(element.cloneNode(true));
                return;
            }
            flushInlineParagraph();
            const clone = element.cloneNode(true) as HTMLElement;
            if (clone.tagName === "P") {
                appendParagraph(clone as HTMLParagraphElement);
                return;
            }
            if (!markerAdded) {
                appendMarkerParagraph(fragment, marker, depth);
                markerAdded = true;
            }
            setListContentIndent(clone, depth + 1);
            fragment.appendChild(clone);
        });
        flushInlineParagraph();
        if (!markerAdded) {
            appendMarkerParagraph(fragment, marker, depth);
        }
        number = itemNumber + 1;
    });
};

const flattenUnsupportedLists = (root: HTMLElement, platform: "mp-wechat" | "zhihu") => {
    const roots = new Set<HTMLOListElement | HTMLUListElement>();
    root.querySelectorAll<HTMLOListElement | HTMLUListElement>("ol, ul").forEach(list => {
        if (getDirectListItems(list).some(item => listItemNeedsFlattening(item, platform))) {
            roots.add(getOutermostList(list, root));
        }
    });
    roots.forEach(list => {
        if (!list.isConnected && !root.contains(list)) {
            return;
        }
        const fragment = list.ownerDocument.createDocumentFragment();
        flattenList(list, 0, fragment);
        list.replaceWith(fragment);
    });
};

const preserveWechatCodeWhitespace = (root: HTMLElement) => {
    root.querySelectorAll("pre.code-block code").forEach(code => {
        const walker = code.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        let node = walker.nextNode();
        while (node) {
            textNodes.push(node as Text);
            node = walker.nextNode();
        }
        textNodes.forEach(textNode => {
            const lines = getWechatCodeLines(textNode.data);
            if (lines.length === 1 && lines[0] === textNode.data) {
                return;
            }
            const fragment = code.ownerDocument.createDocumentFragment();
            lines.forEach((line, index) => {
                if (line) {
                    fragment.appendChild(code.ownerDocument.createTextNode(line));
                }
                if (index < lines.length - 1) {
                    fragment.appendChild(code.ownerDocument.createElement("br"));
                }
            });
            textNode.replaceWith(fragment);
        });
    });
};

const copyComputedStyles = (source: HTMLElement, target: HTMLElement) => {
    const view = source.ownerDocument.defaultView;
    if (!view) {
        return;
    }
    const computedStyle = view.getComputedStyle(source);
    [
        "margin", "padding", "background-color", "background-image", "color", "font-size", "font-weight",
        "border-radius", "line-height", "display", "flex-direction", "box-sizing",
    ].forEach(property => target.style.setProperty(property, computedStyle.getPropertyValue(property)));
    const markerStyle = view.getComputedStyle(source, "::before");
    const markerColor = markerStyle.getPropertyValue("background-color");
    const markerWidth = markerStyle.getPropertyValue("width");
    if (markerColor && markerColor !== "rgba(0, 0, 0, 0)" && markerWidth && markerWidth !== "auto") {
        const borderProperty = computedStyle.direction === "rtl" ? "border-right" : "border-left";
        target.style.setProperty(borderProperty, `${markerWidth} solid ${markerColor}`);
    }
};

const convertWechatBlockquotes = (root: HTMLElement, sourceRoot?: HTMLElement) => {
    const sourceBlockquotes = sourceRoot ? Array.from(sourceRoot.querySelectorAll<HTMLElement>("blockquote")) : [];
    Array.from(root.querySelectorAll<HTMLElement>("blockquote")).forEach((blockquote, index) => {
        const section = blockquote.ownerDocument.createElement("section");
        Array.from(blockquote.attributes).forEach(attribute => section.setAttribute(attribute.name, attribute.value));
        const source = sourceBlockquotes[index];
        if (source) {
            copyComputedStyles(source, section);
        }
        section.append(...Array.from(blockquote.childNodes));
        blockquote.replaceWith(section);
    });
};

const getListDepth = (list: Element) => {
    let depth = 0;
    let parent = list.parentElement;
    while (parent) {
        if (isListElement(parent)) {
            depth++;
        }
        parent = parent.parentElement;
    }
    return depth;
};

const normalizeWechatLists = (root: HTMLElement) => {
    const lists = Array.from(root.querySelectorAll<HTMLOListElement | HTMLUListElement>("ol, ul"))
        .sort((first, second) => getListDepth(second) - getListDepth(first));
    lists.forEach(list => {
        if (list.tagName === "OL") {
            const start = getListStart(list);
            list.classList.add(`list-paddingleft-${Math.min(start.toString().length, 3)}`);
            list.style.listStyleType = "decimal";
        }
        getDirectListItems(list).forEach(item => {
            getDirectNestedLists(item).reverse().forEach(nestedList => {
                item.parentNode?.insertBefore(nestedList, item.nextSibling);
            });
        });
    });
    root.querySelectorAll<HTMLElement>("li.protyle-task").forEach(item => {
        const checkbox = hasOwnTaskMarker(item as HTMLLIElement);
        if (!checkbox) {
            return;
        }
        checkbox.style.opacity = "0";
        item.style.setProperty("list-style-type", checkbox.checked ? "'✅'" : "'▢'", "important");
    });
};

const cleanImageParagraphs = (root: HTMLElement) => {
    root.querySelectorAll("p").forEach(paragraph => {
        if (!paragraph.querySelector("img")) {
            return;
        }
        const walker = paragraph.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        let node = walker.nextNode();
        while (node) {
            textNodes.push(node as Text);
            node = walker.nextNode();
        }
        textNodes.forEach(textNode => {
            textNode.data = textNode.data.replace(ZERO_WIDTH_REGEXP, "");
        });
    });
};

const hasParagraphContent = (paragraph: HTMLElement) =>
    Boolean(paragraph.textContent?.replace(ZERO_WIDTH_REGEXP, "").trim()) || paragraph.children.length > 0;

const splitParagraphFigures = (paragraph: HTMLParagraphElement) => {
    if (!Array.from(paragraph.children).some(child => child.tagName === "FIGURE")) {
        return;
    }
    const fragment = paragraph.ownerDocument.createDocumentFragment();
    let segment = paragraph.cloneNode(false) as HTMLParagraphElement;
    const appendSegment = () => {
        if (hasParagraphContent(segment)) {
            fragment.appendChild(segment);
        }
        segment = paragraph.cloneNode(false) as HTMLParagraphElement;
    };
    Array.from(paragraph.childNodes).forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "FIGURE") {
            appendSegment();
            fragment.appendChild(node);
        } else {
            segment.appendChild(node);
        }
    });
    appendSegment();
    paragraph.replaceWith(fragment);
};

const applyImageLayout = (imageWrapper: HTMLElement, sourceImage: HTMLImageElement, targetImage: HTMLImageElement,
                          figure?: HTMLElement) => {
    const width = sourceImage.parentElement?.style.width;
    if (width) {
        targetImage.style.width = width;
    }
    const alignment = imageWrapper.style.textAlign;
    if (figure) {
        figure.style.cssText = imageWrapper.style.cssText;
        return;
    }
    if (alignment === "center") {
        targetImage.style.display = "block";
        targetImage.style.marginLeft = "auto";
        targetImage.style.marginRight = "auto";
    } else if (alignment === "right") {
        targetImage.style.display = "block";
        targetImage.style.marginLeft = "auto";
    }
};

const convertZhihuImages = (root: HTMLElement) => {
    Array.from(root.querySelectorAll<HTMLElement>('span[data-type="img"]')).forEach(imageWrapper => {
        const image = imageWrapper.querySelector<HTMLImageElement>("img");
        if (!image) {
            return;
        }
        const clonedImage = image.cloneNode(true) as HTMLImageElement;
        const title = imageWrapper.querySelector<HTMLElement>(".protyle-action__title span")?.textContent?.trim() ||
            image.getAttribute("title")?.trim();
        if (!title) {
            applyImageLayout(imageWrapper, image, clonedImage);
            imageWrapper.replaceWith(clonedImage);
            return;
        }
        const figure = imageWrapper.ownerDocument.createElement("figure");
        const caption = imageWrapper.ownerDocument.createElement("figcaption");
        caption.textContent = title;
        applyImageLayout(imageWrapper, image, clonedImage, figure);
        figure.append(clonedImage, caption);
        imageWrapper.replaceWith(figure);
    });
    cleanImageParagraphs(root);
    Array.from(root.querySelectorAll<HTMLParagraphElement>("p")).forEach(splitParagraphFigures);
};

const convertZhihuCodeBlocks = (root: HTMLElement) => {
    root.querySelectorAll<HTMLElement>("pre.code-block").forEach(codeBlock => {
        const code = codeBlock.querySelector("code");
        if (!code) {
            return;
        }
        const replacement = codeBlock.ownerDocument.createElement("pre");
        const language = codeBlock.getAttribute("data-language");
        if (language) {
            replacement.setAttribute("lang", language);
        }
        replacement.textContent = code.textContent;
        codeBlock.replaceWith(replacement);
    });
};

const collectZhihuBlockquoteChildren = (element: HTMLElement, elements: HTMLElement[]) => {
    Array.from(element.children).forEach((item: HTMLElement) => {
        if (item.tagName === "BLOCKQUOTE") {
            collectZhihuBlockquoteChildren(item, elements);
        } else if (item.tagName !== "P" || item.querySelector("img")) {
            elements.push(item);
        } else {
            const lastElement = elements[elements.length - 1];
            if (!lastElement || lastElement.tagName !== "BLOCKQUOTE") {
                elements.push(element.ownerDocument.createElement("blockquote"));
            }
            elements[elements.length - 1].append(item);
        }
    });
};

const normalizeZhihuBlockquotes = (root: HTMLElement) => {
    Array.from(root.querySelectorAll<HTMLElement>("blockquote")).forEach(blockquote => {
        if (!root.contains(blockquote)) {
            return;
        }
        const elements: HTMLElement[] = [];
        collectZhihuBlockquoteChildren(blockquote, elements);
        elements.reverse().forEach(item => blockquote.insertAdjacentElement("afterend", item));
        blockquote.remove();
    });
};

const expandMergedTableCells = (table: HTMLTableElement) => {
    const rows = Array.from(table.rows);
    const sourceRows = rows.map(row => Array.from(row.cells)
        .filter(cell => !cell.classList.contains("fn__none")));
    if (!sourceRows.some(row => row.some(cell => cell.rowSpan !== 1 || cell.colSpan !== 1))) {
        return;
    }
    const grid = buildExpandedTableGrid(sourceRows);
    rows.forEach((row, rowIndex) => {
        const defaultTag = row.parentElement?.tagName === "THEAD" ? "th" : "td";
        const cells = grid[rowIndex].map(source => {
            const clone = source ? source.cloneNode(true) as HTMLTableCellElement :
                row.ownerDocument.createElement(defaultTag) as HTMLTableCellElement;
            clone.removeAttribute("rowspan");
            clone.removeAttribute("colspan");
            clone.classList.remove("fn__none");
            if (!clone.className) {
                clone.removeAttribute("class");
            }
            return clone;
        });
        row.replaceChildren(...cells);
    });
};

const normalizeZhihuTables = (root: HTMLElement) => {
    root.querySelectorAll<HTMLTableElement>("table").forEach(table => {
        expandMergedTableCells(table);
        const head = table.tHead;
        if (!head) {
            return;
        }
        const body = table.tBodies[0] || table.createTBody();
        body.prepend(...Array.from(head.rows));
        head.remove();
    });
};

export const prepareWechatCopy = (root: HTMLElement, sourceRoot?: HTMLElement) => {
    convertWechatBlockquotes(root, sourceRoot);
    preserveWechatCodeWhitespace(root);
    flattenUnsupportedLists(root, "mp-wechat");
    normalizeWechatLists(root);
};

export const prepareZhihuCopy = (root: HTMLElement) => {
    convertZhihuImages(root);
    convertZhihuCodeBlocks(root);
    normalizeZhihuTables(root);
    normalizeZhihuBlockquotes(root);
    flattenUnsupportedLists(root, "zhihu");
};
