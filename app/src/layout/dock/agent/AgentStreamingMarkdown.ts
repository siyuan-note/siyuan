import {escapeHtml} from "../../../util/escape";
import {AgentMarkdownBlocks} from "./AgentMarkdownBlocks";
import {AgentMarkdownParser} from "./AgentMarkdownParser";

export const AGENT_MARKDOWN_INTERVAL = 100;
const maxInterval = 1000;

export interface AgentStreamingMarkdownScheduler {
    now: () => number;
    schedule: (callback: () => void, delay: number) => number;
    cancel: (id: number) => void;
}

const scheduler: AgentStreamingMarkdownScheduler = {
    now: () => performance.now(),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: (id) => window.clearTimeout(id),
};

export class AgentStreamingMarkdown {
    private timer: number | undefined;
    private generation = 0;
    private parsing = false;
    private content = "";
    private renderedLength = 0;
    private interval = AGENT_MARKDOWN_INTERVAL;
    private nextUpdate = 0;
    private readonly blocks = new AgentMarkdownBlocks();
    private readonly parser = new AgentMarkdownParser();
    private boundaries: number[] = [];
    private boundaryIndex = 0;
    private tailStart = 0;
    private tailNodes: Node[] | undefined;

    constructor(private readonly body: HTMLElement, private readonly onUpdate: () => void,
                private readonly clock: AgentStreamingMarkdownScheduler = scheduler) {
    }

    public update(content: string) {
        // 一条控制器对应一条追加式消息；替换原文/恢复会话时由 AgentChat 创建新控制器。
        this.content = content;
        if (content.length !== this.renderedLength) {
            this.schedule();
        }
    }

    public flush() {
        // 原文由 AgentChat 保存并负责最终渲染；切换/收尾不重复解析，也不把预览改成源码。
        this.cancel();
    }

    public cancel() {
        this.generation++;
        if (this.timer !== undefined) {
            this.clock.cancel(this.timer);
            this.timer = undefined;
        }
        this.parser.cancel();
        this.parsing = false;
    }

    private schedule() {
        if (this.timer !== undefined || this.parsing) {
            return;
        }
        // 已排队的任务不因新 token 重置；后台解析期间只保留最新快照，不积压解析请求。
        const generation = this.generation;
        this.timer = this.clock.schedule(() => {
            if (generation !== this.generation) {
                return;
            }
            this.timer = undefined;
            this.render();
        }, Math.max(0, this.nextUpdate - this.clock.now()));
    }

    private render() {
        const content = this.content;
        this.blocks.scan(content).forEach(boundary => this.boundaries.push(boundary));
        const boundary = this.boundaries[this.boundaryIndex];
        const end = boundary ?? content.length;
        const source = content.slice(this.tailStart, end);
        const start = this.clock.now();
        const generation = this.generation;
        this.parsing = true;
        this.parser.parse(source, (html, parseDuration) => {
            if (generation !== this.generation) {
                return;
            }
            this.parsing = false;
            if (html === undefined) {
                // 不在同一份失败快照上自动重试；下一次输入仍会触发解析，完成时使用完整原文。
                this.nextUpdate = this.clock.now() + maxInterval;
                if (content !== this.content) {
                    this.schedule();
                }
                return;
            }
            const applyStart = this.clock.now();
            const template = this.body.ownerDocument.createElement("template");
            template.innerHTML = html || escapeHtml(source);
            if (boundary !== undefined && template.content.lastChild?.nodeName === "PRE") {
                // Lute 在文档末尾省略代码块后的换行；已缓存分组在完整消息中并不是文档末尾。
                template.content.appendChild(this.body.ownerDocument.createTextNode("\n"));
            }
            this.preparePreview(template.content);
            this.patchPreview(template.content, boundary !== undefined);
            this.body.classList.add("agent-chat__body--streaming-markdown");
            this.renderedLength = end;
            if (boundary !== undefined) {
                // 已完成前缀留在原位，此后既不交给 Lute，也不再遍历其 DOM。
                this.tailStart = boundary;
                this.boundaryIndex++;
                if (this.boundaryIndex === this.boundaries.length) {
                    this.boundaries = [];
                    this.boundaryIndex = 0;
                }
            }
            // 将布局和滚动更新计入节流预算；超预算只降频，不关闭格式化预览。
            this.onUpdate();
            void this.body.offsetHeight;
            // Worker 的首次加载等待不代表解析成本，避免刚开启预览就被长期降频。
            const duration = (parseDuration ?? (applyStart - start)) + this.clock.now() - applyStart;
            this.interval = Math.min(maxInterval,
                Math.max(AGENT_MARKDOWN_INTERVAL, this.interval * 0.75, duration * 8, source.length / 64));
            // 初次加载或积压的已完成段落组分任务处理，每次让出主线程，再追赶可变尾部。
            this.nextUpdate = this.clock.now() + (boundary === undefined ? this.interval : 16);
            if (this.renderedLength !== this.content.length) {
                this.schedule();
            }
        });
    }

    private preparePreview(fragment: DocumentFragment) {
        fragment.querySelectorAll("[id], [updated]").forEach((element) => {
            // Lute 为每次解析生成新的 ID/时间，预览不使用这些临时属性。
            element.removeAttribute("id");
            element.removeAttribute("updated");
        });
        fragment.querySelectorAll<HTMLElement>("[data-subtype][data-content]").forEach((element) => {
            // 公式和图表在生成期间显示源码，不启动重型渲染器。
            const source = this.body.ownerDocument.createElement(element.tagName === "SPAN" ? "code" : "pre");
            source.textContent = element.getAttribute("data-content");
            element.replaceWith(source);
        });
        fragment.querySelectorAll("table").forEach((table) => {
            const wrapper = this.body.ownerDocument.createElement("div");
            wrapper.className = "table";
            const scroll = this.body.ownerDocument.createElement("div");
            table.before(wrapper);
            wrapper.appendChild(scroll);
            scroll.appendChild(table);
        });
    }

    private patchPreview(fragment: DocumentFragment, committed: boolean) {
        const previous = this.tailNodes ?? Array.from(this.body.childNodes);
        const incoming = Array.from(fragment.childNodes);
        // 提交前缀时保留已经可见的尾部，避免分任务追赶时先删除后追加而产生闪烁。
        const updated = this.patchChildren(this.body,
            committed ? previous.slice(0, incoming.length) : previous, incoming);
        this.tailNodes = committed ? previous.slice(incoming.length) : updated;
    }

    private patchChildren(parent: Node, previous: Node[], incoming: Node[]): Node[] {
        const result = incoming.map((node, index) => {
            const old = previous[index];
            if (!old) {
                parent.appendChild(node);
                return node;
            }
            if (old.isEqualNode(node)) {
                return old;
            }
            if (old.nodeType === Node.TEXT_NODE && node.nodeType === Node.TEXT_NODE) {
                const before = (old as Text).data;
                const after = (node as Text).data;
                if (after.startsWith(before)) {
                    // 未高亮代码块和正文尾部只追加字符，保留节点及已经选中的文本。
                    (old as Text).appendData(after.slice(before.length));
                } else {
                    (old as Text).data = after;
                }
                return old;
            }
            if (old instanceof Element && node instanceof Element && old.tagName === node.tagName &&
                old.namespaceURI === node.namespaceURI) {
                Array.from(old.attributes).forEach((attr) => {
                    if (!node.hasAttribute(attr.name)) {
                        old.removeAttribute(attr.name);
                    }
                });
                Array.from(node.attributes).forEach((attr) => {
                    if (old.getAttribute(attr.name) !== attr.value) {
                        old.setAttribute(attr.name, attr.value);
                    }
                });
                this.patchChildren(old, Array.from(old.childNodes), Array.from(node.childNodes));
                return old;
            }
            parent.replaceChild(node, old);
            return node;
        });
        previous.slice(incoming.length).forEach(node => parent.removeChild(node));
        return result;
    }
}
