// 内核前端页面路径。URL 校验、远程导航白名单与会话头处理都按这些路径判断，因此集中定义。
//
// 各处的白名单范围不同，都是各自的安全边界，不要擅自合并：
//   - 远程导航与请求白名单：CHECK_AUTH + APP + WINDOW + SETTINGS
//   - sessionHeaders 响应头过滤：与远程导航白名单相同
//   - settingsWindows 的授权来源：APP + APP_INDEX + WINDOW（设置页自身不派生设置窗口）
//   - 连接切换后的回落页：APP + CHECK_AUTH
const APP_PAGE = "/stage/build/app/";
const APP_INDEX_PAGE = "/stage/build/app/index.html";
const WINDOW_PAGE = "/stage/build/app/window.html";
const SETTINGS_PAGE = "/stage/build/app/settings.html";
const CHECK_AUTH_PAGE = "/check-auth";

export {APP_PAGE, APP_INDEX_PAGE, WINDOW_PAGE, SETTINGS_PAGE, CHECK_AUTH_PAGE};
