import {getAgentLute} from "../../../protyle/render/setLute";
import type {AgentMarkdownParseRequest, AgentMarkdownParseResponse} from "./AgentMarkdownParser";

const scope = globalThis as unknown as {
    importScripts: (url: string) => void;
    onmessage: (event: MessageEvent<AgentMarkdownParseRequest>) => void;
    postMessage: (response: AgentMarkdownParseResponse) => void;
};
let lute: Lute;

scope.onmessage = (event) => {
    if (!lute) {
        // 加载失败交给 Worker 的 error 事件处理，使主页面可在不支持 Worker 的环境继续预览。
        scope.importScripts(event.data.luteURL);
        lute = getAgentLute({emojiSite: "/emojis", emojis: {}, sanitize: true});
    }
    try {
        const start = performance.now();
        const html = lute.ProtylePreviewStr("", event.data.markdown);
        scope.postMessage({html, duration: performance.now() - start});
    } catch (e) {
        scope.postMessage({error: true});
    }
};
