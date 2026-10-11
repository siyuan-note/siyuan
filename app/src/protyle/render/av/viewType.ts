// 表格和列表共享行列数据及单元格交互，布局选项仍由各视图独立处理。
export const isTableLikeView = (type: string | undefined | null) => type === "table" || type === "list";
