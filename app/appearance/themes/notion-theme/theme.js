window.theme = {};

/**
 * 加载样式文件
 * @params {string} href 样式地址
 * @params {string} id 样式 ID
 */
window.theme.loadStyle = function (href, id = null) {
    let style = document.createElement('link');
    if (id) style.id = id;
    style.type = 'text/css';
    style.rel = 'stylesheet';
    style.href = href;
    document.head.appendChild(style);
}

/**
 * 更新样式文件
 * @params {string} id 样式文件 ID
 * @params {string} href 样式文件地址
 */
window.theme.updateStyle = function (id, href) {
    let style = document.getElementById(id);
    if (style) {
        style.setAttribute('href', href);
    }
    else {
        window.theme.loadStyle(href, id);
    }
}

window.theme.ID_COLOR_STYLE = 'theme-color-style';

/**
 * 获取主题模式
 * @return {string} light 或 dark
 */
window.theme.themeMode = (() => {
    /* 根据浏览器主题判断颜色模式 */
    // switch (true) {
    //     case window.matchMedia('(prefers-color-scheme: light)').matches:
    //         return 'light';
    //     case window.matchMedia('(prefers-color-scheme: dark)').matches:
    //         return 'dark';
    //     default:
    //         return null;
    // }
    /* 根据配置选项判断主题 */
    switch (window.siyuan.config.appearance.mode) {
        case 0:
            return 'light';
        case 1:
            return 'dark';
        default:
            return null;
    }
})();


/**
 * 更换主题模式
 * @params {string} lightStyle 浅色主题配置文件路径
 * @params {string} darkStyle 深色主题配置文件路径
 */
window.theme.changeThemeMode = function (
    lightStyle,
    darkStyle,
) {
    let href_color = null;
    switch (window.theme.themeMode) {
        case 'light':
            href_color = lightStyle;
            break;
        case 'dark':
        default:
            href_color = darkStyle;
            break;
    }
    window.theme.updateStyle(window.theme.ID_COLOR_STYLE, href_color);
}


/* 根据当前主题模式加载样式配置文件 */
window.theme.changeThemeMode(
    `/appearance/themes/notion-theme/style/topbar/notion-light.css`,
    `/appearance/themes/notion-theme/style/topbar/notion-dark-mode.css`,
);





/*----------------------------------创建notion主题工具栏区域----------------------------------
function createnotionToolbar() {
    var siYuanToolbar = getSiYuanToolbar();

    var notionToolbar = getnotionToolbar();
    var windowControls = document.getElementById("windowControls");

    if (notionToolbar) siYuanToolbar.removeChild(notionToolbar);
    notionToolbar = insertCreateBefore(windowControls, "div", "notionToolbar");
    notionToolbar.style.marginRight = "14px";
    notionToolbar.style.marginLeft = "11px";
}*/

  /****************************思源API操作**************************/ 
  async function 设置思源块属性(内容块id, 属性对象) {
    let url = '/api/attr/setBlockAttrs'
    return 解析响应体(向思源请求数据(url, {
        id: 内容块id,
        attrs: 属性对象,
    }))
  }
  async function 向思源请求数据(url, data) {
    let resData = null
    await fetch(url, {
        body: JSON.stringify(data),
        method: 'POST',
        headers: {
            Authorization: `Token ''`,
        }
    }).then(function (response) { resData = response.json() })
    return resData
  }
  async function 解析响应体(response) {
    let r = await response
    return r.code === 0 ? r.data : null
  }
  

  /****UI****/
  function ViewSelect(selectid,selecttype){
  let button = document.createElement("button")
  button.id="viewselect"
  button.className="b3-menu__item"
  button.innerHTML='<svg class="b3-menu__icon" style="null"><use xlink:href="#iconGlobalGraph"></use></svg><span class="b3-menu__label" style="">视图选择</span><svg class="b3-menu__icon b3-menu__icon--arrow" style="null"><use xlink:href="#iconRight"></use></svg></button>'
  button.appendChild(SubMenu(selectid,selecttype))
  return button
}

function SubMenu(selectid,selecttype,className = 'b3-menu__submenu') {
  let node = document.createElement('div');
  node.className = className;
  if(selecttype=="NodeList"){
    node.appendChild(GraphView(selectid))
    node.appendChild(TableView(selectid))
	node.appendChild(kanbanView(selectid))
    node.appendChild(DefaultView(selectid))
  }
  if(selecttype=="NodeTable"){
    node.appendChild(FixWidth(selectid))
    node.appendChild(AutoWidth(selectid))
	node.appendChild(vHeader(selectid))
	node.appendChild(Removeth(selectid))
	node.appendChild(Defaultth(selectid))
  }
  if(selecttype=="NodeBlockquote"){
    node.appendChild(Error(selectid))
	node.appendChild(Warn(selectid))
	node.appendChild(Bug(selectid))
	node.appendChild(Check(selectid))
	node.appendChild(Light(selectid))
	node.appendChild(Question(selectid))
	node.appendChild(Wrong(selectid))
	node.appendChild(Info(selectid))
	node.appendChild(Pen(selectid))
	node.appendChild(Note(selectid))
	node.appendChild(Bell(selectid))
    node.appendChild(Defaultbq(selectid))	
  }
return node;
}

function GraphView(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","f")
  button.setAttribute("custom-attr-value","dt")

  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#iconFiles"></use></svg><span class="b3-menu__label">转换为导图</span>`
  button.onclick=ViewMonitor
  return button
}
function TableView(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","f")
  button.setAttribute("custom-attr-value","bg")

  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#iconTable"></use></svg><span class="b3-menu__label">转换为表格</span>`
  button.onclick=ViewMonitor
  return button
}
function kanbanView(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","f")
  button.setAttribute("custom-attr-value","kb")

  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#iconMenu"></use></svg><span class="b3-menu__label">转换为看板</span>`
  button.onclick=ViewMonitor
  return button
}
function DefaultView(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.onclick=ViewMonitor
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","f")
  button.setAttribute("custom-attr-value",'')

  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#iconList"></use></svg><span class="b3-menu__label">恢复为列表</span>`
  return button
}
function FixWidth(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.onclick=ViewMonitor
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","f")
  button.setAttribute("custom-attr-value","")

  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#iconTable"></use></svg><span class="b3-menu__label">页面宽度</span>`
  return button
}
function AutoWidth(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","f")
  button.setAttribute("custom-attr-value","auto")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#iconTable"></use></svg><span class="b3-menu__label">自动宽度</span>`
  button.onclick=ViewMonitor
  return button
}
function vHeader(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.onclick=ViewMonitor
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","t")
  button.setAttribute("custom-attr-value","vbiaotou")

  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#iconTable"></use></svg><span class="b3-menu__label">竖表头样式</span>`
  return button
}
function Removeth(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.onclick=ViewMonitor
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","t")
  button.setAttribute("custom-attr-value","biaotou")

  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#iconTable"></use></svg><span class="b3-menu__label">取消表头样式</span>`
  return button
}
function Defaultth(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","t")
  button.setAttribute("custom-attr-value","")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#iconTable"></use></svg><span class="b3-menu__label">默认表头样式</span>`
  button.onclick=ViewMonitor
  return button
}
function Error(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","error")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#icon-1f6ab"></use></svg><span class="b3-menu__label">禁止</span>`
  button.onclick=ViewMonitor
  return button
}
function Warn(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","warn")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#icon-26a0"></use></svg><span class="b3-menu__label">警告</span>`
  button.onclick=ViewMonitor
  return button
}
function Bug(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","bug")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#icon-1f41b"></use></svg><span class="b3-menu__label">bug</span>`
  button.onclick=ViewMonitor
  return button
}
function Check(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","check")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#icon-2705"></use></svg><span class="b3-menu__label">正确</span>`
  button.onclick=ViewMonitor
  return button
}
function Light(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","light")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#icon-1f4a1"></use></svg><span class="b3-menu__label">灵感</span>`
  button.onclick=ViewMonitor
  return button
}
function Question(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","question")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#icon-2753"></use></svg><span class="b3-menu__label">问题</span>`
  button.onclick=ViewMonitor
  return button
}
function Wrong(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","wrong")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#icon-274c"></use></svg><span class="b3-menu__label">错误</span>`
  button.onclick=ViewMonitor
  return button
}
function Info(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","info")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#icon-2139"></use></svg><span class="b3-menu__label">信息</span>`
  button.onclick=ViewMonitor
  return button
}
function Pen(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","pen")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#icon-1f58b"></use></svg><span class="b3-menu__label">记录</span>`
  button.onclick=ViewMonitor
  return button
}
function Note(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","note")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#icon-1f4d3"></use></svg><span class="b3-menu__label">汇总</span>`
  button.onclick=ViewMonitor
  return button
}
function Bell(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","bell")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#icon-1f514"></use></svg><span class="b3-menu__label">提醒</span>`
  button.onclick=ViewMonitor
  return button
}
function Defaultbq(selectid){
  let button = document.createElement("button")
  button.className="b3-menu__item"
  button.setAttribute("data-node-id",selectid)
  button.setAttribute("custom-attr-name","b")
  button.setAttribute("custom-attr-value","")
  button.innerHTML=`<svg class="b3-menu__icon" style=""><use xlink:href="#iconRefresh"></use></svg><span class="b3-menu__label">恢复默认样式</span>`
  button.onclick=ViewMonitor
  return button
}
function MenuSeparator(className = 'b3-menu__separator') {
  let node = document.createElement('button');
  node.className = className;
  return node;
}

/* 操作 */ 

/**
 * 获得所选择的块对应的块 ID
 * @returns {string} 块 ID
 * @returns {
 *     id: string, // 块 ID
 *     type: string, // 块类型
 *     subtype: string, // 块子类型(若没有则为 null)
 * }
 * @returns {null} 没有找到块 ID */
function getBlockSelected() {
    let node_list = document.querySelectorAll('.protyle-wysiwyg--select');
    if (node_list.length === 1 && node_list[0].dataset.nodeId != null) return {
        id: node_list[0].dataset.nodeId,
        type: node_list[0].dataset.type,
        subtype: node_list[0].dataset.subtype,
    };
    return null;
}

function ClickMonitor () {
  window.addEventListener('mouseup', MenuShow)
}

function MenuShow() {
  setTimeout(() => {
    let selectinfo = getBlockSelected()
      if(selectinfo){
      let selecttype = selectinfo.type
      let selectid = selectinfo.id
      if(selecttype=="NodeList"||selecttype=="NodeTable"||selecttype=="NodeBlockquote"){
        setTimeout(()=>InsertMenuItem(selectid,selecttype), 0)
      }
    }
  }, 0);
}


function InsertMenuItem(selectid,selecttype){
  let commonMenu = document.getElementById("commonMenu")
  let  readonly = commonMenu.querySelector(".b3-menu__item--readonly")
  let  selectview = commonMenu.querySelector('[id="viewselect"]')
  if(readonly){
    if(!selectview){
    commonMenu.insertBefore(ViewSelect(selectid,selecttype),readonly)
    commonMenu.insertBefore(MenuSeparator(),readonly)
    }
  }
}

function ViewMonitor(event){
  let id = event.currentTarget.getAttribute("data-node-id")
  let attrName = 'custom-'+event.currentTarget.getAttribute("custom-attr-name")
  let attrValue = event.currentTarget.getAttribute("custom-attr-value")
  let blocks = document.querySelectorAll(`.protyle-wysiwyg [data-node-id="${id}"]`)
  if(blocks){
    blocks.forEach(block=>block.setAttribute(attrName,attrValue))
  }
  let attrs={}
    attrs[attrName] =attrValue
  设置思源块属性(id,attrs)
}

setTimeout(()=>ClickMonitor(),1000)













/**----------------------------------为文档标题创建动态下划线---------------------------------- */

function rundynamicUnderline() {
    setInterval(dynamicUnderline, 500);
}

function dynamicUnderline() {
    var AllDocumentTitleElement = getAllDocumentTitleElement();

    for (let index = 0; index < AllDocumentTitleElement.length; index++) {
        const element = AllDocumentTitleElement[index];

        var line = createLine(element);
        var txt = getTileTxt(element);
        var maxWidth = element.offsetWidth;

        var Style = getComputedStyle(element, null);
        var font = Style.font;
        var width = getTextWidth(txt, font) + 58;

        if (width < 288) {
            width = 288;
        }

        if (width > maxWidth) {
            width = maxWidth;
        }

        line.style.width = width + "px";
    }
}


function createLine(TitleElement) {

    var item = TitleElement.parentElement.children;

    for (let index = 0; index < item.length; index++) {
        const element = item[index];

        if (element.getAttribute("Line") != null) {
            return element;
        }
    }

    var line = insertCreateAfter(TitleElement, "div");
    line.setAttribute("Line", "true");
    line.style.height = "1px";
    line.style.marginTop = "-2px";
    line.style.marginBottom = "7px";
    line.style.backgroundColor = "var(--b3-border-color)";
    line.style.transition = "all 400ms linear";
    return line;
}


function getTileTxt(TitleElement) {
    return TitleElement.innerText;
}






/**----------------------------------为打开文档的标题下显示文档创建日期----------------------------------*/

function showDocumentCreationDate() {

    setInterval(DocumentCreationDate, 300);
}


function DocumentCreationDate() {

    var openDoc = document.querySelectorAll(".layout-tab-container>.fn__flex-1.protyle:not(.fn__none):not([CreatTimeOK])");
    var allDocumentTitleElement = [];
    for (let index = 0; index < openDoc.length; index++) {
        const element = openDoc[index];
        element.setAttribute("CreatTimeOK", true);
        allDocumentTitleElement.push(element.children[1].children[1].children[1]);
    }

    for (let index = 0; index < allDocumentTitleElement.length; index++) {
        const element = allDocumentTitleElement[index];
        var documentCreatTimeElement = creatTimeSpanElement(element.parentElement);
        documentCreatTimeElement.innerText = "获取文档创建日期中……";
        tilteWhlie(element, documentCreatTimeElement);
    }
}

function tilteWhlie(element, documentCreatTimeElement) {
    var setID = setInterval(() => {
        var time = getDocumentTime(element);
        if (time != "") {
            documentCreatTimeElement.innerText = time;
            clearInterval(setID);
        };
    }, 3000);
}

/**获取所有打开文档的标题元素 */
function getAllDocumentTitleElement() {
    var openDoc = document.querySelectorAll(".layout-tab-container>.fn__flex-1.protyle:not(.fn__none)");
    var arr = [];
    for (let index = 0; index < openDoc.length; index++) {
        const element = openDoc[index];
        arr.push(element.children[1].children[1].children[1]);
    }
    return arr;
}

/**为文档标题元素下创建时间容器元素 */
function creatTimeSpanElement(tilteElement) {
    var item = tilteElement.children;
    for (let index = 0; index < item.length; index++) {
        const element = item[index];
        if (element.getAttribute("documentCreatTimeElement") != null) return element;
    }
    var documentCreatTimeElement = addinsertCreateElement(tilteElement, "span");
    documentCreatTimeElement.setAttribute("documentCreatTimeElement", "true");
    documentCreatTimeElement.style.display = "block";
    documentCreatTimeElement.style.marginLeft = "7px";
    documentCreatTimeElement.style.marginBottom = "0px";
    documentCreatTimeElement.style.fontSize = "61%";
    documentCreatTimeElement.style.color = "#767676";
    return documentCreatTimeElement;
}


/**获得这个文档的创建时间 */
function getDocumentTime(tilteElement) {
    try {
        var tS = tilteElement.parentElement.parentElement.previousElementSibling.firstElementChild.firstElementChild.getAttribute("data-node-id");
        if (tS == null) return "";
        var year = tS.substring(0, 4);
        var moon = tS.substring(4, 6);
        var day = tS.substring(6, 8);
        var hour = tS.substring(8, 10);
        var minute = tS.substring(10, 12);
        var second = tS.substring(12, 14);
        return year + "-" + moon + "-" + day + "  " + hour + ":" + minute + ":" + second;
    } catch (error) {
        return "";
    }
}


/**---------------------------------------------------------主题-------------------------------------------------------------- */

function themeButton() {
    /*notionThemeToolbarAddButton(
        "buttonnotion-dark",
        "toolbar__item b3-tooltips b3-tooltips__se",
		"notion-dark主题",
        "/appearance/themes/notion-theme/img/moon2.svg",
        "/appearance/themes/notion-theme/img/moon.svg",
        () => {
            loadStyle("/appearance/themes/notion-theme/style/topbar/notion-dark.css", "notion-dark主题").setAttribute("topicfilter", "buttonnotion-dark");
            qucuFiiter();
        },
        () => {
            document.getElementById("notion-dark主题").remove();
        },
        true
    );*/

    notionThemeToolbarAddButton(
        "buttonsalt",
        "toolbar__item b3-tooltips b3-tooltips__se",
		"salt主题",
        "/appearance/themes/notion-theme/img/salt2.svg",
        "/appearance/themes/notion-theme/img/salt.svg",
        () => {
            loadStyle("/appearance/themes/notion-theme/style/topbar/salt.css", "salt主题").setAttribute("topicfilter", "buttonsalt");
            qucuFiiter();
        },
        () => {
            document.getElementById("salt主题").remove();
        },
        true
    );
}


/**---------------------------------------------------------顶栏-------------------------------------------------------------- */

function topbarfixedButton() {
    notionThemeToolbarAddButton(
        "topBar",
        "toolbar__item b3-tooltips b3-tooltips__se",
		"顶栏隐藏",
        "/appearance/themes/notion-theme/img/topbar2.svg",
        "/appearance/themes/notion-theme/img/topbar.svg",
        () => {
            loadStyle("/appearance/themes/notion-theme/style/topbar/top-fixed.css", "topbar隐藏").setAttribute("topBarcss", "topbar隐藏");
        },
        () => {
            document.getElementById("topbar隐藏").remove();
        },
        true
    );
}

/**---------------------------------------------------------左侧面板悬浮-------------------------------------------------------------- */

function leftColumnButton() {
    notionThemeToolbarAddButton(
        "leftColumn",
        "toolbar__item b3-tooltips b3-tooltips__se",
		"左侧面板悬浮",
        "/appearance/themes/notion-theme/img/leftcolumn2.svg",
        "/appearance/themes/notion-theme/img/leftcolumn.svg",
        () => {
            loadStyle("/appearance/themes/notion-theme/style/topbar/leftcolumn.css", "leftColumn悬浮").setAttribute("topBarcss", "leftColumn悬浮");
        },
        () => {
            document.getElementById("leftColumn悬浮").remove();
        },
        true
    );
}

/**---------------------------------------------------------右侧面板悬浮--------------------------------------------------------------*/

function rightColumnButton() {
    notionThemeToolbarAddButton(
        "rightColumn",
        "toolbar__item b3-tooltips b3-tooltips__se",
		"右侧面板悬浮",
        "/appearance/themes/notion-theme/img/rightcolumn2.svg",
        "/appearance/themes/notion-theme/img/rightcolumn.svg",
        () => {
            loadStyle("/appearance/themes/notion-theme/style/topbar/rightcolumn.css", "rightColumn悬浮").setAttribute("topBarcss", "rightColumn悬浮");
        },
        () => {
            document.getElementById("rightColumn悬浮").remove();
        },
        true
    );
} 


 //去除主题所有滤镜还原按钮状态
function qucuFiiter() {
    var Topicfilters = document.querySelectorAll("head [topicfilter]");
    Topicfilters.forEach(element => {
        var offNo = localStorage.getItem(element.getAttribute("topicfilter"));
        if (offNo == "1") {
            document.getElementById(element.getAttribute("topicfilter")).click();
            element.remove();
        }
    });
}

/**----------------------------------自动展开悬浮窗折叠列表,展开搜索条目折叠列表,聚焦单独列表-----体验优化----------------------------------*/

function autoOpenList() {

    setInterval(() => {
        //找到所有的悬浮窗
        var Preview = document.querySelectorAll("[data-oid]");

        //如果发现悬浮窗内首行是折叠列表就展开并打上标记
        if (Preview.length != 0) {
            for (let index = 0; index < Preview.length; index++) {
                const element = Preview[index];
                var item = element.children[1].children;

                for (let index = 0; index < item.length; index++) {
                    var obj = item[index].children[1]
                    if (obj == null) continue;
                    const element = obj.children[0].children[0];
                    if (element == null) continue;
                    if (element.className != "li") continue;//判断是否是列表
                    if (element.getAttribute("foldTag") != null) continue;//判断是否存在标记
                    if (element.getAttribute("foid") == 0) continue;//判断是折叠

                    element.setAttribute("fold", 0);
                    element.setAttribute("foldTag", true);
                }
            }
        }

        var searchPreview = document.querySelector("#searchPreview [data-doc-type='NodeListItem'].protyle-wysiwyg.protyle-wysiwyg--attr>div:nth-child(1)");
        if (searchPreview != null && searchPreview.getAttribute("data-type") == "NodeListItem" && searchPreview.getAttribute("fold") == 1) {
            if (searchPreview.getAttribute("foldTag") != null) return;//判断是否存在标记
            searchPreview.setAttribute("fold", 0);
            searchPreview.setAttribute("foldTag", true);
        }

        var contentLIst = document.querySelectorAll(".layout-tab-container>.fn__flex-1.protyle:not(.fn__none) [data-doc-type='NodeListItem'].protyle-wysiwyg.protyle-wysiwyg--attr>div:nth-child(1)");
        for (let index = 0; index < contentLIst.length; index++) {
            const element = contentLIst[index];
            if (element != null && element.getAttribute("data-type") == "NodeListItem" && element.getAttribute("fold") == 1) {
                if (element.getAttribute("foldTag") != null) return;//判断是否存在标记
                element.setAttribute("fold", 0);
                element.setAttribute("foldTag", true);
            }
        }

    }, 500)
}


/**----------------------------------列表折叠内容预览查看---------------------------------- */
function collapsedListPreview() {
    BodyEventRunFun("mouseover", collapsedListPreviewEvent, 3000)
}



function collapsedListPreviewEvent() {
    var _turn = [...document.querySelectorAll(".layout-tab-container>.fn__flex-1.protyle:not(.fn__none) [data-node-id].li[fold='1']"),
    ...document.querySelectorAll("[data-oid] [data-node-id].li[fold='1']"),
    ...document.querySelectorAll("#searchPreview [data-node-id].li[fold='1']")];//查询页面所有的折叠列表
    var turn = [];
    for (let index = 0; index < _turn.length; index++) {//找到列表第一列表项（父项）
        const element = _turn[index].children[1];
        var item = element.className;
        if (item == "p" || item == "h1" || item == "h2" || item == "h3" || item == "h4" || item == "h5" || item == "h6") {
            turn.push(element.children[0])
        }
    }

    //检查注册事件的折叠列表是否恢复未折叠状态,是清除事件和去除标志属性
    var ListPreview = [...document.querySelectorAll(".layout-tab-container>.fn__flex-1.protyle:not(.fn__none) [ListPreview]"),
    ...document.querySelectorAll("[data-oid] [ListPreview]"),
    ...document.querySelectorAll("#searchPreview [ListPreview]")];
    for (let index = 0; index < ListPreview.length; index++) {
        const element = ListPreview[index];
        var fold = element.parentElement.getAttribute("fold")

        if (fold == null || fold == 0) {
            element.removeAttribute("ListPreview");
            var item = element.children[0];
            myRemoveEvent(item, "mouseenter", LIstIn);//解绑鼠标进入
            myRemoveEvent(item.parentElement.parentElement, "mouseleave", LIstout);//解绑鼠标离开

            items = Array.from(item.parentElement.parentElement.children);
            for (let index = 0; index < items.length; index++) {
                const element = items[index];
                if (element.getAttribute("triggerBlock") != null) {
                    element.remove();
                }
            }
        }
    }

    for (let index = 0; index < turn.length; index++) {//重新注册、筛选未注册鼠标事件折叠列表
        const element = turn[index];
        var elementPP = element.parentElement.parentElement;

        if (element.parentElement.getAttribute("ListPreview") != null) {
            myRemoveEvent(element, "mouseenter", LIstIn);//解绑鼠标进入
            myRemoveEvent(elementPP, "mouseleave", LIstout);//解绑鼠标离开

            AddEvent(element, "mouseenter", LIstIn);//注册鼠标进入
            AddEvent(elementPP, "mouseleave", LIstout);//注册鼠标离开
        } else {
            element.parentElement.setAttribute("ListPreview", true);
            AddEvent(element, "mouseenter", LIstIn);//注册鼠标进入
            AddEvent(elementPP, "mouseleave", LIstout);//注册鼠标离开
        }
    }
}

var flag22 = false;

function LIstout(e) {
    items = Array.from(e.target.children);
    flag22 = false;
    for (let index = 0; index < items.length; index++) {
        const element = items[index];
        if (element.getAttribute("triggerBlock") != null) {
            element.remove();
        }
    }
}

function LIstIns(e) {

    var id = setInterval(() => {

        if (!flag22) {
            clearInterval(id);
            return;
        }

        var obj = e.target;

        var timeDiv = addinsertCreateElement(obj, "div");
        timeDiv.style.display = "inline-block";
        timeDiv.style.width = "0px";
        timeDiv.style.height = "16px";

        var X = timeDiv.offsetLeft;
        var Y = timeDiv.offsetTop;
        timeDiv.remove();

        var item = obj.parentElement.parentElement;
        if (item == null) return;
        items = item.children
        var itemobj = items[items.length - 1];
        if (itemobj != null && itemobj.getAttribute("triggerBlock") != null) {

            var items1 = items[items.length - 1];
            items1.style.top = (Y + 35) + "px";
            items1.style.left = (obj.offsetLeft + 35) + "px";
            var items2 = items[items.length - 2];
            items2.style.top = (Y + 2) + "px";
            items2.style.left = (X + 45) + "px";
            return;
        }

    }, 500);
}

function LIstIn(e) {
    flag22 = true;

    var obj = e.target;
    var timeDiv = addinsertCreateElement(obj, "div");
    timeDiv.style.display = "inline-block";
    timeDiv.style.width = "0px";
    timeDiv.style.height = "16px";

    var X = timeDiv.offsetLeft;
    var Y = timeDiv.offsetTop;
    timeDiv.remove();

    var f = obj.parentElement.parentElement;
    if (!f) return;
    items = f.children;

    var itemobj = items[items.length - 1];
    if (itemobj != null && itemobj.getAttribute("triggerBlock") != null) return;

    var triggerBlock1 = CreatetriggerBlock(e)//创建触发块1
    //设置触发块样式，将触发块显示在〔 ··· 〕第二行位置
    triggerBlock1.style.top = (Y + 35) + "px";
    triggerBlock1.style.left = (obj.offsetLeft + 35) + "px";
    AddEvent(triggerBlock1, "mouseenter", () => {
        //一秒延时后搜索打开的悬浮窗，将悬浮窗中的列表展开,重复检查三次
        setTimeout(Suspended, 1000)
    });//注册鼠标进入

    var triggerBlock2 = CreatetriggerBlock(e)//创建触发块2
    //设置触发块样式，将触发块显示在〔 ··· 〕位置
    triggerBlock2.style.top = (Y + 2) + "px";
    triggerBlock2.style.left = (X + 45) + "px";

    AddEvent(triggerBlock2, "mouseenter", () => {
        //一秒延时后搜索打开的悬浮窗，将悬浮窗中的列表展开,重复检查三次
        setTimeout(Suspended, 1000)
    });//注册鼠标进入

    //一秒延时后搜索打开的悬浮窗，将悬浮窗中的列表展开,重复检查三次
    var previewID = obj.parentElement.parentElement.getAttribute("data-node-id");
    var jisu = 0;
    function Suspended() {
        jisu++;
        var y = false;
        if (jisu == 3) return
        var Sd = document.querySelectorAll("[data-oid]");
        if (Sd.length >= 1) { //如果找到那么就将悬浮窗中列表展开
            for (let index = 0; index < Sd.length; index++) {
                const element = Sd[index];
                var item = element.children[1].children[0].children[1].children[0].children[0];
                if (item == null) continue;
                if (item.getAttribute("data-node-id") == previewID) {
                    item.setAttribute("fold", 0);
                    y = true;
                }
            }
        }
        if (!y) { setTimeout(Suspended, 800) }
    }
    LIstIns(e);
}

function CreatetriggerBlock(e) {
    var objParent = e.target.parentElement;
    var triggerBlock = addinsertCreateElement(objParent.parentElement, "div");//创建触发块
    //设置触发块样式，将触发块显示在〔 ··· 〕位置
    triggerBlock.setAttribute("triggerBlock", true);
    triggerBlock.style.position = "absolute";
    triggerBlock.style.width = "20px";
    triggerBlock.style.height = "15px";
    //triggerBlock.style.background="red";
    triggerBlock.style.display = "flex";
    triggerBlock.style.zIndex = "999";
    triggerBlock.style.cursor = "pointer";
    triggerBlock.style.WebkitUserModify = "read-only";
    triggerBlock.setAttribute("contenteditable", "false");
    triggerBlock.innerHTML = "&#8203";

    //获取折叠列表ID,设置悬浮窗
    //protyle-wysiwyg__embed data-id
    var previewID = objParent.parentElement.getAttribute("data-node-id");
    triggerBlock.setAttribute("class", "protyle-attr");
    triggerBlock.style.backgroundColor = "transparent";
    //在触发块内创建思源超链接 
    triggerBlock.innerHTML = "<span data-type='a' class='list-A' data-href=siyuan://blocks/" + previewID + ">####</span>";
    //将这个思源连接样式隐藏
    var a = triggerBlock.children[0];
    a.style.fontSize = "15px";
    a.style.lineHeight = "15px";
    a.style.color = "transparent";
    a.style.textShadow = "none";
    a.style.border = "none";
    return triggerBlock;
}




/**----------------鼠标中键标题、列表文本折叠/展开----------------*/
function collapseExpand_Head_List() {
    var flag45 = false;
    setInterval(() => {

        var NodeHeading = null;
        var NodeListItem = null;

        if (isPhone()) {
            NodeHeading = document.querySelectorAll('#editor [data-type="NodeHeading"]');
            NodeListItem = document.querySelectorAll('#editor [data-type="NodeListItem"].li');
        } else {
            NodeHeading = [...document.querySelectorAll('.layout-tab-container>.fn__flex-1.protyle:not(.fn__none) [data-type="NodeHeading"]'),
            ...document.querySelectorAll('[data-oid] [data-type="NodeHeading"]'),
            ...document.querySelectorAll('#searchPreview [data-type="NodeHeading"]')];


            NodeListItem = [...document.querySelectorAll('.layout-tab-container>.fn__flex-1.protyle:not(.fn__none) [data-type="NodeListItem"].li'),
            ...document.querySelectorAll('[data-oid] [data-type="NodeListItem"].li'),
            ...document.querySelectorAll('#searchPreview [data-type="NodeListItem"].li')];
        }

        var H = [];


        for (let index = 0; index < NodeHeading.length; index++) {
            const element = NodeHeading[index];
            var item = element.parentElement;
            if (item.className != "li") H.push(element);
        }
        for (let index = 0; index < H.length; index++) {
            const element = H[index].children[0];
            myRemoveEvent(element, "mousedown", _collapseExpand_NodeListItem);
            myRemoveEvent(element, "mousedown", _collapseExpand_NodeHeading);
            AddEvent(element, "mousedown", _collapseExpand_NodeHeading)
            AddEvent(element, "mouseup", () => { flag45 = false })
        }


        for (let index = 0; index < NodeListItem.length; index++) {
            const element = NodeListItem[index].children[1].children[0];
            myRemoveEvent(element, "mousedown", _collapseExpand_NodeHeading);
            myRemoveEvent(element, "mousedown", _collapseExpand_NodeListItem);
            AddEvent(element, "mousedown", _collapseExpand_NodeListItem)
            AddEvent(element, "mouseup", () => { flag45 = false })
        }
    }, 3000);



    function _collapseExpand_NodeHeading(e) {
        if (e.button == 2) { fflag45lag = true; return }
        if (flag45 || e.shiftKey || e.altKey || e.button != 1) return;
        e.preventDefault();
        protyle_gutters_click(e.target);
    }

    function _collapseExpand_NodeListItem(e) {
        if (e.button == 2) { flag45 = true; return }
        if (flag45 || e.shiftKey || e.altKey || e.button != 1) return;
        e.preventDefault();
        var element = e.target;
        var i = 0;
        while (element.getAttribute("contenteditable") == null) {
            if (i == 999) return;
            i++;
            element = element.parentElement;
        }
        var elementParentElement = element.parentElement;

        if (elementParentElement.getAttribute("data-type") == "NodeHeading" && elementParentElement.getAttribute("fold") == 1) {
            console.log("1");
            protyle_gutters_click(element);
        } else {
            commonMenu_click(elementParentElement.previousElementSibling);
        }

    }

    function commonMenu_click(element) {

        var elementParentElement = element.parentElement;
        var data_node_id = elementParentElement.getAttribute("data-node-id");
        var elementParentElementParentElement = elementParentElement.parentElement;


        if (elementParentElementParentElement.className == "protyle-wysiwyg protyle-wysiwyg--attr") {
            if (elementParentElementParentElement.children[0].getAttribute("data-node-id") == data_node_id) {
                var i = 0;
                var item2 = elementParentElementParentElement;
                while (item2) {
                    if (i > 99) return;
                    if (item2.getAttribute("data-oid") != null) return;
                    item2 = item2.parentElement;
                    i++;
                }
                elementParentElement.setAttribute("foldTag", true);
            }
        }

        element.click();
        var caidan = (document.getElementById("commonMenu")).children;
        for (let index = 0; index < caidan.length; index++) {
            const element = caidan[index];
            var item = element.children;
            if (item.length != 0 && item[1].innerText == "折叠/展开") element.click();
        }
    }

    function protyle_gutters_click(element) {
        var i = 0;
        while (element.className != "fn__flex-1 protyle" && element.className != "block__edit fn__flex-1 protyle" && element.className != "fn__flex-1 spread-search__preview protyle") {
            if (i == 999) return;
            i++;
            element = element.parentElement;
        }
        var ddddd = element.children;
        for (let index = ddddd.length - 1; index >= 0; index--) {
            const element = ddddd[index];
            if (element.className == "protyle-gutters") {
                var fold = diguiTooONE(element, (v) => { return v.getAttribute("data-type") === "fold"; })
                if (fold != null) fold.click();
                return;
            }
        }
    }
}





/*----------------日历面板----------------*/
function initcalendar() {
  // 把日历图标 放到  搜索图标前面
  var barSearch = document.getElementById("barDailyNote");
  barSearch.insertAdjacentHTML(
    "afterend",
    '<div id="calendar"class="toolbar__item b3-tooltips b3-tooltips__se" aria-label="日历" ></div>'
  );
  let calendarIcon = document.getElementById("calendar");

  // 日历面板，这里是插入挂件
  barSearch.insertAdjacentHTML(
    "afterend",
    ` <div
    data-node-index="1"
    data-type="NodeWidget"
    class="iframe"
    data-subtype="widget"
  >
    <div class="iframe-content">
      <iframe id="calendarPanel" style="visibility:hidden;position: fixed; z-index: 1000; top: 225px; left: 170px;  width: 300px; height: 350px; background-color: var(--b3-theme-background);box-shadow: rgba(15, 15, 15, 0.05) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 3px 6px, rgba(15, 15, 15, 0.2) 0px 9px 24px;border:none; border-radius: 5px; transform: translate(-50%, -50%); overflow: auto;" src="/appearance/themes/notion-theme/calendar" data-src="/appearance/themes/notion-theme/calendar" data-subtype="widget" ></iframe>
    </div>
  </div>`
  );

  let calendarPanel = document.getElementById("calendarPanel");

  calendarIcon.innerHTML = `<svg t="1662957805816" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2374" width="200" height="200"><path d="M797.257 402.286h-570.514v113.371h570.514v-113.371zM910.629 76.8h-58.514v-76.8h-113.371v76.8h-453.486v-76.8h-113.371v76.8h-58.514c-62.171 0-113.371 51.2-113.371 113.371v724.114c0 62.171 51.2 109.714 113.371 109.714h797.257c62.171 0 113.371-47.543 113.371-109.714v-724.114c0-62.171-51.2-113.371-113.371-113.371zM910.629 914.286h-797.257v-625.371h797.257v625.371zM625.371 629.029h-398.629v113.371h398.629v-113.371z"></path></svg>`;

  calendarIcon.addEventListener(
    "click",
    function (e) {
      e.stopPropagation();
      if (calendarPanel.style.visibility === "hidden") {
        calendarPanel.style.visibility = "visible";
      } else {
        calendarPanel.style.visibility = "hidden";
      }
    },
    false
  );
  calendarPanel.addEventListener('click',function(e){e.stopPropagation()},false)

   // 隐藏历史面板
   function hideCalendarPanel() {
    if (calendarPanel.style.visibility === "visible") {
      calendarPanel.style.visibility = "hidden";
    }
  }
  // 点击其他区域时，隐藏日历面板
  window.addEventListener("click", hideCalendarPanel, false);
}







/****************************最近打开文档****************************************** */
//https://ld246.com/article/1662697317986 来自社区分享
function init() {
    // 日期-时间格式化
    Date.prototype.Format = function (fmt) {
      var o = {
        "M+": this.getMonth() + 1, //月份
        "d+": this.getDate(), //日
        "h+": this.getHours(), //小时
        "m+": this.getMinutes(), //分
        "s+": this.getSeconds(), //秒
        "q+": Math.floor((this.getMonth() + 3) / 3), //季度
        S: this.getMilliseconds(), //毫秒
      };
      if (/(y+)/.test(fmt))
        fmt = fmt.replace(
          RegExp.$1,
          (this.getFullYear() + "").substr(4 - RegExp.$1.length)
        );
      for (var k in o)
        if (new RegExp("(" + k + ")").test(fmt))
          fmt = fmt.replace(
            RegExp.$1,
            RegExp.$1.length == 1
              ? o[k]
              : ("00" + o[k]).substr(("" + o[k]).length)
          );
      return fmt;
    };
    // 历史条目保存到该数组
    let historyArr = [];
    if (localStorage.getItem("historyArr")) {
      historyArr = JSON.parse(localStorage.getItem("historyArr"));
    }
    // 新打开页签后更新历史记录
    function update_history_tags(newTag) {
      if (!newTag) return;
      let tag = undefined;
      if (newTag.tagName === "DIV") {
        tag = newTag.querySelector("li[data-type='tab-header']");
      } else if (newTag.tagName === "LI") {
        tag = newTag;
      } else {
        return;
      }
      // 历史记录条目的默认图标
      let historyItemIcon = `<use xlink:href="#icon-1f4c4"></use>`;
      let docIcon = tag.querySelector(".item__icon > svg");
      // 如果设置了其他图标，就换成其他图标
      if (docIcon) {
        historyItemIcon = docIcon.innerHTML;
      }
  
      // 页签标题
      let nodeText = tag.querySelector("span.item__text").innerText;
      // 页签打开的时间
      let timeStamp = tag.getAttribute("data-activetime");
      timeStamp = new Date(parseInt(timeStamp)).Format("yyyy-MM-dd hh:mm:ss");
      let data_id = tag.getAttribute("data-id");
      setTimeout(() => {
        let current_doc = document.querySelector(
          `div.fn__flex-1.protyle[data-id="${data_id}"] >div.protyle-content>div.protyle-background`
        );
        if (current_doc) {
          let doc_link =
            "siyuan://blocks/" + current_doc.getAttribute("data-node-id");
          let newTag = `${timeStamp}--${nodeText}--${doc_link}--${historyItemIcon}`;
          if (!historyArr.includes(newTag)) {
            historyArr.push(newTag);
          }
          //只保留最近200条历史记录
          while (historyArr.length > 200) {
            historyArr.shift();
          }
          localStorage.setItem("historyArr", JSON.stringify(historyArr));
        }
      }, 700);
    }
  
    // 标签页容器ul，观测其子元素的变动
    let tab_containers = document.querySelectorAll(
      "div[data-type='wnd'] > div.fn__flex ul.fn__flex.layout-tab-bar.fn__flex-1"
    );
    const config = { attributes: false, childList: true, subtree: false };
  
    // 新增标签页时，更新历史记录
    const tag_change = function (mutationsList, observer) {
      if (
        mutationsList[0].type === "childList" &&
        mutationsList[0].addedNodes.length
      ) {
        update_history_tags(mutationsList[0].addedNodes[0]);
      }
    };
  
    // 标签页容器发生变化——通常是出现分屏、关闭分屏 或者关闭了所有标签页的情况，此时需要更新观测的节点
    const tab_container_change = function (mutationsList, observer) {
      if (mutationsList[0].type === "childList") {
        update_history_tags(mutationsList[0].addedNodes[0]);
        updateNode();
      }
    };
  
    // 创建实例——观测页签的新增
    const tabs_observer = new MutationObserver(tag_change);
    // 创建实例——观测标签容器发生的变动
    const tabs_container_observer = new MutationObserver(tab_container_change);
  
    // 初始化
    for (let tab_container of tab_containers) {
      tabs_observer.observe(tab_container, config);
    }
  
    // 更新观测的节点
    function updateNode() {
      tabs_observer.disconnect();
      // 重新获取节点
      tab_containers = document.querySelectorAll(
        "div[data-type='wnd'] > div.fn__flex ul.fn__flex.layout-tab-bar.fn__flex-1"
      );
      // 对节点重新进行观测
      for (let tab_container of tab_containers) {
        tabs_observer.observe(tab_container, config);
      }
    }
  
  
    let parentNode = document.querySelector(
      "div#layouts > div.fn__flex.fn__flex-1 >div.layout__center.fn__flex.fn__flex-1"
    );
    tabs_container_observer.observe(parentNode, config);
  
  
    // 【设置】按钮的前面添加一个【历史记录】按钮
    var settingBtn = document.getElementById("barHistory");
    settingBtn.insertAdjacentHTML(
      "afterend",
      '<div id="history"class="toolbar__item b3-tooltips b3-tooltips__se" aria-label="历史记录" ></div>'
    );
    // 历史记录面板
    settingBtn.insertAdjacentHTML(
      "afterend",
      '<div id="myHistory" style="position:absolute;z-index:100;top:43%;left:18%;width:430px;height:74vh;background-color: var(--b3-theme-background);box-shadow: rgba(15, 15, 15, 0.05) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 3px 6px, rgba(15, 15, 15, 0.2) 0px 9px 24px; border-radius: 5px; visibility:hidden;transform: translate(-50%, -50%);overflow:auto;padding:0px 25px 10px 25px;"><div style="position:sticky;top:0px;padding-top:20px;margin-top:-2px;padding-bottom:15px; background-color:var(--b3-theme-background);" class="topBar"><input id="history_input"style="margin-left:5px; border:1px solid black ;" type="text" placeholder="搜索历史记录"  size="30"><button id = "showAllHistory"  style="margin-left:5px;">显示全部</button><button id = "clearHistory"  style="position:absolute;right:10px;">清除历史</button></div><div id ="historyContainer"></div></div>'
    );
  
    let showAllHistoryBtn = document.getElementById("showAllHistory");
    let historyInputArea = document.getElementById("history_input");
    var historyDom = document.getElementById("history");
    historyDom.style.width = "auto";
    var historyIcon ='<svg id="_x30_1" style="enable-background:new 0 0 1024 1024;" version="1.1" viewBox="0 0 1024 1024" xml:space="preserve" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g><path d="M513 1024c131 0 262-50.4 361.6-151.2 199.2-199 199.2-524.6 0-723.5-199.2-199-525.3-199-724.5 0-96.9 96.7-150.1 226.1-150.1 362.4 0 137.6 53.2 265.7 150.1 362.4 100.9 99.5 231.9 149.9 362.9 149.9zM272.8 512.7v120.4h347v-400.1h-134.6v265.5h-212.4v14.2zM134.6 511.7c0-100.8 39.6-195.3 111.2-266.8 146.8-146.6 386.7-146.8 533.8-0.6 0.2 0.2 0.4 0.4 0.6 0.6 147 146.8 147 386.8 0 533.6s-387.4 146.8-534.4 0c-71.6-71.6-111.2-166-111.2-266.8z"></g></svg>';
      historyDom.innerHTML = historyIcon;
    let myHistory = document.getElementById("myHistory");
    
    // DOM——放置历史条目的容器
    let historyContainer = document.getElementById("historyContainer");
  
    // 打开某个历史文档
    function openHistoryDoc(e) {
      e.stopPropagation();
      if (e.target.tagName == "SPAN" && e.target.getAttribute("data-href")) {
        try {
          window.open(e.target.getAttribute("data-href"));
        } catch (err) {
          console.error(err);
        }
      }
    }
  
    // 点击某一条历史记录后——跳转到对应的文档
    myHistory.addEventListener("click", openHistoryDoc, false);
  
    let clearHistory = document.getElementById("clearHistory");
    // callback——清空历史
    function clearAllHistory(e) {
      e.stopPropagation();
      historyArr = [];
      localStorage.setItem("historyArr", JSON.stringify(historyArr));
      historyContainer.innerHTML = "";
      myHistory.style.visibility = "hidden";
    }
    clearHistory.addEventListener("click", clearAllHistory, false);
  
    // callback——显示最近打开过的文档
    function showAllHistoryItems(e) {
      e.stopPropagation();
      if (myHistory.style.visibility === "hidden") {
        myHistory.style.visibility = "visible";
      }
      if (
        localStorage.getItem("historyArr") &&
        JSON.parse(localStorage.getItem("historyArr")).length > 0
      ) {
        historyArr = JSON.parse(localStorage.getItem("historyArr"));
        const fragment = document.createDocumentFragment();
        historyContainer.innerHTML = "";
        // 时间最新的记录显示在上方
        let tempArr = [...historyArr];
        tempArr.reverse();
        tempArr.forEach((value) => {
          let [item_time, item_text, href, history_item_icon] = value.split("--");
          item_text = item_text.replace(/</g, "&lt;");
          item_text = item_text.replace(/>/g, "&gt;");
          const elem_div = document.createElement("div");
          elem_div.className = "historyItem";
          elem_div.style.marginTop = "10px";
          elem_div.innerHTML = `<span class="historyTimeStamp" style="color: var(--b3-theme-on-background);margin-right: 2em;">${item_time}</span>
        <span><svg class="history-icon" style="height:16px;width:16px;vertical-align: middle;">${history_item_icon}</svg></span>
        <span style="color:#3481c5;margin-left:5px;cursor: pointer;" data-href="${href}" title="${href}">${item_text}</span>`;
          fragment.appendChild(elem_div);
        });
        historyContainer.appendChild(fragment);
      }
    }
  
    // 简要处理一下防抖
    function debounce(func, wait = 500) {
      let timer = null;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          func.apply(this, args);
        }, wait);
      };
    }
  
    // 处理提交的关键词
    function historyKeySubmit(e) {
      if (historyInputArea.value.trim()) {
        let keyword = historyInputArea.value.trim();
        if (
          localStorage.getItem("historyArr") &&
          JSON.parse(localStorage.getItem("historyArr")).length > 0
        ) {
          historyArr = JSON.parse(localStorage.getItem("historyArr"));
          const fragment = document.createDocumentFragment();
          historyContainer.innerHTML = "";
          let tempArr = [...historyArr];
          tempArr.reverse();
          tempArr = tempArr.filter((item) => item.includes(keyword));
          tempArr.forEach((value) => {
            let [item_time, item_text, href, history_item_icon] =
              value.split("--");
            const regExp = new RegExp(`${keyword}`, "g");
            item_text = item_text
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(regExp, function (value) {
                return `<span style="background-color:#ffe955;color:black;">${value}</span>`;
              });
            item_time = item_time.replace(regExp, function (value) {
              return `<span style="background-color:#ffe955;color:black;">${value}</span>`;
            });
            const elem_div = document.createElement("div");
            elem_div.className = "historyItem";
            elem_div.style.marginTop = "10px";
            elem_div.innerHTML = `<span class="historyTimeStamp" style="color: black;margin-right: 2em;">${item_time}</span>
          <span><svg class="history-icon" style="height:16px;width:16px;vertical-align: middle;">${history_item_icon}</svg></span>
          <span style="color:#3481c5;margin-left:5px;cursor: pointer;" data-href="${href}" title="${href}">${item_text}</span>`;
            fragment.appendChild(elem_div);
          });
          historyContainer.appendChild(fragment);
        }
      } else {
        showAllHistoryItems(e);
      }
    }
    // 顶栏【历史记录】图标
    historyDom.addEventListener("click", showAllHistoryItems, false);
    // 按钮——显示全部
    showAllHistoryBtn.addEventListener("click", showAllHistoryItems, false);
    // 输入框——搜索历史记录
    historyInputArea.addEventListener("input", debounce(historyKeySubmit), false);
  
    // 隐藏历史面板
    function hideHistoryPanel() {
      if (myHistory.style.visibility === "visible") {
        myHistory.style.visibility = "hidden";
      }
    }
    // 点击其他区域时，隐藏历史面板
    window.addEventListener("click", hideHistoryPanel, false);
  
  }
  








//+++++++++++++++++++++++++++++++++思源API++++++++++++++++++++++++++++++++++++
//思源官方API文档  https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md

/**
 * 
 * @param {*} 内容块id 
 * @param {*} 回调函数 
 * @param {*} 传递对象 
 */
async function 根据ID获取人类可读路径(内容块id, then, obj = null) {
    await 向思源请求数据('/api/filetree/getHPathByID', {
        id: 内容块id
    }).then((v) => then(v.data, obj))
}

async function 以id获取文档聚焦内容(id, then, obj = null) {
    await 向思源请求数据('/api/filetree/getDoc', {
        id: id,
        k: "",
        mode: 0,
        size: 36,
    }).then((v) => then(v.data, obj))
}

async function 更新块(id, dataType, data, then = null, obj = null) {
    await 向思源请求数据('/api/block/updateBlock', {
        id: id,
        dataType: dataType,
        data: data,
    }).then((v) => {
        if (then) then(v.data, obj);
    })
}

async function 设置思源块属性(内容块id, 属性对象) {
    let url = '/api/attr/setBlockAttrs'
    return 解析响应体(向思源请求数据(url, {
        id: 内容块id,
        attrs: 属性对象,
    }))
}

async function 向思源请求数据(url, data) {
    let resData = null
    await fetch(url, {
        body: JSON.stringify(data),
        method: 'POST',
        headers: {
            Authorization: `Token ''`,
        }
    }).then(function (response) { resData = response.json() })
    return resData
}

async function 解析响应体(response) {
    let r = await response
    return r.code === 0 ? r.data : null
}


//+++++++++++++++++++++++++++++++++辅助API++++++++++++++++++++++++++++++++++++


/**
 * 方便为主题功能添加开关按钮，并选择是否拥有记忆状态
 * @param {*} ButtonID 按钮ID。
 * @param {*} ButtonTitle 按钮作用提示文字。
 * @param {*} NoButtonSvg 按钮激活Svg图标路径
 * @param {*} OffButtonSvg 按钮未激活Svg图标路径
 * @param {*} NoClickRunFun 按钮开启执行函数
 * @param {*} OffClickRunFun 按钮关闭执行函数
 * @param {*} Memory 是否设置记忆状态 true为是留空或false为不设置记忆状态。
 */
function notionThemeToolbarAddButton(ButtonID, ButtonTitle, ButtonLabel, NoButtonSvgURL, OffButtonSvgURL, NoClickRunFun, OffClickRunFun, Memory) {
    var notionToolbar = document.getElementById("notionToolbar");
    if (notionToolbar == null) {
        var toolbarEdit = document.getElementById("toolbarEdit");
        var windowControls = document.getElementById("windowControls");

        if (toolbarEdit == null && windowControls != null) {
            notionToolbar = document.createElement("div");
            notionToolbar.id = "notionToolbar";
            windowControls.parentElement.insertBefore(notionToolbar, windowControls);
        } else if (toolbarEdit != null) {
            notionToolbar = insertCreateBefore(toolbarEdit, "div", "notionToolbar");
            notionToolbar.style.position = "relative";
        }
    }

    var addButton = addinsertCreateElement(notionToolbar, "div");
    addButton.style.float = "left";
    addButton.style.backgroundImage = "url(" + OffButtonSvgURL + ")";
    addButton.style.backgroundRepeat = "no-repeat";
	addButton.style.backgroundPosition = "left top";
    addButton.style.backgroundSize = "100%";

    
    addButton.id = ButtonID;
	addButton.setAttribute("class", ButtonTitle);
	addButton.setAttribute("aria-label", ButtonLabel)

    var offNo = "0";



    if (Memory == true) {
        offNo = localStorage.getItem(ButtonID);
        if (offNo == "1") {
            addButton.style.backgroundImage = "url(" + NoButtonSvgURL + ")";
            localStorage.setItem(ButtonID, "0");
            NoClickRunFun(addButton);
            localStorage.setItem(ButtonID, "1");
        } else if (offNo != "0") {
            offNo = "0";
            localStorage.setItem(ButtonID, "0");
        }
    }

    AddEvent(addButton, "click", () => {

        if (offNo == "0") {
            addButton.style.backgroundImage = "url(" + NoButtonSvgURL + ")";

            NoClickRunFun(addButton);
            if (Memory != null) localStorage.setItem(ButtonID, "1");
            offNo = "1";
            return;
        }

        if (offNo == "1") {
            addButton.style.backgroundImage = "url(" + OffButtonSvgURL + ")";
            addButton.style.filter = "none";
            OffClickRunFun(addButton);
            if (Memory != null) localStorage.setItem(ButtonID, "0");
            offNo = "0";
            return;
        }
    });


}


/**
 * 在DIV光标位置插入内容
 * @param {*} content 
 */
function insertContent(content) {
    if (content) {
        var sel = window.getSelection();
        if (sel.rangeCount > 0) {
            var range = sel.getRangeAt(0); //获取选择范围
            range.deleteContents(); //删除选中的内容
            var el = document.createElement("div"); //创建一个空的div外壳
            el.innerHTML = content; //设置div内容为我们想要插入的内容。
            var frag = document.createDocumentFragment(); //创建一个空白的文档片段，便于之后插入dom树
            var node = el.firstChild;
            var lastNode = frag.appendChild(node);
            range.insertNode(frag); //设置选择范围的内容为插入的内容
            var contentRange = range.cloneRange(); //克隆选区

            contentRange.setStartAfter(lastNode); //设置光标位置为插入内容的末尾
            contentRange.collapse(true); //移动光标位置到末尾
            sel.removeAllRanges(); //移出所有选区
            sel.addRange(contentRange); //添加修改后的选区

        }
    }
}


/**
 * 获取DIV文本光标位置
 * @param {*} element 
 * @returns 
 */
function getPosition(element) {
    var caretOffset = 0;
    var doc = element.ownerDocument || element.document;
    var win = doc.defaultView || doc.parentWindow;
    var sel;
    if (typeof win.getSelection != "undefined") {
        //谷歌、火狐
        sel = win.getSelection();
        if (sel.rangeCount > 0) {
            var range = sel.getRangeAt(0);
            var preCaretRange = range.cloneRange(); //克隆一个选区
            preCaretRange.selectNodeContents(element); //设置选区的节点内容为当前节点
            preCaretRange.setEnd(range.endContainer, range.endOffset); //重置选中区域的结束位置
            caretOffset = preCaretRange.toString().length;
        }
    } else if ((sel = doc.selection) && sel.type != "Control") {
        //IE
        var textRange = sel.createRange();
        var preCaretTextRange = doc.body.createTextRange();
        preCaretTextRange.moveToElementText(element);
        preCaretTextRange.setEndPoint("EndToEnd", textRange);
        caretOffset = preCaretTextRange.text.length;
    }
    return caretOffset;
};
/**
 * 在指定DIV索引位置设置光标
 * @param {*} element 
 * @param {*} index 
 */
function setCursor(element, index) {
    var codeEl = element.firstChild;
    var selection = window.getSelection();
    // 创建新的光标对象
    let range = selection.getRangeAt(0);
    // 光标对象的范围界定为新建的代码节点
    range.selectNodeContents(codeEl)
    // 光标位置定位在代码节点的最大长度
    // console.log(codeEl.length);
    range.setStart(codeEl, index);
    // 使光标开始和光标结束重叠
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
}


/**
 * 获得文本的占用的宽度
 * @param {*} text 字符串文班
 * @param {*} font 文本字体的样式
 * @returns 
 */
function getTextWidth(text, font) {
    var canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
    var context = canvas.getContext("2d");
    context.font = font;
    var metrics = context.measureText(text);
    return metrics.width;
}

/**
 * 触发元素的事件
 * @param {触发元素事件} type 
 * @param {*} element 
 * @param {*} detail 
 */
function trigger(type, element) {
    var customEvent = new Event(type, { bubbles: false, cancelable: true });
    element.dispatchEvent(customEvent);
}

/**
 * 向body注入新style覆盖原本的css
 * @param {css文本字符串} csstxt 
 */
function injectionCss(csstxt) {
    var styleElement = document.createElement('style');

    styleElement.innerText = t;

    document.body.appendChild(styleElement);
};

/**
 * 向指定父级创建追加一个子元素，并可选添加ID,
 * @param {Element} fatherElement 
 * @param {string} addElementTxt 要创建添加的元素标签
 * @param {string} setId 
 * @returns addElementObject
 */
function addinsertCreateElement(fatherElement, addElementTxt, setId = null) {
    if (!fatherElement) console.error("指定元素对象不存在！");
    if (!addElementTxt) console.error("未指定字符串！");

    var element = document.createElement(addElementTxt);

    if (setId) element.id = setId;

    fatherElement.appendChild(element);

    return element;
}


/**
 * 向指定元素后创建插入一个元素，可选添加ID
 * @param {*} targetElement 目标元素
 * @param {*} addElementTxt 要创建添加的元素标签
 * @param {*} setId 为创建元素设置ID
 */
function insertCreateAfter(targetElement, addElementTxt, setId = null) {

    if (!targetElement) console.error("指定元素对象不存在！");
    if (!addElementTxt) console.error("未指定字符串！");

    var element = document.createElement(addElementTxt);

    if (setId) element.id = setId;

    var parent = targetElement.parentNode;//得到父节点
    if (parent.lastChild === targetElement) {
        //如果最后一个子节点是当前元素那么直接添加即可
        parent.appendChild(element);
        return element;
    } else {
        parent.insertBefore(element, targetElement.nextSibling);//否则，当前节点的下一个节点之前添加
        return element;
    }
}


/**
 * 向指定元素前创建插入一个元素，可选添加ID
 * @param {*} targetElement 目标元素
 * @param {*} addElementTxt 要创建添加的元素标签
 * @param {*} setId 为创建元素设置ID
 */
function insertCreateBefore(targetElement, addElementTxt, setId = null) {

    if (!targetElement) console.error("指定元素对象不存在！");
    if (!addElementTxt) console.error("未指定字符串！");

    var element = document.createElement(addElementTxt);

    if (setId) element.id = setId;

    targetElement.parentElement.insertBefore(element, targetElement);

    return element;
}



/**
 * 为元素注册监听事件
 * @param {Element} element 
 * @param {string} strType 
 * @param {Fun} fun 
 */
function AddEvent(element, strType, fun) {
    //判断浏览器有没有addEventListener方法
    if (element.addEventListener) {
        element.addEventListener(strType, fun, false);
        //判断浏览器有没 有attachEvent IE8的方法	
    } else if (element.attachEvent) {
        element.attachEvent("on" + strType, fun);
        //如果都没有则使用 元素.事件属性这个基本方法
    } else {
        element["on" + strType] = fun;
    }
}


/**
 * 为元素解绑监听事件
 * @param {Element}  element ---注册事件元素对象
 * @param {String}   strType ---注册事件名(不加on 如"click")
 * @param {Function} fun	 ---回调函数
 * 
 */
function myRemoveEvent(element, strType, fun) {
    //判断浏览器有没有addEventListener方法
    if (element.addEventListener) {
        // addEventListener方法专用删除方法
        element.removeEventListener(strType, fun, false);
        //判断浏览器有没有attachEvent IE8的方法	
    } else if (element.attachEvent) {
        // attachEvent方法专用删除事件方法
        element.detachEvent("on" + strType, fun);
        //如果都没有则使用 元素.事件属性这个基本方法
    } else {
        //删除事件用null
        element["on" + strType] = null;
    }
}


/**
* 加载脚本文件
* @param {string} url 脚本地址
* @param {string} type 脚本类型
*/
function loadScript(url, type = 'module') {
    let script = document.createElement('script');
    if (type) script.setAttribute('type', type);
    script.setAttribute('src', url);
    document.head.appendChild(script);
}



/**
 * 得到思源toolbar
 * @returns 
 */
function getSiYuanToolbar() { return document.getElementById("toolbar"); }

/**
 * 得到notionToolbar
 * @returns 
 */
function getnotionToolbar() { return document.getElementById("notionToolbar"); }



/**简单判断目前思源是否是手机模式 */
function isPhone() {
    return document.getElementById("toolbar") == null;
}


/**
 * 加载样式文件
 * @param {string} url 样式地址
 * @param {string} id 样式 ID
 */
function loadStyle(url, id, cssName) {

    var headElement = document.head;

    let style = document.getElementById(id);
    if (id != null) {
        if (style) headElement.removeChild(style);
    }

    style = document.createElement('link');
    if (id != null) style.id = id;


    style.setAttribute('type', 'text/css');
    style.setAttribute('rel', 'stylesheet');
    style.setAttribute('href', url);
    if (cssName != null) style.setAttribute("class", cssName);
    headElement.appendChild(style);
    return style;
}

/**
 * 取出两个数组的不同元素
 * @param {*} arr1 
 * @param {*} arr2 
 * @returns 
 */
function getArrDifference(arr1, arr2) {
    return arr1.concat(arr2).filter(function (v, i, arr) {
        return arr.indexOf(v) === arr.lastIndexOf(v);
    });
}

/**
 * 取出两个数组的相同元素
 * @param {*} arr1 
 * @param {*} arr2 
 * @returns 
 */
function getArrEqual(arr1, arr2) {
    let newArr = [];
    for (let i = 0; i < arr2.length; i++) {
        for (let j = 0; j < arr1.length; j++) {
            if (arr1[j] === arr2[i]) {
                newArr.push(arr1[j]);
            }
        }
    }
    return newArr;
}

/**
 * 思源吭叽元素属性解析看是否包含那种行级元素类型
 * @param {} attributes 
 * @param {*} attribute 
 * @returns 
 */
function attributesContains(attributes, attribute) {
    if (attribute == true) return;
    var arr = attributes.split(" ");
    if (arr.length != 0) {
        arr.forEach((v) => {
            if (v == attribute) attribute = true;
        });
        return attribute == true ? true : false;
    } else {
        return attributes == attribute;
    }
}
/**
 * 间隔执行指定次数的函数(不立即执行)
 * @param {*} time 间隔时间s
 * @param {*} frequency 执行次数
 * @param {*} Fun 执行函数
 */
function IntervalFunTimes(time, frequency, Fun) {

    for (let i = 0; i < frequency; i++) {
        sleep(time * i).then(v => {
            Fun();
        })
    }

    function sleep(time2) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                resolve()
            }, time2)
        })
    }
}

/**
 * 获得当前浏览器缩放系数 默认值为1
 * @returns 
 */
function detectZoom() {
    var ratio = 0, screen = window.screen, ua = navigator.userAgent.toLowerCase();
    if (window.devicePixelRatio !== undefined) {
        ratio = window.devicePixelRatio;
    } else if (~ua.indexOf('msie')) {
        if (screen.deviceXDPI && screen.logicalXDPI) {
            ratio = screen.deviceXDPI / screen.logicalXDPI;
        }
    } else if (window.outerWidth !== undefined && window.innerWidth !== undefined) {
        ratio = window.outerWidth / window.innerWidth;
    }
    if (ratio) {
        ratio = Math.round(ratio * 100);
    }
    return ratio * 0.01;
};
/**
 * 递归DOM元素查找深度子级的一批符合条件的元素返回数组
 * @param {*} element 要查找DOM元素
 * @param {*} judgeFun 查找函数 : fun(v) return true or false
 * @returns array
 */
function diguiTooALL(element, judgeFun) {

    var target = [];

    if (element == null) return null;
    if (judgeFun == null) return null;


    digui(element);
    return target;

    function digui(elem) {
        var child = elem.children;
        if (child.length == 0) return;

        for (let index = 0; index < child.length; index++) {
            const element2 = child[index];
            if (judgeFun(element2)) {
                target.push(element2);
                digui(element2);
            } else {
                digui(element2);
            }
        }
    }
}

/**
 * 递归DOM元素查找深度子级的第一个符合条件的元素-子级的子级深度搜索赶紧后在搜索下一个子级
 * @param {*} element 要查找DOM元素
 * @param {*} judgeFun 查找函数 : fun(v) return true or false
 * @returns element
 */
function diguiTooONE_1(element, judgeFun) {

    if (element == null) return null;
    if (judgeFun == null) return null;

    return digui(element);

    function digui(elem) {
        var child = elem.children;
        if (child.length == 0) return null;

        for (let index = 0; index < child.length; index++) {
            const element2 = child[index];
            if (judgeFun(element2)) {
                return element2;
            } else {
                var item = digui(element2);
                if (item == null) continue;
                return item;
            }
        }
        return null;
    }
}

/**
 * 递归DOM元素查找深度子级的第一个符合条件的元素-同层全部筛选一遍在依次深度搜索。
 * @param {*} element 要查找DOM元素
 * @param {*} judgeFun 查找函数 : fun(v) return true or false
 * @param {*} xianz 限制递归最大次数
 * @returns element
 */
function diguiTooONE_2(element, judgeFun, xianz = 999) {

    if (element == null || element.firstElementChild == null) return null;
    if (judgeFun == null) return null;
    var i = xianz <= 0 ? 10 : xianz;
    return digui(element);

    function digui(elem) {

        if (i <= 0) return null;
        xianz--;

        var child = elem.children;
        var newchild = [];
        for (let index = 0; index < child.length; index++) {
            const element2 = child[index];
            if (judgeFun(element2)) {
                return element2;
            } else {
                if (newchild.firstElementChild != null) newchild.push(element2);
            }
        }

        for (let index = 0; index < newchild.length; index++) {
            const element2 = newchild[index];
            var item = digui(element2);
            if (item == null) continue;
            return item;
        }
        return null;
    }
}
/**
 * 不断查找元素父级的父级知道这个父级符合条件函数
 * @param {*} element 起始元素
 * @param {*} judgeFun 条件函数
 * @param {*} upTimes 限制向上查找父级次数
 * @returns 返回符合条件的父级，或null
 */
function isFatherFather(element, judgeFun, upTimes) {
    var i = 0;
    for (; ;) {
        if (!element) return null;
        if (upTimes < 1 || i >= upTimes) return null;
        if (judgeFun(element)) return element;
        element = element.parentElement;
        i++;
    }
}


/**
 * 获得焦点所在的块
 * @return {HTMLElement} 光标所在块
 * @return {null} 光标不在块内
 */
function getFocusedBlock() {
    let block = window.getSelection()
        && window.getSelection().focusNode
        && window.getSelection().focusNode.parentElement; // 当前光标
    while (block != null && block.dataset.nodeId == null) block = block.parentElement;
    return block;
}
/**
 * 清除选中文本
 */
function clearSelections() {
    if (window.getSelection) {
        var selection = window.getSelection();
        selection.removeAllRanges();
    } else if (document.selection && document.selection.empty) {
        document.selection.empty();
    }
}

/**
 * body全局事件频率优化执行
 * @param {*} eventStr 那种事件如 "mouseover"
 * @param {*} fun(e) 执行函数,e：事件对象
 * @param {*} accurate 精确度：每隔多少毫秒检测一次触发事件执行
 * @param {*} delay 检测到事件触发后延时执行的ms
 * @param {*} frequency 执行后再延时重复执行几次
 * @param {*} frequencydelay 执行后再延时重复执行之间的延时时间ms
 */
function BodyEventRunFun(eventStr, fun, accurate = 100, delay = 0, frequency = 1, frequencydelay = 16) {
    var isMove = true;
    var _e = null;
    AddEvent(document.body, eventStr, (e) => { isMove = true; _e = e })
    setInterval(() => {
        if (!isMove) return;
        isMove = false;
        setTimeout(() => {
            fun(_e);
            if (frequency == 1) return;
            if (frequencydelay < 16) frequencydelay = 16;

            var _frequencydelay = frequencydelay;
            for (let index = 0; index < frequency; index++) {
                setTimeout(() => { fun(_e); }, frequencydelay);
                frequencydelay += _frequencydelay;
            }

        }, delay);
    }, accurate);
}

/**
 * 为元素添加思源悬浮打开指定ID块内容悬浮窗事件
 * @param {*} element 绑定的元素
 * @param {*} id 悬浮窗内打开的块的ID
 */
function suspensionToOpenSiyuanSuspensionWindow(element, id) {
    element.setAttribute("data-defids", '[""]');
    element.classList.add("popover__block");
    element.setAttribute("data-id", id);
}

/**
 * 为元素添加思源点击打开指定ID块内容悬浮窗事件
 * @param {*} element 绑定的元素
 * @param {*} id 悬浮窗内打开的块的ID
 */
function clickToOpenSiyuanFloatingWindow(element, id) {
    element.classList.add("protyle-wysiwyg__embed");
    element.setAttribute("data-id", id);
}

/**
 * 控制台打印输出
 * @param {*} obj 
 */
function c(...data) {
    console.log(data);
}

/**
 * 安全While循环
 * frequency:限制循环次数
 * 返回值不等于null终止循环
 */
function WhileSafety(fun, frequency = 99999) {
    var i = 0;
    if (frequency <= 0) {
        console.log("安全循环次数小于等于0")
        return;
    }
    while (i < frequency) {
        var _return = fun();
        if (_return != null || _return != undefined) return _return;
        i++;
    }
}
/**设置思源块展开 */
function setBlockfold_0(BlockId) {
    设置思源块属性(BlockId, { "fold": "0" });
}

/**设置思源块折叠 */
function setBlockfold_1(BlockId) {
    设置思源块属性(BlockId, { "fold": "1" });
}

/**
    * 得到光标编辑状态下的显示commonMenu菜单;
    * @returns 
    */
function getcommonMenu_Cursor() {
    if ((window.getSelection ? window.getSelection() : document.selection.createRange().text).toString().length != 0) return null;
    var commonMenu = document.querySelector("#commonMenu:not(.fn__none)");
    if (commonMenu == null) return null;
    if (commonMenu.firstChild == null) return null;
    if (commonMenu.children.length < 8) {
        return commonMenu;
    }
    return null;
}

/**
    * 得到光标选中编辑状态下的显示commonMenu菜单;
    * @returns 
    */
function getcommonMenu_Cursor2() {
    if ((window.getSelection ? window.getSelection() : document.selection.createRange().text).toString().length != 0) {
        return document.querySelector("#commonMenu:not(.fn__none)");
    };
    return null;
}

/**
 * 得到快选中状态下的显示commonMenu菜单;
 * @returns 
 */
function getcommonMenu_Bolck() {
    var commonMenu = document.querySelector("#commonMenu:not(.fn__none)");
    if (commonMenu.children.length < 8) {
        return commonMenu;
    }
    return null;
}


/**++++++++++++++++++++++++++++++++按需调用++++++++++++++++++++++++++++++ */

setTimeout(() => {

    if (isPhone()) {

        collapseExpand_Head_List()//鼠标中键标题、列表文本折叠/展开
		
		themeButton()//主题 

        console.log("==============>附加CSS和特性JS_已经执行<==============");
    } else {
			
		themeButton()//主题
		
		topbarfixedButton()//顶栏固定
		
		leftColumnButton()//左侧面板悬浮
		
		rightColumnButton()//右侧面板悬浮

        setTimeout(() => ClickMonitor(), 3000);//各种列表转xx

        rundynamicUnderline();//为文档标题创建动态下划线

        showDocumentCreationDate();//为打开文档标题下面显示文档创建日期

        autoOpenList();//自动展开悬浮窗内折叠列表（第一次折叠）

        collapsedListPreview();//折叠列表内容预览查看

        collapseExpand_Head_List()//鼠标中键标题、列表文本折叠/展开

        init()//最近打开文档
		
		initcalendar()//打开日历
		
		loadScript("/appearance/themes/notion-theme/comment/index.js");//js批注评论

        console.log("==============>附加CSS和特性JS_已经执行<==============");
    }
}, 1000);




