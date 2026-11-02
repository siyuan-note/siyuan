/** 托盘只在 Windows 与 Linux 上创建，macOS 使用菜单栏与 Dock。 */
const hasTray = (platform: NodeJS.Platform): boolean => "win32" === platform || "linux" === platform;

export {hasTray};
