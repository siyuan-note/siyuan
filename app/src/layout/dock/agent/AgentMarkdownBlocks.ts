// 缓存以段落组为单位，避免大量小段落分别创建解析任务。
const groupSize = 2048;
const listMarker = /^(?:[-+*]|\d+[.)])(?:[ \t]|$)/;

/**
 * 只扫描新增的完整行。空行不是充分条件：还需要后续完整的顶层普通段落或标题来关闭前块。
 * 列表、引述和表格不从内部拆开；不确定的 HTML、公式和思源扩展留在同一个可变尾部。
 * 调用者只传入同一条消息的追加式原文；偏移按原始 UTF-16 计算，不改写 CRLF。
 */
export class AgentMarkdownBlocks {
    private cursor = 0;
    private lineStart = 0;
    private groupStart = 0;
    private blank = false;
    private opaque = false;
    private fence = "";
    private fenceLength = 0;

    public scan(content: string): number[] {
        const boundaries: number[] = [];
        while (this.cursor < content.length) {
            const char = content[this.cursor];
            if (char !== "\n" && char !== "\r") {
                this.cursor++;
                continue;
            }
            // 保留分块末尾的 CR，等下一次输入确认它是不是 CRLF。
            if (char === "\r" && this.cursor + 1 === content.length) {
                break;
            }
            const line = content.slice(this.lineStart, this.cursor);
            if (this.blank && !this.fence && !this.opaque &&
                this.lineStart - this.groupStart >= groupSize && this.startsIndependentBlock(line)) {
                boundaries.push(this.lineStart);
                this.groupStart = this.lineStart;
            }
            this.consumeLine(line);
            this.cursor += char === "\r" && content[this.cursor + 1] === "\n" ? 2 : 1;
            this.lineStart = this.cursor;
        }
        return boundaries;
    }

    private startsIndependentBlock(line: string) {
        // 等待完整的后继行，防止逐字符到达的 IAL、列表标记或容器开头被误认为普通段落。
        return !!line && !/^[\s><{}`~$=|:+*-]/.test(line) && !listMarker.test(line);
    }

    private consumeLine(line: string) {
        if (this.fence) {
            const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
            if (closing && closing[1][0] === this.fence && closing[1].length >= this.fenceLength) {
                this.fence = "";
            }
            this.blank = false;
            return;
        }
        const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (opening && (opening[1][0] !== "`" || !opening[2].includes("`"))) {
            this.fence = opening[1][0];
            this.fenceLength = opening[1].length;
        } else if (/<|\$\$|\{\{|\{:|^[ \t]*===|`{3}|~{3}/.test(line)) {
            // 这些语法可能跨空行或影响父容器；宁可减少缓存，也不复制一套不完整的 Lute 语法。
            this.opaque = true;
        }
        this.blank = /^[ \t]*$/.test(line);
    }
}
