import config from './config.js'
import {
  snackbar,
  computeBoxPosition,
  createBlockId,
  saveViaTransaction,
  formatSYDate,
  dateFormat,
  compareVersion,
} from './utils.js'
import {
  querySQL,
  insertBlock,
  appendBlock,
  deleteBlock,
  setBlockAttrs,
} from './network.js'

const VERSION_LE_2_1_14 = compareVersion(
  window.siyuan.config.system.kernelVersion,
  '2.1.14',
) <= 0; // 当前版本号 <= v2.1.14

class Comment {

  constructor() {
    this.icons = config.icons
    this.isShow = false //是否弹出评论框
    setTimeout(() => this.appendToolbarBtn(), 1000) //添加 toolbar 评论按钮
    // setTimeout(()=>this.resolveCommentNodes(),1000) //等待文章内容加载完整后解析评论span todo
  }

  async handleKeyDown(e) {
    // 监听组合快捷键(暂时没用)
    // if(e.shiftKey && e.altKey && e.code =='KeyC'){
    //   e.preventDefault()
    //   e.stopPropagation()
    //   this.showBox(e)
    // }

    // 回车键提交评论
    if (this.isShow && e.key == 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      await this.submitComment()
    }

    // esc 关闭 box
    if (this.isShow && e.key == 'Escape') {
      this.hiddenBox()
    }
  }

  /**
   * 渲染弹出框内的评论列表
   * @param {*} node
   * @param {*} from 点击来源位置
   */
  async renderCommentsHtml(node, from) {

    let html = ''

    switch (from) {
      case 'toolbar':
        html = `<div class="quote">${this.range.toString()}</div>`
        this.list.innerHTML = html
        break
      case 'attr':
        let item = node
        this.list.innerHTML = '//Todo: fetch all comments in the block'
        break
      case 'block':
        let quoteId = node.getAttribute('style');
        if (quoteId && quoteId.indexOf('quote') > -1) {
          quoteId = quoteId.replace("quote-", "")  //移除 style 属性中用于表示的“quote”,获得原始 id
          let sql = `select * from blocks as b left join attributes as a on b.id = a.block_id where a.name = 'custom-quote-id' and a.value = '${quoteId}' and b.type = 'p' order by b.created`,
            res = await querySQL(sql),
            quote = node.innerText,
            comments = res.data
          html += `<div class="quote">${quote}<span class="delete-quote" data-quote-id="${quoteId}">移除引文</span></div>`

          if (res.data.length > 0) {
            for (let key in comments) {
              html += `
              <div class="list-item">
                <div class="header">
                  <div class="date">${formatSYDate(comments[key]['created'])}</div>
                  <div class="actions">
                    <div class="delete-comment" data-quote-id="${quoteId}" data-comment-id="${comments[key]['block_id']}">移除评论</div>
                    <div class="delete-comment" data-quote-id="${quoteId}" data-comment-id="${comments[key]['block_id']}"><a href="siyuan://blocks/${comments[key]['block_id']}">跳转到评论</a></div>
                  </div>
                </div>
                <div class="comment">${comments[key]['content']}</div>
              </div>
            `
            }
          } else {
            html += `<div class="list-item"><div class="header"><div class="date">暂无评论</div></div></div>`
          }

          this.input.setAttribute('data-quote-id', quoteId)
          this.list.innerHTML = html
        }

        break

      default:
        break
    }
  }

  /**
   * 提交评论
   * @returns
   */
  async submitComment() {
    // 输入框内容为空
    if (!this.input.innerText) {
      this.hiddenBox()
      console.log('未填写评论内容');
      return
    }
    // 如果已有 quoteid，则是追加，否则是新增
    let quoteId = this.input.dataset.quoteId
    if (quoteId) {
      //追加评论
      let blockId = document.querySelector(`.protyle-wysiwyg [custom-${quoteId}]`).dataset.nodeId //comment 所在 block
      let quoteText = document.querySelector(`strong[style*="quote-${quoteId}"]`)?.innerText
        ?? document.querySelector(`span[data-type~=strong][style*="quote-${quoteId}"]`)?.innerText
      this.appendBlocks(quoteText, blockId, quoteId)
      let selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(this.range) // 使得 protyle 获得光标
      this.hiddenBox()

    } else {
      //全新评论
      let selection = getSelection()
      let range = this.range
      let start = range.startContainer
      while (start != null && (start.dataset == null || start.dataset.nodeId == null)) {
        start = start.parentElement
      }
      if (start == null) {
        return
      }
      let block = start //由于没有一炮三响了，所以列表项上无法在属性弹框中看到存储的评论内容
      let txt = range.toString() //引用的内容
      range.deleteContents()

      /* 兼容 <= 2.1.14 版本 */
      let strongNode = VERSION_LE_2_1_14
        ? document.createElement('strong')
        : document.createElement('span')
      if (!VERSION_LE_2_1_14) strongNode.setAttribute('data-type', 'strong')

      strongNode.innerText = txt
      quoteId = createBlockId()
      this.appendBlocks(txt, block.dataset.nodeId, quoteId)
      strongNode.setAttribute('style', 'quote-' + quoteId)

      let attr = { key: `custom-${quoteId}`, value: "true" }
      block.setAttribute(attr.key, attr.value)
      // 使用 API 设置块属性
      await setBlockAttrs({
        id: block.dataset.nodeId,
        attrs: {
          [attr.key]: attr.value,
        },
      })
      range.insertNode(strongNode)
      range.setStartAfter(strongNode)
      range.collapse(true) //取消文本选择状态
      selection.removeAllRanges()
      selection.addRange(range)
      this.hiddenBox()
    }

    saveViaTransaction()

  }

  /**
   * 将评论内容以内容块的形式插入到文章尾部
   * @param {*} quoteText 引文内容
   * @param {*} blockId 引文所在 blockid
   * @param {*} quoteId 引文 id
   */
  async appendBlocks(quoteText, blockId, quoteId) {
    let activeEditor = document.querySelector('.layout__center [data-type="wnd"].layout__wnd--active') || document.querySelector('.layout__center [data-type="wnd"]') || document.getElementById('editor') //获得当前光标所在页面
    let background = activeEditor.querySelector('div.protyle:not(.fn__none) .protyle-background') || activeEditor.querySelector('.protyle-background') // 获得桌面端当前编辑的文章
    let docId = background.dataset.nodeId //获得当前编辑的文章 id

    // 评论 h1 标题
    // let headerHtml = `<div data-subtype="h4" data-node-id="${createBlockId()}" data-type="NodeHeading" class="h4" style="comment-header" updated="${createBlockId(false)}"><div contenteditable="true" spellcheck="false">评论</div><div class="protyle-attr" contenteditable="false"></div></div>`
    let headerMd = `
# 评论
{: custom-quote-type="${config.attrs.type.heading}"}
`

    // 评论内容块
    // let commentHtml = `<div data-node-id="${createBlockId()}" custom-quote-id="${quoteId}" data-type="NodeParagraph" class="p" updated="${createBlockId(false)}" data-eof="true"><div contenteditable="true" spellcheck="false">${this.input.innerHTML}</div><div class="protyle-attr"></div></div>`
    let commentMd = `
${this.input.innerHTML}
{: custom-quote-id="${quoteId}" custom-quote-type="${config.attrs.type.comment}" custom-quote-time="${dateFormat("YYYY-mm-dd HH:MM:SS", new Date())}"}
`

    // 引文内容块
    // let quoteHtml = `<div data-node-id="${createBlockId()}"  data-type="NodeBlockquote" class="bq" updated="${quoteId}" data-eof="true" custom-quote-id="${quoteId}"><div data-node-id="${createBlockId()}" data-type="NodeParagraph" class="p" updated="${createBlockId()}"><div contenteditable="true" spellcheck="false"><span data-type="a" data-href="siyuan://blocks/${blockId}">${quoteText}</span></div><div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div>`
    let quoteMd = `
> [${quoteText}](siyuan://blocks/${blockId})
{: custom-quote-id="${quoteId}" custom-quote-type="${config.attrs.type.quote}"}
`

    // 分割线
    // let hrHtml = `<div data-node-id="${createBlockId()}" data-type="NodeThematicBreak" class="hr" ></div>`
    // 先判断是否存在「评论」header，没有则添加，然后依次插入 block（虽然可以一次性批量添加，但不建议，因为可能导致不会及时更新到页面）
    // let header = activeEditor.querySelector('.fn__flex-1.protyle:not(.fn__none) div[style*="comment-header"]')
    let res = await querySQL(`
      select
        *
      from
        attributes as a
      where
        a.root_id = '${docId}'
        and a.name = 'custom-quote-type'
        and a.value = '${config.attrs.type.heading}'
    `)
    // console.log(res)
    if (res && res.code == 0 && res.data.length == 0) {
      // 没有评论标题块，则添加
      await this.appendBlockMd(headerMd, docId)
    }

    res = await querySQL(`
      select
        b.id
      from
        blocks as b
      inner join
        attributes as a
      on
        a.block_id = b.id
      where
        a.root_id = '${docId}'
        and a.name = 'custom-quote-id'
        and a.value = '${quoteId}'
        and b.type = 's'
    `)
    // console.log(res)
    if (res && res.code == 0) {
      if (res.data.length == 0) {
        // 没有关联当前评论的超级块(容器块)，则添加
        let containerMd = `
{{{row
${quoteMd}

${commentMd}
}}}
{: custom-quote-id="${quoteId}" custom-quote-type="${config.attrs.type.container}"}
`
        await this.appendBlockMd(containerMd, docId)
      }
      else if (res.data.length == 1) {
        let containerId = res.data[0].id
        await this.appendBlockMd(commentMd, containerId)
      }
    }

    // 如果已经存在之前的引文评论，则直接在其下方插入新评论
    // let existQuote = activeEditor.querySelector(`.fn__flex-1.protyle:not(.fn__none) .bq[custom-quote-id*="${quoteId}"]`)
    // if(existQuote){
    //   await this.insertBlockDom(commentHtml, existQuote.dataset.nodeId)
    // }else{
    //   await this.appendBlockDom(quoteHtml, docId)
    //   await this.appendBlockDom(commentHtml, docId)
    // }

  }

  /* 评论列表事件，主要是移除评论和引文 */
  async handleListEvents(e) {
    e.stopPropagation()
    let target = e.target
    // 删除评论
    if (target.className == 'delete-comment') {
      // 移除评论按钮
      let quoteId = target.dataset.quoteId
      let commentId = target.dataset.commentId
      let block = document.querySelector(`.protyle-wysiwyg [custom-${quoteId}]`)
      deleteBlock(commentId)
      target.parentNode.parentNode.parentNode.remove()
      return
    }

    if (target.className == 'delete-quote') {
      // 移除引文按钮, 移除评论块与原文块中的评论 ID 属性
      let quoteId = target.dataset.quoteId,
        quoteNode = VERSION_LE_2_1_14
          ? document.querySelector(`strong[style*="quote-${quoteId}"]`)
          : document.querySelector(`span[data-type~=strong][style*="quote-${quoteId}"]`),
        block = document.querySelector(`.protyle-wysiwyg [data-node-id][custom-${quoteId}]`)

      if (block) {
        // 移除 block 中的属性
        let attr_key = `custom-${quoteId}`
        block.removeAttribute(attr_key)
        // 使用 API 移除块属性
        await setBlockAttrs({
          id: block.dataset.nodeId,
          attrs: {
            [attr_key]: '',
          },
        })
      }
      if (quoteNode) {
        // 移除 strong 标签
        let selection = getSelection(),
          range = document.createRange(),
          text = document.createTextNode(quoteNode.innerText)
        range.setStart(quoteNode.firstChild, 0)
        range.setEnd(quoteNode.firstChild, quoteNode.firstChild.length)
        selection.removeAllRanges()
        selection.addRange(range)
        quoteNode.remove()
        range.deleteContents()
        range.insertNode(text)
        range.setStartAfter(text)
        saveViaTransaction()
      }

      // 移除文章末尾评论内容
      // let nodes = document.querySelectorAll(`div[custom-quote-id="${quoteId}"]`)
      // if(nodes){
      //   for(var node of nodes) {
      //     let blockId = node.dataset.nodeId
      //     if(blockId){
      //       deleteBlock(blockId)
      //     }
      //   }
      // }
      let res = await querySQL(`
        select
          b.id
        from
          blocks as b
        inner join
          attributes as a
        on
          a.block_id = b.id
        where
          a.name = 'custom-quote-id'
          and a.value = '${quoteId}'
          and b.type = 's'
      `)
      // console.log(res)
      if (res && res.code == 0) {
        if (res.data.length == 1) {
          await deleteBlock(res.data[0].id)
        }
      }
    }
    this.hiddenBox()
  }

  /**
   * 插入新块
   * @param {*} html
   * @param {*} previousId 前一个块的位置
   * @returns
   */
  insertBlockDom(html, previousId) {
    return insertBlock({
      "data": html,
      "dataType": "dom",
      "previousID": previousId
    })
  }

  /**
   * 以 markdown 的形式插入新块
   * @param {*} html
   * @param {*} previousId 前一个块的位置
   * @returns
   */
  insertBlockMd(md, previousId) {
    return insertBlock({
      "data": md,
      "dataType": "markdown",
      "previousID": previousId
    })
  }

  /**
   * 以 dom 的形式插入后置子块
   * @param {string} html
   * @param {string} parentId
   * @returns
   */
  appendBlockDom(html, parentId) {
    return appendBlock({
      "data": html,
      "dataType": "dom",
      "parentID": parentId
    })
  }

  /**
   * 以 markdown 的形式插入后置子块
   * @param {string} md
   * @param {string} parentId
   * @returns
   */
  appendBlockMd(md, parentId) {
    return appendBlock({
      "data": md,
      "dataType": "markdown",
      "parentID": parentId
    })
  }

  /**
   * TODO: 评论输入框支持粘贴内容块链接
   * @param {*} e
   */
  handlePaste(e) {
    e.stopPropagation()
    const clipdata = e.clipboardData || window.clipboardData;
    const data = clipdata.getData("text/plain")
    let selection = getSelection()
    if (data && selection.toString()) {
      let reg1 = /.*\(\((\d{14}-.*)\)\).*/              //匹配格式：((20210815214330-btqo1b2))
      let reg2 = /.*siyuan:\/\/blocks\/(\d{14}-\S{7})/  //匹配格式：siyuan://blocks/20210815214330-btqo1b2
      let result = data.match(reg1) || data.match(reg2)
      if (result) {
        e.preventDefault()
        let link = document.createElement('a')
        link.setAttribute('href', 'siyuan://blocks/' + result[1])
        link.innerText = selection.toString()
        let range = selection.getRangeAt(0)
        range.deleteContents()
        range.insertNode(link)
        range.setStartAfter(link)
      }
    }
  }

  /**
   * 响应文本选择事件
   * @param {event} e
   */
  handleSelectionEvent(e) {
    let node = e.target, inProtyle = false
    // 判断事件是否发生在 protyle 中
    while (node != document) {
      if (node.classList.contains('protyle-wysiwyg')) {
        inProtyle = true
        break
      }
      node = node.parentNode
    }

    if (inProtyle) {
      let selection = getSelection()
      // 获得文本选择事件的坐标，用于确定弹出 comment box 的位置
      if (selection.rangeCount > 0 && selection.getRangeAt(0).toString()) {
        this.selectionX = e.clientX
        this.selectionY = e.clientY
      } else {
        this.selectionX = null
        this.selectionY = null
      }
    }
  }

  /**
   *  解析文章中的 comment 元素
   */
  resolveCommentNodes() {
    let elements = VERSION_LE_2_1_14
      ? document.querySelectorAll('strong[style*="quote"]')
      : document.querySelector('span[data-type~=strong][style*="quote"]')
    if (elements) {
      elements.forEach((item, index, node) => {
        // 在内容块右侧添加图标
        this.createBlockIcon(item.parentElement)
      })
    }
  }

  /**
   * 在内容块右侧添加图标
   * @param {*} contentBlock
   */
  createBlockIcon(contentBlock) {
    let sibling = contentBlock.nextSibling
    if (sibling && !sibling.querySelector('.protyle-attr--comment')) {
      let div = document.createElement('div')
      div.className = 'protyle-attr--comment'
      div.innerHTML = this.icons.comment
      div.addEventListener('click', (e) => this.showBox(e))
      contentBlock.nextSibling.appendChild(div)
    }
  }

  /**
     * 弹出 box
     * @param {*} e
     */
  showBox(e) {
    let show = false, //用来决定是否弹出 box
      from = '',   //判断弹出 box 点击来源
      x = e.clientX, //事件坐标，用于计算弹框位置
      y = e.clientY,
      target = e.target,
      parent = target.parentNode || target,
      grandParent = parent.parentNode || target, //可能会点击到按钮中的svg、path 元素，所以需要获取父级元素
      style = target.getAttribute('style') //获取 strong 的 style 属性

    // 如果之前不存在box，则创建
    if (!this.box) { this.createBox() }

    // 首先根据点击事件来源决定哪些情况下要弹出 box
    if (target != null && target.dataset != null && target.dataset.type == 'comment'
      || parent != null && parent.dataset != null && parent.dataset.type == 'comment'
      || grandParent != null && grandParent.dataset != null && grandParent.dataset.type == 'comment') {
      // 1)点击 toolbar 图标触发
      e.stopPropagation()
      let selection = getSelection(),
        range = selection.getRangeAt(0)
      if (range) {
        // 需要进一步判断选取是否是在 strong 标签里面
        let start = range.startContainer, end = range.endContainer
        if ((start.parentElement.localName == 'strong' || end.parentElement.localName == 'strong')
          || (start.parentElement.localName == 'span' || end.parentElement.localName == 'span')
        ) {
          snackbar('请不要在行内元素中评论', 'warning')
        } else if (!range.toString()) {
          snackbar('没有选中内容', 'danger')
        } else {
          this.range = range // 因为弹出 box 后，选区会消失，所以提前存储 range
          show = true
          from = 'toolbar'
        }
      }

    } else
      if (style && style.indexOf('quote') > -1 && getSelection().toString() == '') {
        // 2)点击 block 引文触发
        e.stopPropagation()
        show = true
        from = 'block'
        this.range = getSelection().getRangeAt(0)
      } else if (target.classList && target.classList.contains('protyle-attr--comment')
        || parent.classList && parent.classList.contains('protyle-attr--comment')
        || grandParent.classList && grandParent.classList.contains('protyle-attr--comment')) {
        // 3)点击内容块右侧图标触发
        e.stopPropagation()
        show = true
        from = 'attr'
      }

    if (show) {
      this.isShow = true
      this.box.style.display = 'block'
      this.overlay.style.display = 'block'
      if (from == 'attr') {
        this.add.style.display = 'none' //点击attr区图标时不展示输入框
      } else {
        this.add.style.display = 'flex'
        this.input.focus()
      }

      this.renderCommentsHtml(target, from) //获取评论列表

      // 如果是从 toolbar 触发，box 的坐标不参照事件坐标，而是参照文本选区坐标
      if (from == 'toolbar') {
        x = this.selectionX || x
        y = this.selectionY || y
      }
      let p = computeBoxPosition(this.box, x, y)
      this.box.style.left = p.x + 'px'
      this.box.style.top = p.y + 'px'
    }
  }

  /**
   * 创建评论框
   */
  createBox() {
    let fragment = document.createDocumentFragment()
    this.box = document.createElement('div')
    this.box.id = 'lz-comment-box'
    this.list = document.createElement('div')
    this.list.className = 'list'
    this.list.addEventListener('click', async e => this.handleListEvents(e))

    this.add = document.createElement('div')
    this.add.className = 'add'
    this.input = document.createElement('div')
    this.input.setAttribute('contenteditable', true)
    this.input.className = 'input'
    this.input.setAttribute('placeholder', '说点啥呗 ..')
    this.input.setAttribute('spellcheck', false)
    this.input.setAttribute('data-quote-id', '')
    this.input.addEventListener('paste', e => this.handlePaste(e))

    this.btn = document.createElement('div')
    this.btn.className = 'btn'
    this.btn.innerText = '评论'
    this.btn.addEventListener('click', async () => this.submitComment())
    this.add.appendChild(this.input)
    this.add.appendChild(this.btn)

    //遮罩层，用于实现点击空白处关闭评论框
    this.overlay = document.createElement('div')
    this.overlay.className = 'lz-overlay'
    this.overlay.addEventListener('click', () => this.hiddenBox())

    this.box.appendChild(this.list)
    this.box.appendChild(this.add)

    fragment.appendChild(this.box)
    fragment.appendChild(this.overlay)
    document.body.appendChild(fragment)
  }

  /**
   * 关闭评论框
   */
  hiddenBox() {
    if (this.box) {
      this.box.style.display = 'none'
      this.overlay.style.display = 'none'
      this.input.innerText = ''
      this.input.setAttribute('data-quote-id', '')
      this.isShow = false
    }
  }

  /**
   * 往 toolbar 中添加按钮
   * @param {node} protyle 需要添加功能按钮的 protyle editor
   */
  appendToolbarBtn(protyle) {
    if (protyle) {
      // 处理新增的 protyle
      let icon = protyle.querySelector('[data-type="comment"]')
      if (!icon) {
        let toolbar = protyle.querySelector('.protyle-toolbar')
        let fragment = this.createToolbarBtn()
        toolbar.appendChild(fragment)
      }
    } else {
      // 初始化时找到所有 protyle-toolbar
      let toolbars = document.querySelectorAll('.protyle-toolbar')
      if (toolbars) {
        toolbars.forEach((item, index, node) => {
          if (!item.querySelector('[data-type="comment"]')) {
            let fragment = this.createToolbarBtn()
            item.appendChild(fragment)
          }
        })
      }
    }
  }

  /**
   * 创建 toolbar 功能按钮
   * @returns
   */
  createToolbarBtn() {
    let fragment = document.createDocumentFragment()
    let divider = document.createElement('div')
    divider.className = 'protyle-toolbar__divider'
    let btn = document.createElement('button')
    btn.className = 'protyle-toolbar__item b3-tooltips b3-tooltips__n'
    btn.setAttribute('data-type', 'comment')
    btn.setAttribute('aria-label', '评论')
    btn.innerHTML = this.icons.comment
    btn.addEventListener('click', (e) => {
      btn.parentElement.classList.add('fn__none') //关闭 toolbar
      this.showBox(e)
    })
    fragment.appendChild(divider)
    fragment.appendChild(btn)
    return fragment
  }

}

export default Comment
