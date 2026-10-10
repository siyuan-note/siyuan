// CSS、脚本和 worker 各阶段受限，同时受宿主准备总期限约束。
export const AV_MAP_ASSET_TIMEOUT = 20000;
export const AV_MAP_READY_TIMEOUT = 20000;
// 文档、资源准备和 CSP 锁定共用此预算；bootstrapReady 后仅等待地图就绪。
export const AV_MAP_BOOTSTRAP_TIMEOUT = 30000;
export const AV_MAP_HOST_READY_TIMEOUT = 45000;
// 桌面创建请求与 IPC 失联的最外层兜底，不延长各阶段的独立期限。
export const AV_MAP_OWNER_TIMEOUT = 90000;
