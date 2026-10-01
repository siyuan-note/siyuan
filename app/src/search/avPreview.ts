import {fetchSyncPost} from "../util/fetch";
import {avRender} from "../protyle/render/av/render";
import {setAVLocateRequest} from "../protyle/render/av/locate";

const previewRequests = new WeakMap<IProtyle, symbol>();

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
    isCurrent: () => boolean,
}): Promise<{rootElement: HTMLElement, currentElement?: HTMLElement, unavailable: boolean} | undefined> => {
    const blockElement = options.protyle.wysiwyg.element.querySelector<HTMLElement>(
        `.av[data-node-id="${options.id}"]`);
    if (!blockElement || !options.isCurrent() || ![0, 1, 3].includes(options.method) ||
        !options.keywords?.length || window.siyuan.isPublish) {
        return;
    }
    const response = await fetchSyncPost("/api/av/getAttributeViewSearchTarget", {
        id: options.id,
        keywords: options.keywords,
    });
    if (!options.isCurrent() || !blockElement.isConnected || response.code !== 0 || !response.data) {
        return;
    }
    const target = response.data;
    // 搜索预览沿用当前视图，只定位条目，不写入视图配置或改变编辑选区。
    setAVLocateRequest(blockElement, {
        itemID: target.itemID,
        keyID: target.matchedKeyID,
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
    const item = blockElement.querySelector<HTMLElement>(
        `.av__row[data-id="${target.itemID}"], .av__gallery-item[data-id="${target.itemID}"], .av__calendar-item[data-id="${target.itemID}"]`);
    return {
        rootElement: blockElement,
        currentElement: item?.querySelector<HTMLElement>(
            `[data-col-id="${target.matchedKeyID}"], [data-field-id="${target.matchedKeyID}"]`) || item || undefined,
        unavailable: rendered?.target?.status !== "visible" || !item,
    };
};
