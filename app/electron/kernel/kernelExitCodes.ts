// 内核退出码到启动失败表现的映射。不含窗口创建与进程操作，调用方按 kind 决定如何呈现。
// 20 数据库不可用、21 端口占用、24 工作空间被锁定、25 工作空间目录不可创建、
// 26 文件系统访问失败，其余非零码归为未知原因。24 的文案属于锁定提示，由调用方提供。

type LogSource = "workspace" | "kernel";

type KernelExitReport = {
    kind: "ignore" | "locked" | "error";
    titleZh?: string;
    titleEn?: string;
    content?: string;
    emoji?: string;
    logSource?: LogSource;
};

const describeKernelExit = (code: number, {expectedExit = false, port = ""} = {}): KernelExitReport => {
    if (expectedExit || code === 0) {
        return {kind: "ignore"};
    }
    // 锁冲突的提示文案由调用方的 showWorkspaceLocked 统一给出，这里只传递种类。
    if (code === 24) {
        return {kind: "locked"};
    }
    return describeFailure(code, port);
};

const describeFailure = (code: number, port: number | string): KernelExitReport => {
    switch (code) {
        case 20:
            return {
                kind: "error",
                titleZh: "数据库不可用",
                titleEn: "The database is unavailable",
                content: "<div>无法访问数据库文件，请查看 <a href=\"#\" data-log-path>工作空间/temp/siyuan.log</a> 获取详细报错信息</div><div>Cannot access the database file. Please check <a href=\"#\" data-log-path>workspace/temp/siyuan.log</a> for detailed error information.</div>",
                emoji: "⚠️",
                logSource: "workspace",
            };
        case 21:
            return {
                kind: "error",
                titleZh: "监听端口 " + port + " 失败",
                titleEn: "Failed to listen to port " + port,
                content: "<div>监听 " + port + " 端口失败，请确保程序拥有网络权限并不受防火墙和杀毒软件阻止。</div><div>Failed to listen to port " + port + ", please make sure the program has network permissions and is not blocked by firewalls and antivirus software.</div>",
                emoji: "⚠️",
            };
        case 25:
            return {
                kind: "error",
                titleZh: "初始化工作空间失败",
                titleEn: "Failed to create workspace directory",
                content: "<div>工作空间文件夹权限不足，请查看 <a href=\"#\" data-log-path>~/.config/siyuan/kernel.log</a> 获取详细报错信息</div><div>Insufficient permissions for the workspace folder. Please check <a href=\"#\" data-log-path>~/.config/siyuan/kernel.log</a> for detailed error information.</div>",
                emoji: "⚠️",
                logSource: "kernel",
            };
        case 26:
            return {
                kind: "error",
                titleZh: "文件系统访问失败",
                titleEn: "File system access failed",
                content: "<div>思源内核无法访问所需文件，现已安全退出。可能原因包括文件或文件夹权限不足、文件为只读、文件被其他程序占用，以及同步盘或安全软件干预。</div><div>请查看 <a href=\"#\" data-log-path>工作空间/temp/siyuan.log</a> 获取详细错误信息。</div><div>SiYuan Kernel could not access a required file and has exited safely. Possible causes include insufficient permissions, read-only files, another process using a file, or interference from sync or security software.</div><div>Please check <a href=\"#\" data-log-path>workspace/temp/siyuan.log</a> for details.</div>",
                emoji: "⚠️",
                logSource: "workspace",
            };
        default:
            return {
                kind: "error",
                titleZh: "内核因未知原因退出",
                titleEn: "The kernel exited for unknown reasons",
                content: `<div>思源内核因未知原因退出 [code=${code}]，请尝试重启操作系统后再启动思源。如果该问题依然发生，请检查杀毒软件是否阻止思源内核启动。</div><div>SiYuan Kernel exited for unknown reasons [code=${code}], please try to reboot your operating system and then start SiYuan again. If occurs this problem still, please check your anti-virus software whether kill the SiYuan Kernel.</div>`,
            };
    }
};

export {describeKernelExit};
