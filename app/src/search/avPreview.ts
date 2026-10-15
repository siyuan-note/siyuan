import {fetchSyncPost} from "../util/fetch";
import {avRender} from "../protyle/render/av/render";
import {setAVLocateRequest} from "../protyle/render/av/locate";

const previewRequests = new WeakMap<IProtyle, symbol>();

export interface IAVSearchMatch {
    itemID: string;
    keyID: string;
    text: string;
    ranges: [number, number][];
    truncatedStart: boolean;
    truncatedEnd: boolean;
}

const isAVSearchMatch = (value: unknown): value is IAVSearchMatch => {
    if (!value || typeof value !== "object" || !("itemID" in value) || !("keyID" in value) ||
        !("text" in value) || !("ranges" in value) || !("truncatedStart" in value) || !("truncatedEnd" in value)) {
        return false;
    }
    const text = value.text;
    return typeof value.itemID === "string" && /^[\w-]+$/.test(value.itemID) &&
        typeof value.keyID === "string" && /^[\w-]+$/.test(value.keyID) && typeof text === "string" && text.length > 0 &&
        typeof value.truncatedStart === "boolean" && typeof value.truncatedEnd === "boolean" &&
        Array.isArray(value.ranges) && value.ranges.length > 0 && value.ranges.every((span: unknown) =>
            Array.isArray(span) && span.length === 2 && Number.isInteger(span[0]) && Number.isInteger(span[1]) &&
            span[0] >= 0 && span[0] < span[1] && span[1] <= text.length);
};

export const getSearchAVMatches = (element: ParentNode) => {
    const matches: IAVSearchMatch[] = [];
    element.querySelectorAll<HTMLElement>("[data-av-search-match]").forEach(item => {
        try {
            const match: unknown = JSON.parse(item.dataset.avSearchMatch);
            if (isAVSearchMatch(match)) {
                matches.push(match);
            }
        } catch {
            // 无效的命中信息不参与条目定位。
        }
    });
    return matches;
};

export const getSearchAVMatchesFromHTML = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    return getSearchAVMatches(template.content);
};

const getMatchItem = (blockElement: HTMLElement, itemID: string) => blockElement.querySelector<HTMLElement>(
    `.av__row[data-id="${itemID}"], .av__gallery-item[data-id="${itemID}"], .av__calendar-item[data-id="${itemID}"]`);

const getMatchField = (item: HTMLElement, keyID: string) => item?.querySelector<HTMLElement>(
    `[data-col-id="${keyID}"], [data-field-id="${keyID}"]`);

const getMatchRanges = (blockElement: HTMLElement, matches: IAVSearchMatch[]) => {
    const ranges: Range[] = [];
    matches.forEach(match => {
        const field = getMatchField(getMatchItem(blockElement, match.itemID), match.keyID);
        if (!field || field.closest(".fn__none")) {
            return;
        }
        const root = field.querySelector(".av__celltext") || field;
        const text = root.textContent;
        const offset = text.indexOf(match.text);
        if (offset < 0 || offset !== text.lastIndexOf(match.text) || (!match.truncatedStart && offset !== 0) ||
            (!match.truncatedEnd && offset + match.text.length !== text.length)) {
            return;
        }
        // 只映射唯一且边界一致的实际命中片段，不用提取出的文字重新搜索。
        const nodes: {node: Node, start: number, end: number}[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let position = 0;
        while (node) {
            nodes.push({node, start: position, end: position + node.textContent.length});
            position += node.textContent.length;
            node = walker.nextNode();
        }
        match.ranges.forEach(([start, end]) => {
            const first = nodes.find(item => item.start <= offset + start && offset + start < item.end);
            const last = nodes.find(item => item.start < offset + end && offset + end <= item.end);
            if (first && last) {
                const range = document.createRange();
                range.setStart(first.node, offset + start - first.start);
                range.setEnd(last.node, offset + end - last.start);
                ranges.push(range);
            }
        });
    });
    return ranges;
};

export const beginSearchPreviewRequest = (protyle: IProtyle) => {
    const token = Symbol();
    previewRequests.set(protyle, token);
    return () => previewRequests.get(protyle) === token && protyle.element.isConnected;
};

export const locateSearchAVPreview = async (options: {
    protyle: IProtyle,
    id: string,
    method: number,
    keywords: string[],
    matches?: IAVSearchMatch[],
    isCurrent: () => boolean,
}): Promise<{rootElement: HTMLElement, currentElement?: HTMLElement, ranges?: Range[], unavailable: boolean} | undefined> => {
    const blockElement = options.protyle.wysiwyg.element.querySelector<HTMLElement>(
        `.av[data-node-id="${options.id}"]`);
    if (!blockElement || !options.isCurrent() || ![0, 1, 3].includes(options.method) ||
        !options.keywords?.length || window.siyuan.isPublish) {
        return;
    }
    const target = options.matches?.[0];
    let itemID = target?.itemID;
    let keyID = target?.keyID;
    if (!target) {
        if (options.method === 3) {
            return {rootElement: blockElement, currentElement: blockElement, ranges: [], unavailable: false};
        }
        if (options.matches) {
            return;
        }
        const response = await fetchSyncPost("/api/av/getAttributeViewSearchTarget", {
            id: options.id,
            keywords: options.keywords,
        });
        if (!options.isCurrent() || !blockElement.isConnected || response.code !== 0 || !response.data) {
            return;
        }
        itemID = response.data.itemID;
        keyID = response.data.matchedKeyID;
    }
    // 搜索预览沿用当前视图，只定位条目，不写入视图配置或改变编辑选区。
    setAVLocateRequest(blockElement, {
        itemID,
        keyID,
        select: false,
        highlight: true,
        persistView: false,
        isValid: options.isCurrent,
    });
    blockElement.removeAttribute("data-render");
    let rendered: IAV;
    await avRender(blockElement, options.protyle, data => {
        rendered = data;
    });
    if (!options.isCurrent() || !blockElement.isConnected) {
        return;
    }
    const item = getMatchItem(blockElement, itemID);
    return {
        rootElement: blockElement,
        currentElement: getMatchField(item, keyID) || item || undefined,
        ranges: options.matches ? getMatchRanges(blockElement, options.matches) : undefined,
        unavailable: rendered?.target?.status !== "visible" || !item,
    };
};
