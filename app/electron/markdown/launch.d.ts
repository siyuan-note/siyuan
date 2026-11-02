// `markdown/launch.js` 的声明：只解释文件入口，不把工作空间参数里的 .md 当成待打开文件。
export type MarkdownLaunch = {
    /** 命令行明确要求进入独立 Markdown 入口。 */
    requested: boolean;
    /** 解析出的待打开文件绝对路径。 */
    files: string[];
    /** 没有给出文件，应打开空白编辑器。 */
    newDocument: boolean;
};

export declare const isMarkdownPath: (value: unknown) => boolean;

export declare const parseMarkdownLaunch: (argv: string[], cwd: string,
    options?: {startIndex?: number; platform?: NodeJS.Platform}) => MarkdownLaunch;
