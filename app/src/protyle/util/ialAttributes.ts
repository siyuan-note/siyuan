// 文档 IAL 的属性名会直接写入 DOM，以 on 开头的名字会被浏览器当作事件处理器执行。
// 内核输出边界已经过滤，前端写属性时仍需丢弃，避免其他来源的 IAL 重新引入
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-x62v-7955-xx6v
export const isHandlerIALAttribute = (name: string) => name.toLowerCase().startsWith("on");
