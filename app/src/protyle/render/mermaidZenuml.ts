export const isZenumlDiagram = (content?: string | null) => /^\s*zenuml/.test(content || "");
