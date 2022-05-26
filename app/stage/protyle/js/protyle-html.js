class ProtyleHtml extends HTMLElement {
  constructor() {
    super()
    const shadowRoot = this.attachShadow({mode: 'open'})
    this.display = this.shadowRoot
    const dataContent = Lute.UnEscapeHTMLStr(this.getAttribute('data-content'))
    this.display.innerHTML = dataContent
  }

  static get observedAttributes() {
    return ['data-content']
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'data-content') {
      const dataContent = Lute.UnEscapeHTMLStr(this.getAttribute('data-content'))
      this.display.innerHTML = dataContent

      const el = document.createElement('div');
      el.innerHTML = dataContent;
      const scripts = el.getElementsByTagName("script")
      for (let i = 0; i < scripts.length; i++) {
        const s = document.createElement('script');
        s.textContent = scripts[i].textContent;
        this.display.appendChild(s);
      }
    }
  }
}

customElements.define('protyle-html', ProtyleHtml)
