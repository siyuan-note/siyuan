/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { FindState } from './pdf_find_controller.js'

const MATCHES_COUNT_LIMIT = 1000

/**
 * Creates a "search bar" given a set of DOM elements that act as controls
 * for searching or for setting search preferences in the UI. This object
 * also sets up the appropriate events for the controls. Actual searching
 * is done by PDFFindController.
 */
class PDFFindBar {
  constructor (options, eventBus, l10n) {
    this.opened = false

    this.bar = options.bar
    this.toggleButton = options.toggleButton
    this.findField = options.findField
    this.highlightAll = options.highlightAllCheckbox
    this.caseSensitive = options.caseSensitiveCheckbox
    this.matchDiacritics = options.matchDiacriticsCheckbox
    this.entireWord = options.entireWordCheckbox
    this.findMsg = options.findMsg
    this.findResultsCount = options.findResultsCount
    this.findPreviousButton = options.findPreviousButton
    this.findNextButton = options.findNextButton
    this.eventBus = eventBus
    this.l10n = l10n

    // Add event listeners to the DOM elements.
    this.toggleButton.addEventListener('click', () => {
      this.toggle()
    })

    this.findField.addEventListener('input', () => {
      this.dispatchEvent('')
    })

    this.bar.addEventListener('keydown', e => {
      switch (e.keyCode) {
        case 13: // Enter
          if (e.target === this.findField) {
            this.dispatchEvent('again', e.shiftKey)
          }
          break
        case 27: // Escape
          this.close()
          break
      }
    })

    this.findPreviousButton.addEventListener('click', () => {
      this.dispatchEvent('again', true)
    })

    this.findNextButton.addEventListener('click', () => {
      this.dispatchEvent('again', false)
    })

    this.highlightAll.addEventListener('click', () => {
      this.dispatchEvent('highlightallchange')
      // NOTE: 以下三个相同 https://github.com/siyuan-note/siyuan/issues/5338
      if (this.highlightAll.checked) {
        this.highlightAll.parentElement.classList.remove("b3-button--outline")
      } else {
        this.highlightAll.parentElement.classList.add("b3-button--outline")
      }
    })

    this.caseSensitive.addEventListener('click', () => {
      this.dispatchEvent('casesensitivitychange')
      if (this.caseSensitive.checked) {
        this.caseSensitive.parentElement.classList.remove("b3-button--outline")
      } else {
        this.caseSensitive.parentElement.classList.add("b3-button--outline")
      }
    })

    this.entireWord.addEventListener('click', () => {
      this.dispatchEvent('entirewordchange')
      if (this.entireWord.checked) {
        this.entireWord.parentElement.classList.remove("b3-button--outline")
      } else {
        this.entireWord.parentElement.classList.add("b3-button--outline")
      }
    })

    this.matchDiacritics.addEventListener('click', () => {
      this.dispatchEvent('diacriticmatchingchange')
      if (this.matchDiacritics.checked) {
        this.matchDiacritics.parentElement.classList.remove("b3-button--outline")
      } else {
        this.matchDiacritics.parentElement.classList.add("b3-button--outline")
      }
    })

    this.eventBus._on('resize', this.#adjustWidth.bind(this))
  }

  reset () {
    this.updateUIState()
  }

  dispatchEvent (type, findPrev = false) {
    this.eventBus.dispatch('find', {
      source: this,
      type,
      query: this.findField.value,
      phraseSearch: true,
      caseSensitive: this.caseSensitive.checked,
      entireWord: this.entireWord.checked,
      highlightAll: this.highlightAll.checked,
      findPrevious: findPrev,
      matchDiacritics: this.matchDiacritics.checked,
    })
  }

  updateUIState (state, previous, matchesCount) {
    let findMsg = ''
    let status = ''

    switch (state) {
      case FindState.FOUND:
        break
      case FindState.PENDING:
        status = 'pending'
        break
      case FindState.NOT_FOUND:
        findMsg = window.siyuan.languages.find_not_found
        status = 'notFound'
        break
      case FindState.WRAPPED:
        findMsg = window.siyuan.languages.find_not_found[`find_reached_${previous
          ? 'top'
          : 'bottom'}`]
        break
    }
    this.findField.setAttribute('data-status', status)

    this.findMsg.textContent = findMsg
    this.#adjustWidth()
    this.updateResultsCount(matchesCount)
  }

  updateResultsCount ({current = 0, total = 0} = {}) {
    const limit = MATCHES_COUNT_LIMIT
    let msg = ''

    if (total > 0) {
      if (total > limit) {
        msg = window.siyuan.languages.find_match_count_limit.replace(
          '{{limit}}', limit)
      } else {
        msg = window.siyuan.languages.find_match_count.replace('{{current}}',
          current).replace('{{total}}', total)
      }
    }
    this.findResultsCount.textContent = msg
    this.findResultsCount.classList.toggle('fn__hidden', !total)
    this.#adjustWidth()
  }

  open () {
    if (!this.opened) {
      this.opened = true
      this.toggleButton.classList.add('toggled')
      this.toggleButton.setAttribute('aria-expanded', 'true')
      this.bar.classList.remove('fn__hidden')
    }
    this.findField.select()
    this.findField.focus()

    this.#adjustWidth()
  }

  close () {
    if (!this.opened) {
      return
    }
    this.opened = false
    this.toggleButton.classList.remove('toggled')
    this.toggleButton.setAttribute('aria-expanded', 'false')
    this.bar.classList.add('fn__hidden')

    this.eventBus.dispatch('findbarclose', {source: this})
  }

  toggle () {
    if (this.opened) {
      this.close()
    } else {
      this.open()
    }
  }

  #adjustWidth () {
    if (!this.opened) {
      return
    }

    // The find bar has an absolute position and thus the browser extends
    // its width to the maximum possible width once the find bar does not fit
    // entirely within the window anymore (and its elements are automatically
    // wrapped). Here we detect and fix that.
    this.bar.classList.remove('wrapContainers')

    const findbarHeight = this.bar.clientHeight
    const inputContainerHeight = this.bar.firstElementChild.clientHeight

    if (findbarHeight > inputContainerHeight) {
      // The findbar is taller than the input container, which means that
      // the browser wrapped some of the elements. For a consistent look,
      // wrap all of them to adjust the width of the find bar.
      this.bar.classList.add('wrapContainers')
    }
  }
}

export { PDFFindBar }
