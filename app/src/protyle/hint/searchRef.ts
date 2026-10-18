import {fetchPost} from "../../util/fetch";
import type {SearchBlock, SearchRefBlockRequestInput, SearchRefResult} from "../../types/api";

type RefSearchResult = Omit<SearchRefResult, "blocks"> & {blocks: SearchBlock[]};

// 请求结束后统一返回可渲染的候选，空响应、错误及被丢弃的请求均结束本次加载。
export const searchRef = async (params: SearchRefBlockRequestInput): Promise<RefSearchResult | undefined> => {
    let result: RefSearchResult | undefined;
    await fetchPost("/api/search/searchRefBlock", params, response => {
        if (!response || typeof response !== "object" || response.code !== 0 ||
            !response.data || typeof response.data !== "object" || !("blocks" in response.data)) {
            return;
        }
        const data = response.data;
        if (typeof data.k !== "string" || typeof data.newDoc !== "boolean" ||
            (data.blocks !== null && !Array.isArray(data.blocks))) {
            return;
        }
        result = {k: data.k, newDoc: data.newDoc, reqId: data.reqId,
            blocks: (data.blocks || []).filter((block): block is SearchBlock => block !== null)};
    });
    return result;
};
