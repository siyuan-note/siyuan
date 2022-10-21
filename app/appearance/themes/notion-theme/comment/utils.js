/*
** randomWord 产生任意长度随机字母数字组合
** randomFlag-是否任意长度 min-任意长度最小位[固定位数] max-任意长度最大位
** xuanfeng 2014-08-28
*/

function randomWord(randomFlag, min, max) {
  var str = "",
    range = min,
    arr = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];

  // 随机产生
  if (randomFlag) {
    range = Math.round(Math.random() * (max - min)) + min;
  }
  for (var i = 0; i < range; i++) {
    let pos = Math.round(Math.random() * (arr.length - 1));
    str += arr[pos];
  }
  return str;
}

export function dateFormat(fmt, date) {
  let ret;
  const opt = {
    "Y+": date.getFullYear().toString(),        // 年
    "m+": (date.getMonth() + 1).toString(),     // 月
    "d+": date.getDate().toString(),            // 日
    "H+": date.getHours().toString(),           // 时
    "M+": date.getMinutes().toString(),         // 分
    "S+": date.getSeconds().toString(),
    "s+": date.getMilliseconds().toString()     // 毫秒
    // 有其他格式化字符需求可以继续添加，必须转化成字符串
  };
  for (let k in opt) {
    ret = new RegExp("(" + k + ")").exec(fmt);
    if (ret) {
      fmt = fmt.replace(ret[1], (ret[1].length == 1) ? (opt[k]) : (opt[k].padStart(ret[1].length, "0")))
    };
  };
  return fmt;
}

/**
 * 构建符合规范的 blockid
 * @param {bool} suffix 是否添加 7 为字母数字组合的后缀，默认为不添加，仅通过日期构建 id
 * @returns blockid
 */
export function createBlockId(suffix = true) {
  let id = dateFormat("YYYYmmddHHMMSS", new Date())
  if (suffix) {
    id += "-" + randomWord(true, 7, 7)
  }
  return id
}

/**
 * 创建弹框遮罩
 * @param {*} obj 对象句柄
 * @param {*} type 弹框样式： black 半透明遮罩；default 透明遮罩
 * @returns 
 */
export function createOverlay(obj = this, type) {
  let className = ''
  if (type == 'black') {
    className = 'lz-overlay-black'
  } else {
    className = 'lz-overlay'
  }
  let overlay = document.querySelector(`.${className}`)
  if (overlay) {
    obj.overlay = overlay
  } else {
    obj.overlay = document.createElement('div')
    obj.overlay.className = className
  }
  return obj.overlay
}


/**
 * 通过触发 protyle input 事件来保存 block 内容，需要确保 protyle 获得焦点
 */
export function saveViaTransaction() {
  let protyle = document.querySelector('.fn__flex-1.protyle:not(.fn__none) .protyle-wysiwyg.protyle-wysiwyg--attr') //需要获取到当前正在编辑的 protyle
  let e = document.createEvent('HTMLEvents')
  e.initEvent('input', true, false)
  protyle.dispatchEvent(e)
}

/**
 * 消息提示 toast 
 * @param text 提示文案
 * @param type 样式，取值：info / success / danger / warning
 **/
export function snackbar(text, type = 'info') {
  let snackbar = document.querySelector('#snackbar')
  if (!snackbar) {
    snackbar = document.createElement('div')
    snackbar.id = 'snackbar'
    document.body.appendChild(snackbar)
  }
  snackbar.classList.add('show', type)
  snackbar.innerText = text
  setTimeout(function () { snackbar.classList.remove("show", type); }, 3000);
}

/**
 * 计算弹出框的坐标位置，使得 box 不会超出页面范围
 * @param box 元素 node
 * @param x 事件 Event x 坐标
 * @param y 事件 Event y 坐标
 * @param offsetX x 偏移量
 * @param offsetY y 偏移量
 * @param offsetPostion 设置 box 相对于点击坐标的位置
 */
export function computeBoxPosition(box, x, y, offsetX = 10, offsetY = 20, offsetPostion = 'center') {
  let boxWidth = box.clientWidth,
    boxHeight = box.clientHeight,
    docWidth = document.body.clientWidth,
    docHeight = document.body.clientHeight,
    top = y + offsetY,
    left = 0

  switch (offsetPostion) {
    case 'left':
      left = x - boxWidth - offsetX
      break
    case 'right':
      left = x + offsetX
      break
    default:
      left = x - boxWidth / 2 - offsetX
      break
  }

  // box右侧超出页面
  if (left + boxWidth > docWidth) left = docWidth - boxWidth - offsetX
  // box下侧抽出页面
  if (top + boxHeight > docHeight) top = docHeight - boxHeight - offsetY
  // box遮挡了点击位置
  if (y > top && y < top + boxHeight) top = y - boxHeight - offsetY
  top = top < 0 ? offsetY : top
  left = left < 0 ? offsetX : left
  return { x: left, y: top }
}

/**
 * 格式化思源笔记字符串日期
 * @param {*} value 
 * @param {*} from 可选值：date | blockid
 * @returns 
 */
export function formatSYDate(value, from = "date") {

  let str = ''
  if (from == "blockid") {
    let arr = value.split('-')
    str = arr[0]
  } else {
    str = value
  }

  let year = str.substring(0, 4),
    month = str.substring(4, 6),
    day = str.substring(6, 8),
    hour = str.substring(8, 10),
    min = str.substring(10, 12),
    second = str.substring(12, 14)

  return year + '-' + month + '-' + day + ' ' + hour + ':' + min + ':' + second
}

/**
 * 比较版本号
 * @params {string} version1: 版本号1
 * @params {string} version2: 版本号2
 * @return {number}: 1: v1 > v2; -1: v1 < v2; 0: v1 = v2
 */
export function compareVersion(version1, version2) {
  let v1_arr = version1.split('.');
  let v2_arr = version2.split('.');
  for (let i = 0; i < v1_arr.length; i++) {
    let v1, v2;
    if (!isNaN(v1_arr[i]) && !isNaN(v2_arr[i])) { // 两者都为数字
      v1 = parseInt(v1_arr[i]);
      v2 = parseInt(v2_arr[i]);
    }
    else if (!isNaN(v1_arr[i]) || !isNaN(v2_arr[i])) { // 其中一者为数字
      v1 = v1_arr[i];
      v2 = v2_arr[i];
      if (v1 == undefined || v2 == undefined) // 其中一者没有更细分的版本号
        return 0;
      else if (!isNaN(v1) && isNaN(v2)) // v1 是发行版 | v2 是内测(x-alphaX)/公测版(x-devX)
        return 1;
      else if (isNaN(v1) && !isNaN(v2)) // v2 是发行版 | v1 是内测(x-alphaX)/公测版(x-devX)
        return -1;
      else // 意外的情况
        return 0;
    }
    else { // 都不为数字, 比较字符串, 内测版(alpha)比公测版(dev)版本号小
      v1 = v1_arr[i];
      v2 = v2_arr[i];
    }
    switch (true) {
      case v1 > v2:
        return 1;
      case v1 < v2:
        return -1;
      case v1 === v2:
      default:
        break;
    }
  }
  return 0;
}
