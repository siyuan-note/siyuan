export const MERMAID_SANITIZE_OPTIONS = {
    USE_PROFILES: {html: true, svg: true, svgFilters: true, mathMl: true},
    ADD_TAGS: ["foreignObject", "use", "style"],
    ADD_ATTR: ["dominant-baseline", "xlink:href", "href"], // 保留对齐和链接属性
    HTML_INTEGRATION_POINTS: {foreignobject: true} // 必须添加此项，否则 foreignObject 里的 HTML 内容会被清空
};
