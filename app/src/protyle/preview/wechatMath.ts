import {Constants} from "../../constants";
import {addScriptSync} from "../util/addScript";

export const renderWechatMath = async (root: HTMLElement) => {
    const mathElements = root.querySelectorAll<HTMLElement>('[data-subtype="math"]');
    if (mathElements.length === 0) {
        return;
    }
    const mathJaxPath = `${Constants.PROTYLE_CDN}/js/mathjax`;
    if (typeof window.MathJax === "undefined") {
        window.MathJax = {
            loader: {
                paths: {
                    mathjax: mathJaxPath,
                    fonts: `${mathJaxPath}/output/fonts`,
                },
            },
            output: {
                font: "mathjax-tex",
                fontPath: `${mathJaxPath}/output/fonts/%%FONT%%`,
                linebreaks: {
                    inline: false,
                },
            },
            svg: {
                fontCache: "none",
            },
            startup: {
                typeset: false,
            },
            options: {
                enableMenu: false,
                enableEnrichment: false,
                enableSpeech: false,
                enableBraille: false,
                enableExplorer: false,
                menuOptions: {
                    settings: {
                        enrich: false,
                        speech: false,
                        braille: false,
                    },
                },
            },
        };
    }
    await addScriptSync(`${mathJaxPath}/tex-svg-nofont.js?v=4.1.3`, "protyleMathJaxScript");
    await window.MathJax.startup?.promise;
    if (!window.MathJax.tex2svgPromise) {
        throw new Error("MathJax SVG renderer is unavailable");
    }
    // 公式和扩展字体按需异步加载，SVG 使用独立路径以保留公众号中的排版。
    for (const mathElement of mathElements) {
        const isBlock = mathElement.tagName === "DIV";
        const node = await window.MathJax.tex2svgPromise(
            Lute.UnEscapeHTMLStr(mathElement.getAttribute("data-content")).trim(),
            {display: isBlock});
        node.querySelector("mjx-assistive-mml")?.remove();
        if (isBlock) {
            // 原生容器和公式容器均保留居中样式，粘贴后无需依赖 MathJax 样式表。
            mathElement.style.textAlign = "center";
            node.style.display = "block";
            node.style.textAlign = "center";
        }
        mathElement.innerHTML = node.outerHTML;
    }
};
