import { addScript } from "../util/addScript";
import { addStyle } from "../util/addStyle";
import { Constants } from "../../constants";
import { hasNextSibling, hasPreviousSibling } from "../wysiwyg/getBlock";
import { hasClosestBlock } from "../util/hasClosest";
import { looseJsonParse } from "../../util/functions";

const cache = new Map<string, string>();

export const mathRender = (
  element: Element,
  cdn = Constants.PROTYLE_CDN,
  maxWidth = false
) => {
  let mathElements: Element[] = [];
  if (element.getAttribute("data-subtype") === "math") {
    // 编辑器内代码块编辑渲染
    mathElements = [element];
  } else {
    mathElements = Array.from(
      element.querySelectorAll('[data-subtype="math"]')
    );
  }
  if (mathElements.length === 0) {
    return;
  }
  console.time("Test Code");
  mathElements.forEach(async (mathElement: HTMLElement, index: number) => {
    if (mathElement.getAttribute("data-render") === "true") {
      return;
    }

    mathElement.setAttribute("data-render", "true");
    let renderElement = mathElement;

    // 如果是 DIV 标签，渲染的目标是其第一个子元素
    if (mathElement.tagName === "DIV") {
      renderElement = mathElement.firstElementChild as HTMLElement;
    }

    try {
      // 获取数学公式的内容
      const mathContent = mathElement.getAttribute("data-content") || "";

      // if (cache.has(mathContent)) {
      //     return Promise.resolve(cache.get(mathContent)!); // 使用缓存结果
      //   }
      // 如果缓存中已经有该公式的结果，直接返回
      console.time(`render${index}`);
      let svg = "";
      if (cache.has(mathContent)) {
        console.log("use cache")
        svg = cache.get(mathContent)!
      } else {
        const typst_content = `
        #set page(width:auto,height:auto,margin:1mm, background:none)
        #set text(size:12pt)
        \$
        ${mathContent}
        \$`;
        
        // 调用 Typst 渲染 API 获取 SVG
        svg = await fetchTypstSvg(typst_content, index);
        cache.set(mathContent, svg);
      }
      console.timeEnd(`render${index}`);
      // cache.set(mathContent, svg); // 缓存结果
      // 替换渲染元素内容为 SVG
      console.time(`render2-${index}`);
      renderElement.innerHTML = svg;
      renderElement.classList.remove("ft__error");

      // 如果是块级数学公式
      if (mathElement.tagName === "DIV") {
        console.log("set block element  0");
        renderElement.firstElementChild.setAttribute(
          "contenteditable",
          "false"
        );

        // 插入占位符，防止光标移动问题
        if (renderElement.childElementCount < 2) {
          renderElement.insertAdjacentHTML(
            "beforeend",
            `<span style="position: absolute;right: 0;top: 0;">${Constants.ZWSP}</span>`
          );
        }
      } else {
        // 行内公式的样式调整
        const blockElement = hasClosestBlock(mathElement);
        console.log("set block element 11");
        mathElement.style.display = "inline-block";
        if (
          blockElement &&
          mathElement.getBoundingClientRect().width > blockElement.clientWidth
        ) {
          console.log("set block element");
          mathElement.style.maxWidth = "100%";
          mathElement.style.overflowX = "auto";
          mathElement.style.overflowY = "hidden";
          mathElement.style.display = "inline-block";
        } else {
          mathElement.style.maxWidth = "";
          mathElement.style.overflowX = "";
          mathElement.style.overflowY = "";
          mathElement.style.display = "";
        }
      }
      console.timeEnd(`render2-${index}`);
    } catch (e) {
      // 处理渲染错误
      renderElement.innerHTML = e.message;
      renderElement.classList.add("ft__error");
    }
  });
  console.timeEnd("Test Code");
  /**
   * 调用 Typst 渲染 HTTP API 获取 SVG
   * @param mathContent 数学公式文本
   * @returns 渲染的 SVG 字符串
   */
  async function fetchTypstSvg(
    mathContent: string,
    index: number
  ): Promise<string> {
    try {
      console.time(`network-${index}`);
      const response = await fetch("http://127.0.0.1:19966/typst_render", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: mathContent,
          config: "",
        }),
      });
      console.timeEnd(`network-${index}`);
      if (!response.ok) {
        throw new Error(`Typst API Error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.svg || ""; // 假设返回数据中包含 `svg` 字段
    } catch (error) {
      console.error("Failed to fetch SVG from Typst API:", error);
      throw new Error("Failed to render math formula with Typst");
    }
  }
};
