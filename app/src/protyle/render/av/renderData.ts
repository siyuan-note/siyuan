import type {AVArchiveRenderData, AVRenderData, AVRenderResult} from "../../../types/api";

// 渲染响应包含视图时才进入界面更新，保留视图不存在的独立错误载荷。
export const isAVRenderData = (data: AVRenderResult | AVArchiveRenderData): data is AVRenderData | AVArchiveRenderData => {
    return !!data && !!data.view;
};
