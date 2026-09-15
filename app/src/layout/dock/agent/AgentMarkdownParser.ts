import {getAgentLute} from "../../../protyle/render/setLute";
import {Constants} from "../../../constants";

export interface AgentMarkdownParseRequest {
    markdown: string;
    luteURL: string;
}

export type AgentMarkdownParseResponse = {html: string; duration: number} | {error: true};

const createWorker = () => {
    // @ts-ignore -- Webpack 通过 import.meta.url 打包 Worker，主项目使用 CommonJS 类型检查。
    return new Worker(new URL("./AgentMarkdownWorker.ts", import.meta.url));
};

/** 同时只允许一个解析请求；按需创建独立 Worker，不支持后台解析时使用相同的主线程 Lute。 */
export class AgentMarkdownParser {
    private worker: Worker | undefined;
    private workerUnavailable = false;
    private lute: Lute | undefined;
    private generation = 0;

    constructor(private readonly workerFactory: () => Worker = createWorker) {
    }

    public parse(markdown: string, done: (html?: string, duration?: number) => void) {
        const generation = this.generation;
        const script = document.getElementById("protyleLuteScript") as HTMLScriptElement;
        // 本地内核通过 XHR 将 Lute 内联到 script，没有 src；此时使用相同的版本化资源地址。
        const luteURL = script && (script.src || new URL(
            `${Constants.PROTYLE_CDN}/js/lute/lute.min.js?v=${Constants.SIYUAN_VERSION}`, document.baseURI).href);
        if (!this.workerUnavailable && luteURL) {
            try {
                if (!this.worker) {
                    this.worker = this.workerFactory();
                }
                this.worker.onmessage = (event: MessageEvent<AgentMarkdownParseResponse>) => {
                    if (generation === this.generation) {
                        if ("html" in event.data) {
                            done(event.data.html, event.data.duration);
                        } else {
                            done();
                        }
                    }
                };
                const onFailure = (event: Event) => {
                    event.preventDefault();
                    if (generation !== this.generation) {
                        return;
                    }
                    this.cancel();
                    this.workerUnavailable = true;
                    this.parseInline(markdown, done);
                };
                this.worker.onerror = onFailure;
                this.worker.onmessageerror = onFailure;
                this.worker.postMessage({markdown, luteURL} satisfies AgentMarkdownParseRequest);
                return;
            } catch (e) {
                this.cancel();
                this.workerUnavailable = true;
            }
        }
        this.parseInline(markdown, done);
    }

    public cancel() {
        this.generation++;
        if (this.worker) {
            this.worker.onmessage = null;
            this.worker.onerror = null;
            this.worker.onmessageerror = null;
            this.worker.terminate();
            this.worker = undefined;
        }
    }

    private parseInline(markdown: string, done: (html?: string) => void) {
        let html: string | undefined;
        try {
            if (!this.lute) {
                this.lute = getAgentLute({emojiSite: "/emojis", emojis: {}, sanitize: true});
            }
            html = this.lute.ProtylePreviewStr("", markdown);
        } catch (e) {
            // 当前预览保留到下一次输入重试；解析错误不应中断 SSE 或覆盖已经格式化的内容。
        }
        done(html);
    }
}
