import { graphvizRender } from "../protyle/render/graphvizRender";
import { highlightRender } from "../protyle/render/highlightRender";
import { mathRender } from "../protyle/render/mathRender";
import { mermaidRender } from "../protyle/render/mermaidRender";
import { flowchartRender } from "../protyle/render/flowchartRender";
import { chartRender } from "../protyle/render/chartRender";
import { abcRender } from "../protyle/render/abcRender";
import { htmlRender } from "../protyle/render/htmlRender";
import { mindmapRender } from "../protyle/render/mindmapRender";
import { plantumlRender } from "../protyle/render/plantumlRender";
import { avRender } from "../protyle/render/av/render";

export class ProtyleMethod {
    /** 对 graphviz 进行渲染 */
    public static graphvizRender = graphvizRender;
    /** 为 element 中的代码块进行高亮渲染 */
    public static highlightRender = highlightRender;
    /** 对数学公式进行渲染 */
    public static mathRender = mathRender;
    /** 流程图/时序图/甘特图渲染 */
    public static mermaidRender = mermaidRender;
    /** flowchart.js 渲染 */
    public static flowchartRender = flowchartRender;
    /** 图表渲染 */
    public static chartRender = chartRender;
    /** 五线谱渲染 */
    public static abcRender = abcRender;
    /** 脑图渲染 */
    public static mindmapRender = mindmapRender;
    /** UML 渲染 */
    public static plantumlRender = plantumlRender;
    public static avRender = avRender;
    public static htmlRender = htmlRender;
}
