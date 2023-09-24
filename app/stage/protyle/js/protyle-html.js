class ProtyleHtml extends HTMLElement {
  constructor () {
    super()
    const shadowRoot = this.attachShadow({mode: 'open'})
    this.display = this.shadowRoot
    const dataContent = Lute.UnEscapeHTMLStr(this.getAttribute('data-content'))
    this.display.innerHTML = dataContent
  }

  static get observedAttributes () {
    return ['data-content']
  }

  attributeChangedCallback (name, oldValue, newValue) {
    if (name === 'data-content') {
      const dataContent = Lute.UnEscapeHTMLStr(this.getAttribute('data-content'))
      this.display.innerHTML = dataContent

      const el = document.createElement('div')
      el.innerHTML = dataContent
      const scripts = el.getElementsByTagName('script')
      let fatalHTML = ''
      for (const script of scripts) {
        if (script.textContent.indexOf('document.write') > -1) {
          fatalHTML += `<div style="color:var(--b3-theme-error);font-size: 12px">${window.siyuan.languages.htmlBlockError}</div>
<textarea style="width: 100%;box-sizing: border-box;height: 120px"><script>${script.textContent}</script></textarea>`
        } else {
          const s = document.createElement('script')
          for (const attr of script.attributes) {
            s.setAttribute(attr.name, attr.value);
          }
          s.textContent = script.textContent
          this.display.appendChild(s)
        }
      }
      if (fatalHTML) {
        this.display.innerHTML += fatalHTML
      }
    }
  }
}

customElements.define('protyle-html', ProtyleHtml)
