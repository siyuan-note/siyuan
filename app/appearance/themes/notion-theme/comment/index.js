/**
 * 行内评论功能
 * REF: [siyuan-note/siyuan-comment at main · langzhou/siyuan-note · GitHub](https://github.com/langzhou/siyuan-note/tree/main/siyuan-comment)
 */

import Comment from './comment.js'

class SiyuanUtil{
  constructor(){
    this.themeName = this.getThemeName()
    if(this.themeName){
      this.appendStyleSheet()
      this.comment = new Comment()
      this.domWatcher()
      this.handleEvents()
    }
						   
								
					 
							
					   
  }

  /* 事件委托 */
  handleEvents() {
    // 按键按下事件
    window.addEventListener('keydown', e => {
      // this.shortcutKey(e)
      if (this.comment) this.comment.handleKeyDown(e)
    })

    // 输入防抖
    // window.addEventListener('keyup',lodash.debounce(e =>{
    //   if(this.searchBox) this.searchBox.handleInput(e)
    // },800))

    // 按键弹起事件
    // window.addEventListener('keyup',e =>{
    //   if(this.searchBox) this.searchBox.actionTrigger(e)
    // })

    // 鼠标单击事件
    window.addEventListener('click', e => {
      if (this.comment) this.comment.showBox(e)
    })

    // 鼠标松开事件
    window.addEventListener('mouseup', e => {
      if (this.comment) this.comment.handleSelectionEvent(e)
    })
  }

  // 获取当前主题名称
  getThemeName(){
    let themeStyle = document.querySelector('#themeStyle')
    if(themeStyle){
      let url = themeStyle.getAttribute('href').split('/')
      return url[url.length - 2]
    }else{
      setTimeout(()=>this.getThemeName(),500)
    }
  }

  /* 检测 dom 变动，用于动态插入元素 */
  domWatcher() {
    var targetNode = document.querySelector('.layout__center.fn__flex.fn__flex-1');
    if (!targetNode) {
      setTimeout(() => { this.domWatcher() }, 500);
    } else {
      const config = { attributes: false, childList: true, subtree: true };
      const callback = (mutationsList, observer) => {
        for (let mutation of mutationsList) {
          if (mutation.type === 'childList') {
            this.childListChangedHook(mutation)
          }
          else if (mutation.type === 'attributes') {
            console.log('The ' + mutation.attributeName + ' attribute was modified.');
          }
        }
      };
      const observer = new MutationObserver(callback);
      observer.observe(targetNode, config);
      // observer.disconnect();
    }
  }

  /* 处理观察对象节点变动事件 */
  childListChangedHook(mutation) {
    // 监听 node added 事件
    if (mutation.addedNodes.length > 0) {
      let node = mutation.addedNodes.item(0)
      // 新增 protyle 节点，即判断为打开了新文档
      if (node && node.className == 'fn__flex-1 protyle') {
        // 因为 dom 树可能没有完全加载，需要延迟处理
        setTimeout(() => {
          if (this.comment) {
            this.comment.appendToolbarBtn()
            // this.comment.resolveCommentNodes() //todo
          }
        }, 1000)
      }
    }
  }


  /* 检测子窗口 dom 变动，用于动态插入元素 */
  popoverDomWatcher() {
    const config = { childList: true };
    const callback = (mutationsList, observer) => {
      for (let mutation of mutationsList) {
        // console.log(mutation)
        this.popoverChildListChangedHook(mutation)
      }
    };
    const observer = new MutationObserver(callback);
    observer.observe(document.body, config);
    // observer.disconnect();
  }


  /* 处理观察对象节点变动事件 */
  popoverChildListChangedHook(mutation) {
    // 监听 node added 事件
    if (mutation.addedNodes.length > 0) {
      let node = mutation.addedNodes.item(0)
      // 新增 protyle 节点，即判断为打开了新文档
      if (node && node.classList.contains('block__popover')) {
        // 因为 dom 树可能没有完全加载，需要延迟处理
        this.comment.appendToolbarBtn(node.querySelector('.protyle'))
      }
    }
  }

  /* 插入样式表 */
  appendStyleSheet() {
    let node = document.querySelector('#protyleHljsStyle')
    if (!node) {
      setTimeout(() => {
        this.appendStyleSheet()
      }, 500);
    } else {
      let fragment = document.createDocumentFragment()
      let css = document.createElement('link')
      css.setAttribute('type', 'text/css')
      css.setAttribute('rel', 'stylesheet')
      css.setAttribute('href','./appearance/themes/'+ this.themeName + '/comment/comment.css')
      fragment.appendChild(css)
      document.head.insertBefore(fragment, node)
    }
  }
}

(() => {
  try {
    if (true) {
      new SiyuanUtil()
    }
  } catch (err) {
    console.error(err);
  }
})();
