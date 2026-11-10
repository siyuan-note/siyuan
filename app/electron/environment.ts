// 由入口以副作用方式首先导入：ESM 的 import 会在模块体之前求值，只有把这条赋值放进无依赖的独立模块，
// 它才会早于整个启动依赖图执行。
// 开发环境下隐藏 Electron 安全清单控制台提示 https://www.electronjs.org/docs/latest/tutorial/security
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

export {};
