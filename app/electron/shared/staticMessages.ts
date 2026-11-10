// 启动阶段的静态错误文案。这些提示可能在语言包可用之前弹出（命令行解析、内核程序缺失、
// 本地端口异常），所以中英双语随代码自带，不走 loadAppMenuLanguages。需要按用户语言显示的
// 提示从语言包取。
//
// 文案来源共三处，互不覆盖：本文件的静态提示、static/window.js 的 I18N_BASE（启动期窗口文案）、
// appearance/langs/*.json（界面启动后的文案）。三处的键名不同，不要互相搬运。

/** 一条自带中英双语的静态提示。 */
type StaticMessage = {titleZh: string; titleEn: string; content: string};

const htmlEscapeCharacters: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
};

/** HTML 片段转义，把界面文案或路径安全地拼接进窗口内容。 */
const escapeHTML = (value: unknown): string =>
    String(value).replace(/[&<>"']/g, character => htmlEscapeCharacters[character]);

export const workspaceLockedMessage: StaticMessage = {
    titleZh: "工作空间已被锁定",
    titleEn: "The workspace is locked",
    content: "<div>该工作空间正在被使用，请尝试在任务管理器中结束 SiYuan-Kernel 进程或者重启操作系统后再启动思源。</div>" +
        "<div>The workspace is being used, please try to end the SiYuan-Kernel process in the task manager or restart the operating system and then start SiYuan.</div>",
};

export const kernelPortUnavailableMessage: StaticMessage = {
    titleZh: "获取内核服务端口失败",
    titleEn: "Failed to Obtain Kernel Service Port",
    content: "<div>获取内核服务端口失败，请确保程序拥有网络权限并不受防火墙和杀毒软件阻止。</div>" +
        "<div>Failed to obtain kernel service port. Please ensure SiYuan has network permissions and is not blocked by firewalls or antivirus software.</div>",
};

export const bootTimeoutMessage: StaticMessage = {
    titleZh: "启动超时",
    titleEn: "Boot timeout",
    content: "<div>内核启动超时，请查看 <a href=\"#\" data-log-path>工作空间/temp/siyuan.log</a> 获取详细报错信息，或尝试重启思源。</div>" +
        "<div>Kernel boot timed out. Please check <a href=\"#\" data-log-path>workspace/temp/siyuan.log</a> for details, or try restarting SiYuan.</div>",
};

/** 内核程序缺失时把实际查找的路径一并显示出来，便于用户确认安装位置。 */
export const kernelProgramMissingMessage = (kernelPath: string): StaticMessage => ({
    titleZh: "内核程序丢失",
    titleEn: "Kernel program is missing",
    content: "<div>内核程序丢失，请重新安装思源，并将思源内核程序加入杀毒软件信任列表。</div>" +
        "<div>The kernel program is not found, please reinstall SiYuan and add the SiYuan kernel program into the trust list of your antivirus software.</div>" +
        `<div><i>${kernelPath}</i></div>`,
});

export const unsafeRemoteKernelArgumentsMessage: StaticMessage = {
    titleZh: "远程内核启动参数不安全",
    titleEn: "Unsafe remote kernel arguments",
    content: "<div>远程内核模式不能与弱化网页或 TLS 安全的参数同时使用。</div>" +
        "<div>Remote kernel mode cannot be used with arguments that weaken web or TLS security.</div>",
};

export const invalidRemoteKernelAddressMessage: StaticMessage = {
    titleZh: "远程内核地址无效",
    titleEn: "Invalid remote kernel address",
    content: "<div>--remote 仅接受不带路径、查询或凭据的 HTTPS origin。</div>" +
        "<div>--remote only accepts an HTTPS origin without a path, query, or credentials.</div>",
};

export const remoteKernelConnectFailedMessage: StaticMessage = {
    titleZh: "连接远程内核失败",
    titleEn: "Failed to connect to the remote kernel",
    content: "<div>连接远程内核时发生意外错误。</div>" +
        "<div>An unexpected error occurred while connecting to the remote kernel.</div>",
};

/** 含外部文本的提示统一在这里转义，调用方只传原文。 */
export const remoteKernelUnreachableMessage = (connectionError: string): StaticMessage => ({
    titleZh: "连接远程内核失败",
    titleEn: "Failed to connect to the remote kernel",
    content: "<div>无法连接远程内核，请检查地址、网络和 TLS 证书。</div>" +
        "<div>Unable to connect to the remote kernel. Check the address, network, and TLS certificate.</div>" +
        "<div>" + escapeHTML(connectionError) + "</div>",
});

// 版本号来自远端响应，可能缺失，因此按 unknown 转义后原样显示。
export const remoteKernelVersionMismatchMessage = (clientVersion: string, remoteVersion: unknown): StaticMessage => ({
    titleZh: "远程内核版本不匹配",
    titleEn: "Remote kernel version mismatch",
    content: "<div>客户端版本 " + escapeHTML(clientVersion) + " 与远程内核版本 " + escapeHTML(remoteVersion) + " 不一致。</div>" +
        "<div>Client version " + escapeHTML(clientVersion) + " does not match remote kernel version " +
        escapeHTML(remoteVersion) + ".</div>",
});

export const remoteKernelBootTimeoutMessage: StaticMessage = {
    titleZh: "连接远程内核超时",
    titleEn: "Remote kernel connection timed out",
    content: "<div>等待远程内核完成启动超时。</div><div>Timed out waiting for the remote kernel to finish booting.</div>",
};

export const remoteKernelAuthCheckFailedMessage = (error: string): StaticMessage => ({
    titleZh: "检查远程内核鉴权失败",
    titleEn: "Failed to check remote kernel authentication",
    content: "<div>无法检查远程内核的鉴权状态。</div>" +
        "<div>Unable to check the remote kernel authentication state.</div>" +
        "<div>" + escapeHTML(error) + "</div>",
});

export type {StaticMessage};
export {escapeHTML};
