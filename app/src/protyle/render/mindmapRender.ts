import {listMindmapRender} from "./listMindmap/render";
import {renderLegacyMindmaps} from "./listMindmap/legacy";

// 保留插件和导出页面的公开入口，统一使用列表脑图显示。
export const mindmapRender = (element: Element, cdn?: string) => {
    listMindmapRender(element, cdn);
    renderLegacyMindmaps(element, cdn);
};
