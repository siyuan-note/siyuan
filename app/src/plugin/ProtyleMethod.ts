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
import {tabsRender} from "../protyle/render/tabsRender";

export class ProtyleMethod {
    // 调用时再读取渲染函数，避免导出入口的循环依赖提前访问未初始化的绑定。
    public static tabsRender = (...args: Parameters<typeof tabsRender>) => tabsRender(...args);
    /** 对 graphviz 进行渲染 */
    public static graphvizRender = (...args: Parameters<typeof graphvizRender>) => graphvizRender(...args);
    /** 为 element 中的代码块进行高亮渲染 */
    public static highlightRender = (...args: Parameters<typeof highlightRender>) => highlightRender(...args);
    /** 对数学公式进行渲染 */
    public static mathRender = (...args: Parameters<typeof mathRender>) => mathRender(...args);
    /** 流程图/时序图/甘特图渲染 */
    public static mermaidRender = (...args: Parameters<typeof mermaidRender>) => mermaidRender(...args);
    /** flowchart.js 渲染 */
    public static flowchartRender = (...args: Parameters<typeof flowchartRender>) => flowchartRender(...args);
    /** 图表渲染 */
    public static chartRender = (...args: Parameters<typeof chartRender>) => chartRender(...args);
    /** 五线谱渲染 */
    public static abcRender = (...args: Parameters<typeof abcRender>) => abcRender(...args);
    /** 脑图渲染 */
    public static mindmapRender = (...args: Parameters<typeof mindmapRender>) => mindmapRender(...args);
    /** UML 渲染 */
    public static plantumlRender = (...args: Parameters<typeof plantumlRender>) => plantumlRender(...args);
    public static avRender = (...args: Parameters<typeof avRender>) => avRender(...args);
    public static htmlRender = (...args: Parameters<typeof htmlRender>) => htmlRender(...args);
}
