/*!
 * Viewer.js v1.10.4
 * https://fengyuanchen.github.io/viewerjs
 *
 * Copyright 2015-present Chen Fengyuan
 * Released under the MIT license
 *
 * Date: 2022-02-13T08:40:00.127Z
 */

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? module.exports = factory()
    : typeof define === 'function' && define.amd
      ? define(factory)
      : (global = typeof globalThis !== 'undefined' ? globalThis : global ||
        self, global.Viewer = factory())
})(this, (function () {
  'use strict'

  function ownKeys (object, enumerableOnly) {
    var keys = Object.keys(object)

    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object)
      enumerableOnly && (symbols = symbols.filter(function (sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable
      })), keys.push.apply(keys, symbols)
    }

    return keys
  }

  function _objectSpread2 (target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {}
      i % 2 ? ownKeys(Object(source), !0).forEach(function (key) {
        _defineProperty(target, key, source[key])
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target,
        Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).
        forEach(function (key) {
          Object.defineProperty(target, key,
            Object.getOwnPropertyDescriptor(source, key))
        })
    }

    return target
  }

  function _typeof (obj) {
    '@babel/helpers - typeof'

    return _typeof = 'function' == typeof Symbol && 'symbol' ==
    typeof Symbol.iterator ? function (obj) {
      return typeof obj
    } : function (obj) {
      return obj && 'function' == typeof Symbol && obj.constructor === Symbol &&
      obj !== Symbol.prototype ? 'symbol' : typeof obj
    }, _typeof(obj)
  }

  function _classCallCheck (instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError('Cannot call a class as a function')
    }
  }

  function _defineProperties (target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i]
      descriptor.enumerable = descriptor.enumerable || false
      descriptor.configurable = true
      if ('value' in descriptor) descriptor.writable = true
      Object.defineProperty(target, descriptor.key, descriptor)
    }
  }

  function _createClass (Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps)
    if (staticProps) _defineProperties(Constructor, staticProps)
    Object.defineProperty(Constructor, 'prototype', {
      writable: false,
    })
    return Constructor
  }

  function _defineProperty (obj, key, value) {
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value: value, enumerable: true, configurable: true, writable: true,
      })
    } else {
      obj[key] = value
    }

    return obj
  }

  var DEFAULTS = {
    /**
     * Enable a modal backdrop, specify `static` for a backdrop
     * which doesn't close the modal on click.
     * @type {boolean}
     */
    backdrop: true,

    /**
     * Show the button on the top-right of the viewer.
     * @type {boolean}
     */
    button: true,

    /**
     * Show the navbar.
     * @type {boolean | number}
     */
    navbar: true,

    /**
     * Specify the visibility and the content of the title.
     * @type {boolean | number | Function | Array}
     */
    title: true,

    /**
     * Show the toolbar.
     * @type {boolean | number | Object}
     */
    toolbar: true,

    /**
     * Custom class name(s) to add to the viewer's root element.
     * @type {string}
     */
    className: '',

    /**
     * Define where to put the viewer in modal mode.
     * @type {string | Element}
     */
    container: 'body',

    /**
     * Filter the images for viewing. Return true if the image is viewable.
     * @type {Function}
     */
    filter: null,

    /**
     * Enable to request fullscreen when play.
     * {@link https://developer.mozilla.org/en-US/docs/Web/API/FullscreenOptions}
     * @type {boolean|FullscreenOptions}
     */
    fullscreen: true,

    /**
     * Define the extra attributes to inherit from the original image.
     * @type {Array}
     */
    inheritedAttributes: [
      'crossOrigin',
      'decoding',
      'isMap',
      'loading',
      'referrerPolicy',
      'sizes',
      'srcset',
      'useMap'],

    /**
     * Define the initial index of image for viewing.
     * @type {number}
     */
    initialViewIndex: 0,

    /**
     * Enable inline mode.
     * @type {boolean}
     */
    inline: false,

    /**
     * The amount of time to delay between automatically cycling an image when playing.
     * @type {number}
     */
    interval: 5000,

    /**
     * Enable keyboard support.
     * @type {boolean}
     */
    keyboard: true,

    /**
     * Focus the viewer when initialized.
     * @type {boolean}
     */
    focus: true,

    /**
     * Indicate if show a loading spinner when load image or not.
     * @type {boolean}
     */
    loading: true,

    /**
     * Indicate if enable loop viewing or not.
     * @type {boolean}
     */
    loop: true,

    /**
     * Min width of the viewer in inline mode.
     * @type {number}
     */
    minWidth: 200,

    /**
     * Min height of the viewer in inline mode.
     * @type {number}
     */
    minHeight: 100,

    /**
     * Enable to move the image.
     * @type {boolean}
     */
    movable: true,

    /**
     * Enable to rotate the image.
     * @type {boolean}
     */
    rotatable: true,

    /**
     * Enable to scale the image.
     * @type {boolean}
     */
    scalable: true,

    /**
     * Enable to zoom the image.
     * @type {boolean}
     */
    zoomable: true,

    /**
     * Enable to zoom the current image by dragging on the touch screen.
     * @type {boolean}
     */
    zoomOnTouch: true,

    /**
     * Enable to zoom the image by wheeling mouse.
     * @type {boolean}
     */
    zoomOnWheel: true,

    /**
     * Enable to slide to the next or previous image by swiping on the touch screen.
     * @type {boolean}
     */
    slideOnTouch: true,

    /**
     * Indicate if toggle the image size between its natural size
     * and initial size when double click on the image or not.
     * @type {boolean}
     */
    toggleOnDblclick: true,

    /**
     * Show the tooltip with image ratio (percentage) when zoom in or zoom out.
     * @type {boolean}
     */
    tooltip: true,

    /**
     * Enable CSS3 Transition for some special elements.
     * @type {boolean}
     */
    transition: true,

    /**
     * Define the CSS `z-index` value of viewer in modal mode.
     * @type {number}
     */
    zIndex: 2015,

    /**
     * Define the CSS `z-index` value of viewer in inline mode.
     * @type {number}
     */
    zIndexInline: 0,

    /**
     * Define the ratio when zoom the image by wheeling mouse.
     * @type {number}
     */
    zoomRatio: 0.1,

    /**
     * Define the min ratio of the image when zoom out.
     * @type {number}
     */
    minZoomRatio: 0.01,

    /**
     * Define the max ratio of the image when zoom in.
     * @type {number}
     */
    maxZoomRatio: 100,

    /**
     * Define where to get the original image URL for viewing.
     * @type {string | Function}
     */
    url: 'src',

    /**
     * Event shortcuts.
     * @type {Function}
     */
    ready: null,
    show: null,
    shown: null,
    hide: null,
    hidden: null,
    view: null,
    viewed: null,
    move: null,
    moved: null,
    rotate: null,
    rotated: null,
    scale: null,
    scaled: null,
    zoom: null,
    zoomed: null,
    play: null,
    stop: null,
  }

  var TEMPLATE = '<div class="viewer-container" tabindex="-1" touch-action="none">' +
    '<div class="viewer-canvas"></div>' + '<div class="viewer-footer">' +
    '<div class="viewer-title"></div>' + '<div class="viewer-toolbar"></div>' +
    '<div class="viewer-navbar">' +
    '<ul class="viewer-list" role="navigation"></ul>' + '</div>' + '</div>' +
    '<div class="viewer-tooltip" role="alert" aria-hidden="true"></div>' +
    '<div class="viewer-button" data-viewer-action="mix" role="button"></div>' +
    '<div class="viewer-player"></div>' + '</div>'

  var IS_BROWSER = typeof window !== 'undefined' && typeof window.document !==
    'undefined'
  var WINDOW = IS_BROWSER ? window : {}
  var IS_TOUCH_DEVICE = IS_BROWSER && WINDOW.document.documentElement
    ? 'ontouchstart' in WINDOW.document.documentElement
    : false
  var HAS_POINTER_EVENT = IS_BROWSER ? 'PointerEvent' in WINDOW : false
  var NAMESPACE = 'viewer' // Actions

  var ACTION_MOVE = 'move'
  var ACTION_SWITCH = 'switch'
  var ACTION_ZOOM = 'zoom' // Classes

  var CLASS_ACTIVE = ''.concat(NAMESPACE, '-active')
  var CLASS_CLOSE = ''.concat(NAMESPACE, '-close')
  var CLASS_FADE = ''.concat(NAMESPACE, '-fade')
  var CLASS_FIXED = ''.concat(NAMESPACE, '-fixed')
  var CLASS_FULLSCREEN = ''.concat(NAMESPACE, '-fullscreen')
  var CLASS_FULLSCREEN_EXIT = ''.concat(NAMESPACE, '-fullscreen-exit')
  var CLASS_HIDE = ''.concat(NAMESPACE, '-hide')
  var CLASS_HIDE_MD_DOWN = ''.concat(NAMESPACE, '-hide-md-down')
  var CLASS_HIDE_SM_DOWN = ''.concat(NAMESPACE, '-hide-sm-down')
  var CLASS_HIDE_XS_DOWN = ''.concat(NAMESPACE, '-hide-xs-down')
  var CLASS_IN = ''.concat(NAMESPACE, '-in')
  var CLASS_INVISIBLE = ''.concat(NAMESPACE, '-invisible')
  var CLASS_LOADING = ''.concat(NAMESPACE, '-loading')
  var CLASS_MOVE = ''.concat(NAMESPACE, '-move')
  var CLASS_OPEN = ''.concat(NAMESPACE, '-open')
  var CLASS_SHOW = ''.concat(NAMESPACE, '-show')
  var CLASS_TRANSITION = ''.concat(NAMESPACE, '-transition') // Native events

  var EVENT_CLICK = 'click'
  var EVENT_DBLCLICK = 'dblclick'
  var EVENT_DRAG_START = 'dragstart'
  var EVENT_FOCUSIN = 'focusin'
  var EVENT_KEY_DOWN = 'keydown'
  var EVENT_LOAD = 'load'
  var EVENT_ERROR = 'error'
  var EVENT_TOUCH_END = IS_TOUCH_DEVICE ? 'touchend touchcancel' : 'mouseup'
  var EVENT_TOUCH_MOVE = IS_TOUCH_DEVICE ? 'touchmove' : 'mousemove'
  var EVENT_TOUCH_START = IS_TOUCH_DEVICE ? 'touchstart' : 'mousedown'
  var EVENT_POINTER_DOWN = HAS_POINTER_EVENT ? 'pointerdown' : EVENT_TOUCH_START
  var EVENT_POINTER_MOVE = HAS_POINTER_EVENT ? 'pointermove' : EVENT_TOUCH_MOVE
  var EVENT_POINTER_UP = HAS_POINTER_EVENT
    ? 'pointerup pointercancel'
    : EVENT_TOUCH_END
  var EVENT_RESIZE = 'resize'
  var EVENT_TRANSITION_END = 'transitionend'
  var EVENT_WHEEL = 'wheel' // Custom events

  var EVENT_READY = 'ready'
  var EVENT_SHOW = 'show'
  var EVENT_SHOWN = 'shown'
  var EVENT_HIDE = 'hide'
  var EVENT_HIDDEN = 'hidden'
  var EVENT_VIEW = 'view'
  var EVENT_VIEWED = 'viewed'
  var EVENT_MOVE = 'move'
  var EVENT_MOVED = 'moved'
  var EVENT_ROTATE = 'rotate'
  var EVENT_ROTATED = 'rotated'
  var EVENT_SCALE = 'scale'
  var EVENT_SCALED = 'scaled'
  var EVENT_ZOOM = 'zoom'
  var EVENT_ZOOMED = 'zoomed'
  var EVENT_PLAY = 'play'
  var EVENT_STOP = 'stop' // Data keys

  var DATA_ACTION = ''.concat(NAMESPACE, 'Action') // RegExps

  var REGEXP_SPACES = /\s\s*/ // Misc

  var BUTTONS = [
    'zoom-in',
    'zoom-out',
    'one-to-one',
    'reset',
    'prev',
    'play',
    'next',
    'rotate-left',
    'rotate-right',
    'flip-horizontal',
    'flip-vertical']

  /**
   * Check if the given value is a string.
   * @param {*} value - The value to check.
   * @returns {boolean} Returns `true` if the given value is a string, else `false`.
   */

  function isString (value) {
    return typeof value === 'string'
  }

  /**
   * Check if the given value is not a number.
   */

  var isNaN = Number.isNaN || WINDOW.isNaN

  /**
   * Check if the given value is a number.
   * @param {*} value - The value to check.
   * @returns {boolean} Returns `true` if the given value is a number, else `false`.
   */

  function isNumber (value) {
    return typeof value === 'number' && !isNaN(value)
  }

  /**
   * Check if the given value is undefined.
   * @param {*} value - The value to check.
   * @returns {boolean} Returns `true` if the given value is undefined, else `false`.
   */

  function isUndefined (value) {
    return typeof value === 'undefined'
  }

  /**
   * Check if the given value is an object.
   * @param {*} value - The value to check.
   * @returns {boolean} Returns `true` if the given value is an object, else `false`.
   */

  function isObject (value) {
    return _typeof(value) === 'object' && value !== null
  }

  var hasOwnProperty = Object.prototype.hasOwnProperty

  /**
   * Check if the given value is a plain object.
   * @param {*} value - The value to check.
   * @returns {boolean} Returns `true` if the given value is a plain object, else `false`.
   */

  function isPlainObject (value) {
    if (!isObject(value)) {
      return false
    }

    try {
      var _constructor = value.constructor
      var prototype = _constructor.prototype
      return _constructor && prototype &&
        hasOwnProperty.call(prototype, 'isPrototypeOf')
    } catch (error) {
      return false
    }
  }

  /**
   * Check if the given value is a function.
   * @param {*} value - The value to check.
   * @returns {boolean} Returns `true` if the given value is a function, else `false`.
   */

  function isFunction (value) {
    return typeof value === 'function'
  }

  /**
   * Iterate the given data.
   * @param {*} data - The data to iterate.
   * @param {Function} callback - The process function for each element.
   * @returns {*} The original data.
   */

  function forEach (data, callback) {
    if (data && isFunction(callback)) {
      if (Array.isArray(data) || isNumber(data.length)
        /* array-like */) {
        var length = data.length
        var i

        for (i = 0; i < length; i += 1) {
          if (callback.call(data, data[i], i, data) === false) {
            break
          }
        }
      } else if (isObject(data)) {
        Object.keys(data).forEach(function (key) {
          callback.call(data, data[key], key, data)
        })
      }
    }

    return data
  }

  /**
   * Extend the given object.
   * @param {*} obj - The object to be extended.
   * @param {*} args - The rest objects which will be merged to the first object.
   * @returns {Object} The extended object.
   */

  var assign = Object.assign || function assign (obj) {
    for (var _len = arguments.length, args = new Array(
      _len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
      args[_key - 1] = arguments[_key]
    }

    if (isObject(obj) && args.length > 0) {
      args.forEach(function (arg) {
        if (isObject(arg)) {
          Object.keys(arg).forEach(function (key) {
            obj[key] = arg[key]
          })
        }
      })
    }

    return obj
  }
  var REGEXP_SUFFIX = /^(?:width|height|left|top|marginLeft|marginTop)$/

  /**
   * Apply styles to the given element.
   * @param {Element} element - The target element.
   * @param {Object} styles - The styles for applying.
   */

  function setStyle (element, styles) {
    var style = element.style
    forEach(styles, function (value, property) {
      if (REGEXP_SUFFIX.test(property) && isNumber(value)) {
        value += 'px'
      }

      style[property] = value
    })
  }

  /**
   * Escape a string for using in HTML.
   * @param {String} value - The string to escape.
   * @returns {String} Returns the escaped string.
   */

  function escapeHTMLEntities (value) {
    return isString(value) ? value.replace(/&(?!amp;|quot;|#39;|lt;|gt;)/g,
      '&amp;').
      replace(/"/g, '&quot;').
      replace(/'/g, '&#39;').
      replace(/</g, '&lt;').
      replace(/>/g, '&gt;') : value
  }

  /**
   * Check if the given element has a special class.
   * @param {Element} element - The element to check.
   * @param {string} value - The class to search.
   * @returns {boolean} Returns `true` if the special class was found.
   */

  function hasClass (element, value) {
    if (!element || !value) {
      return false
    }

    return element.classList
      ? element.classList.contains(value)
      : element.className.indexOf(value) > -1
  }

  /**
   * Add classes to the given element.
   * @param {Element} element - The target element.
   * @param {string} value - The classes to be added.
   */

  function addClass (element, value) {
    if (!element || !value) {
      return
    }

    if (isNumber(element.length)) {
      forEach(element, function (elem) {
        addClass(elem, value)
      })
      return
    }

    if (element.classList) {
      element.classList.add(value)
      return
    }

    var className = element.className.trim()

    if (!className) {
      element.className = value
    } else if (className.indexOf(value) < 0) {
      element.className = ''.concat(className, ' ').concat(value)
    }
  }

  /**
   * Remove classes from the given element.
   * @param {Element} element - The target element.
   * @param {string} value - The classes to be removed.
   */

  function removeClass (element, value) {
    if (!element || !value) {
      return
    }

    if (isNumber(element.length)) {
      forEach(element, function (elem) {
        removeClass(elem, value)
      })
      return
    }

    if (element.classList) {
      element.classList.remove(value)
      return
    }

    if (element.className.indexOf(value) >= 0) {
      element.className = element.className.replace(value, '')
    }
  }

  /**
   * Add or remove classes from the given element.
   * @param {Element} element - The target element.
   * @param {string} value - The classes to be toggled.
   * @param {boolean} added - Add only.
   */

  function toggleClass (element, value, added) {
    if (!value) {
      return
    }

    if (isNumber(element.length)) {
      forEach(element, function (elem) {
        toggleClass(elem, value, added)
      })
      return
    } // IE10-11 doesn't support the second parameter of `classList.toggle`

    if (added) {
      addClass(element, value)
    } else {
      removeClass(element, value)
    }
  }

  var REGEXP_HYPHENATE = /([a-z\d])([A-Z])/g

  /**
   * Transform the given string from camelCase to kebab-case
   * @param {string} value - The value to transform.
   * @returns {string} The transformed value.
   */

  function hyphenate (value) {
    return value.replace(REGEXP_HYPHENATE, '$1-$2').toLowerCase()
  }

  /**
   * Get data from the given element.
   * @param {Element} element - The target element.
   * @param {string} name - The data key to get.
   * @returns {string} The data value.
   */

  function getData (element, name) {
    if (isObject(element[name])) {
      return element[name]
    }

    if (element.dataset) {
      return element.dataset[name]
    }

    return element.getAttribute('data-'.concat(hyphenate(name)))
  }

  /**
   * Set data to the given element.
   * @param {Element} element - The target element.
   * @param {string} name - The data key to set.
   * @param {string} data - The data value.
   */

  function setData (element, name, data) {
    if (isObject(data)) {
      element[name] = data
    } else if (element.dataset) {
      element.dataset[name] = data
    } else {
      element.setAttribute('data-'.concat(hyphenate(name)), data)
    }
  }

  var onceSupported = function () {
    var supported = false

    if (IS_BROWSER) {
      var once = false

      var listener = function listener () {}

      var options = Object.defineProperty({}, 'once', {
        get: function get () {
          supported = true
          return once
        },

        /**
         * This setter can fix a `TypeError` in strict mode
         * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Getter_only}
         * @param {boolean} value - The value to set
         */
        set: function set (value) {
          once = value
        },
      })
      WINDOW.addEventListener('test', listener, options)
      WINDOW.removeEventListener('test', listener, options)
    }

    return supported
  }()

  /**
   * Remove event listener from the target element.
   * @param {Element} element - The event target.
   * @param {string} type - The event type(s).
   * @param {Function} listener - The event listener.
   * @param {Object} options - The event options.
   */


  function removeListener (element, type, listener) {
    var options = arguments.length > 3 && arguments[3] !== undefined
      ? arguments[3]
      : {}
    var handler = listener
    type.trim().split(REGEXP_SPACES).forEach(function (event) {
      if (!onceSupported) {
        var listeners = element.listeners

        if (listeners && listeners[event] && listeners[event][listener]) {
          handler = listeners[event][listener]
          delete listeners[event][listener]

          if (Object.keys(listeners[event]).length === 0) {
            delete listeners[event]
          }

          if (Object.keys(listeners).length === 0) {
            delete element.listeners
          }
        }
      }

      element.removeEventListener(event, handler, options)
    })
  }

  /**
   * Add event listener to the target element.
   * @param {Element} element - The event target.
   * @param {string} type - The event type(s).
   * @param {Function} listener - The event listener.
   * @param {Object} options - The event options.
   */

  function addListener (element, type, listener) {
    var options = arguments.length > 3 && arguments[3] !== undefined
      ? arguments[3]
      : {}
    var _handler = listener
    type.trim().split(REGEXP_SPACES).forEach(function (event) {
      if (options.once && !onceSupported) {
        var _element$listeners = element.listeners,
          listeners = _element$listeners === void 0 ? {} : _element$listeners

        _handler = function handler () {
          delete listeners[event][listener]
          element.removeEventListener(event, _handler, options)

          for (var _len2 = arguments.length, args = new Array(
            _len2), _key2 = 0; _key2 < _len2; _key2++) {
            args[_key2] = arguments[_key2]
          }

          listener.apply(element, args)
        }

        if (!listeners[event]) {
          listeners[event] = {}
        }

        if (listeners[event][listener]) {
          element.removeEventListener(event, listeners[event][listener],
            options)
        }

        listeners[event][listener] = _handler
        element.listeners = listeners
      }

      element.addEventListener(event, _handler, options)
    })
  }

  /**
   * Dispatch event on the target element.
   * @param {Element} element - The event target.
   * @param {string} type - The event type(s).
   * @param {Object} data - The additional event data.
   * @param {Object} options - The additional event options.
   * @returns {boolean} Indicate if the event is default prevented or not.
   */

  function dispatchEvent (element, type, data, options) {
    var event // Event and CustomEvent on IE9-11 are global objects, not constructors

    if (isFunction(Event) && isFunction(CustomEvent)) {
      event = new CustomEvent(type, _objectSpread2({
        bubbles: true, cancelable: true, detail: data,
      }, options))
    } else {
      event = document.createEvent('CustomEvent')
      event.initCustomEvent(type, true, true, data)
    }

    return element.dispatchEvent(event)
  }

  /**
   * Get the offset base on the document.
   * @param {Element} element - The target element.
   * @returns {Object} The offset data.
   */

  function getOffset (element) {
    var box = element.getBoundingClientRect()
    return {
      left: box.left +
        (window.pageXOffset - document.documentElement.clientLeft),
      top: box.top + (window.pageYOffset - document.documentElement.clientTop),
    }
  }

  /**
   * Get transforms base on the given object.
   * @param {Object} obj - The target object.
   * @returns {string} A string contains transform values.
   */

  function getTransforms (_ref) {
    var rotate = _ref.rotate, scaleX = _ref.scaleX, scaleY = _ref.scaleY,
      translateX = _ref.translateX, translateY = _ref.translateY
    var values = []

    if (isNumber(translateX) && translateX !== 0) {
      values.push('translateX('.concat(translateX, 'px)'))
    }

    if (isNumber(translateY) && translateY !== 0) {
      values.push('translateY('.concat(translateY, 'px)'))
    } // Rotate should come first before scale to match orientation transform

    if (isNumber(rotate) && rotate !== 0) {
      values.push('rotate('.concat(rotate, 'deg)'))
    }

    if (isNumber(scaleX) && scaleX !== 1) {
      values.push('scaleX('.concat(scaleX, ')'))
    }

    if (isNumber(scaleY) && scaleY !== 1) {
      values.push('scaleY('.concat(scaleY, ')'))
    }

    var transform = values.length ? values.join(' ') : 'none'
    return {
      WebkitTransform: transform, msTransform: transform, transform: transform,
    }
  }

  /**
   * Get an image name from an image url.
   * @param {string} url - The target url.
   * @example
   * // picture.jpg
   * getImageNameFromURL('https://domain.com/path/to/picture.jpg?size=1280×960')
   * @returns {string} A string contains the image name.
   */

  function getImageNameFromURL (url) {
    return isString(url) ? decodeURIComponent(
      url.replace(/^.*\//, '').replace(/[?&#].*$/, '')) : ''
  }

  var IS_SAFARI = WINDOW.navigator &&
    /(Macintosh|iPhone|iPod|iPad).*AppleWebKit/i.test(
      WINDOW.navigator.userAgent)

  /**
   * Get an image's natural sizes.
   * @param {string} image - The target image.
   * @param {Object} options - The viewer options.
   * @param {Function} callback - The callback function.
   * @returns {HTMLImageElement} The new image.
   */

  function getImageNaturalSizes (image, options, callback) {
    var newImage = document.createElement('img') // Modern browsers (except Safari)

    if (image.naturalWidth && !IS_SAFARI) {
      callback(image.naturalWidth, image.naturalHeight)
      return newImage
    }

    var body = document.body || document.documentElement

    newImage.onload = function () {
      callback(newImage.width, newImage.height)

      if (!IS_SAFARI) {
        body.removeChild(newImage)
      }
    }

    forEach(options.inheritedAttributes, function (name) {
      var value = image.getAttribute(name)

      if (value !== null) {
        newImage.setAttribute(name, value)
      }
    })
    newImage.src = image.src // iOS Safari will convert the image automatically
    // with its orientation once append it into DOM

    if (!IS_SAFARI) {
      newImage.style.cssText = 'left:0;' + 'max-height:none!important;' +
        'max-width:none!important;' + 'min-height:0!important;' +
        'min-width:0!important;' + 'opacity:0;' + 'position:absolute;' +
        'top:0;' + 'z-index:-1;'
      body.appendChild(newImage)
    }

    return newImage
  }

  /**
   * Get the related class name of a responsive type number.
   * @param {string} type - The responsive type.
   * @returns {string} The related class name.
   */

  function getResponsiveClass (type) {
    switch (type) {
      case 2:
        return CLASS_HIDE_XS_DOWN

      case 3:
        return CLASS_HIDE_SM_DOWN

      case 4:
        return CLASS_HIDE_MD_DOWN

      default:
        return ''
    }
  }

  /**
   * Get the max ratio of a group of pointers.
   * @param {string} pointers - The target pointers.
   * @returns {number} The result ratio.
   */

  function getMaxZoomRatio (pointers) {
    var pointers2 = _objectSpread2({}, pointers)

    var ratios = []
    forEach(pointers, function (pointer, pointerId) {
      delete pointers2[pointerId]
      forEach(pointers2, function (pointer2) {
        var x1 = Math.abs(pointer.startX - pointer2.startX)
        var y1 = Math.abs(pointer.startY - pointer2.startY)
        var x2 = Math.abs(pointer.endX - pointer2.endX)
        var y2 = Math.abs(pointer.endY - pointer2.endY)
        var z1 = Math.sqrt(x1 * x1 + y1 * y1)
        var z2 = Math.sqrt(x2 * x2 + y2 * y2)
        var ratio = (z2 - z1) / z1
        ratios.push(ratio)
      })
    })
    ratios.sort(function (a, b) {
      return Math.abs(a) < Math.abs(b)
    })
    return ratios[0]
  }

  /**
   * Get a pointer from an event object.
   * @param {Object} event - The target event object.
   * @param {boolean} endOnly - Indicates if only returns the end point coordinate or not.
   * @returns {Object} The result pointer contains start and/or end point coordinates.
   */

  function getPointer (_ref2, endOnly) {
    var pageX = _ref2.pageX, pageY = _ref2.pageY
    var end = {
      endX: pageX, endY: pageY,
    }
    return endOnly ? end : _objectSpread2({
      timeStamp: Date.now(), startX: pageX, startY: pageY,
    }, end)
  }

  /**
   * Get the center point coordinate of a group of pointers.
   * @param {Object} pointers - The target pointers.
   * @returns {Object} The center point coordinate.
   */

  function getPointersCenter (pointers) {
    var pageX = 0
    var pageY = 0
    var count = 0
    forEach(pointers, function (_ref3) {
      var startX = _ref3.startX, startY = _ref3.startY
      pageX += startX
      pageY += startY
      count += 1
    })
    pageX /= count
    pageY /= count
    return {
      pageX: pageX, pageY: pageY,
    }
  }

  var render = {
    render: function render () {
      this.initContainer()
      this.initViewer()
      this.initList()
      this.renderViewer()
    }, initBody: function initBody () {
      var ownerDocument = this.element.ownerDocument
      var body = ownerDocument.body || ownerDocument.documentElement
      this.body = body
      this.scrollbarWidth = window.innerWidth -
        ownerDocument.documentElement.clientWidth
      this.initialBodyPaddingRight = body.style.paddingRight
      this.initialBodyComputedPaddingRight = window.getComputedStyle(
        body).paddingRight
    }, initContainer: function initContainer () {
      this.containerData = {
        width: window.innerWidth, height: window.innerHeight,
      }
    }, initViewer: function initViewer () {
      var options = this.options, parent = this.parent
      var viewerData

      if (options.inline) {
        viewerData = {
          width: Math.max(parent.offsetWidth, options.minWidth),
          height: Math.max(parent.offsetHeight, options.minHeight),
        }
        this.parentData = viewerData
      }

      if (this.fulled || !viewerData) {
        viewerData = this.containerData
      }

      this.viewerData = assign({}, viewerData)
    }, renderViewer: function renderViewer () {
      if (this.options.inline && !this.fulled) {
        setStyle(this.viewer, this.viewerData)
      }
    }, initList: function initList () {
      var _this = this

      var element = this.element, options = this.options, list = this.list
      var items = [] // initList may be called in this.update, so should keep idempotent

      list.innerHTML = ''
      forEach(this.images, function (image, index) {
        var src = image.src
        var alt = image.alt || getImageNameFromURL(src)

        var url = _this.getImageURL(image)

        if (src || url) {
          var item = document.createElement('li')
          var img = document.createElement('img')
          forEach(options.inheritedAttributes, function (name) {
            var value = image.getAttribute(name)

            if (value !== null) {
              img.setAttribute(name, value)
            }
          })
          img.src = src || url
          img.alt = alt
          img.setAttribute('data-original-url', url || src)
          item.setAttribute('data-index', index)
          item.setAttribute('data-viewer-action', 'view')
          item.setAttribute('role', 'button')

          if (options.keyboard) {
            item.setAttribute('tabindex', 0)
          }

          item.appendChild(img)
          list.appendChild(item)
          items.push(item)
        }
      })
      this.items = items
      forEach(items, function (item) {
        var image = item.firstElementChild
        var onLoad
        var onError
        setData(image, 'filled', true)

        if (options.loading) {
          addClass(item, CLASS_LOADING)
        }

        addListener(image, EVENT_LOAD, onLoad = function onLoad (event) {
          removeListener(image, EVENT_ERROR, onError)

          if (options.loading) {
            removeClass(item, CLASS_LOADING)
          }

          _this.loadImage(event)
        }, {
          once: true,
        })
        addListener(image, EVENT_ERROR, onError = function onError () {
          removeListener(image, EVENT_LOAD, onLoad)

          if (options.loading) {
            removeClass(item, CLASS_LOADING)
          }
        }, {
          once: true,
        })
      })

      if (options.transition) {
        addListener(element, EVENT_VIEWED, function () {
          addClass(list, CLASS_TRANSITION)
        }, {
          once: true,
        })
      }
    }, renderList: function renderList () {
      var index = this.index
      var item = this.items[index]

      if (!item) {
        return
      }

      var next = item.nextElementSibling
      var gutter = parseInt(window.getComputedStyle(next || item).marginLeft,
        10)
      var offsetWidth = item.offsetWidth
      var outerWidth = offsetWidth + gutter // Place the active item in the center of the screen

      setStyle(this.list, assign({
        width: outerWidth * this.length - gutter,
      }, getTransforms({
        translateX: (this.viewerData.width - offsetWidth) / 2 - outerWidth *
          index,
      })))
    }, resetList: function resetList () {
      var list = this.list
      list.innerHTML = ''
      removeClass(list, CLASS_TRANSITION)
      setStyle(list, getTransforms({
        translateX: 0,
      }))
    }, initImage: function initImage (done) {
      var _this2 = this

      var options = this.options, image = this.image,
        viewerData = this.viewerData
      var footerHeight = this.footer.offsetHeight
      var viewerWidth = viewerData.width
      var viewerHeight = Math.max(viewerData.height - footerHeight,
        footerHeight)
      var oldImageData = this.imageData || {}
      var sizingImage
      this.imageInitializing = {
        abort: function abort () {
          sizingImage.onload = null
        },
      }
      sizingImage = getImageNaturalSizes(image, options,
        function (naturalWidth, naturalHeight) {
          var aspectRatio = naturalWidth / naturalHeight
          var width = viewerWidth
          var height = viewerHeight
          _this2.imageInitializing = false

          if (viewerHeight * aspectRatio > viewerWidth) {
            height = viewerWidth / aspectRatio
          } else {
            width = viewerHeight * aspectRatio
          }

          width = Math.min(width * 0.9, naturalWidth)
          height = Math.min(height * 0.9, naturalHeight)
          var left = (viewerWidth - width) / 2
          var top = (viewerHeight - height) / 2
          var imageData = {
            left: left,
            top: top,
            x: left,
            y: top,
            width: width,
            height: height,
            oldRatio: 1,
            ratio: width / naturalWidth,
            aspectRatio: aspectRatio,
            naturalWidth: naturalWidth,
            naturalHeight: naturalHeight,
          }
          var initialImageData = assign({}, imageData)

          if (options.rotatable) {
            imageData.rotate = oldImageData.rotate || 0
            initialImageData.rotate = 0
          }

          if (options.scalable) {
            imageData.scaleX = oldImageData.scaleX || 1
            imageData.scaleY = oldImageData.scaleY || 1
            initialImageData.scaleX = 1
            initialImageData.scaleY = 1
          }

          _this2.imageData = imageData
          _this2.initialImageData = initialImageData

          if (done) {
            done()
          }
        })
    }, renderImage: function renderImage (done) {
      var _this3 = this

      var image = this.image, imageData = this.imageData
      setStyle(image, assign({
        width: imageData.width,
        height: imageData.height, // XXX: Not to use translateX/Y to avoid image shaking when zooming
        marginLeft: imageData.x,
        marginTop: imageData.y,
      }, getTransforms(imageData)))

      if (done) {
        if ((this.viewing || this.moving || this.rotating || this.scaling ||
            this.zooming) && this.options.transition &&
          hasClass(image, CLASS_TRANSITION)) {
          var onTransitionEnd = function onTransitionEnd () {
            _this3.imageRendering = false
            done()
          }

          this.imageRendering = {
            abort: function abort () {
              removeListener(image, EVENT_TRANSITION_END, onTransitionEnd)
            },
          }
          addListener(image, EVENT_TRANSITION_END, onTransitionEnd, {
            once: true,
          })
        } else {
          done()
        }
      }
    }, resetImage: function resetImage () {
      // this.image only defined after viewed
      if (this.viewing || this.viewed) {
        var image = this.image

        if (this.viewing) {
          this.viewing.abort()
        }

        image.parentNode.removeChild(image)
        this.image = null
      }
    },
  }

  var events = {
    bind: function bind () {
      var options = this.options, viewer = this.viewer, canvas = this.canvas
      var document = this.element.ownerDocument
      addListener(viewer, EVENT_CLICK, this.onClick = this.click.bind(this))
      addListener(viewer, EVENT_DRAG_START,
        this.onDragStart = this.dragstart.bind(this))
      addListener(canvas, EVENT_POINTER_DOWN,
        this.onPointerDown = this.pointerdown.bind(this))
      addListener(document, EVENT_POINTER_MOVE,
        this.onPointerMove = this.pointermove.bind(this))
      addListener(document, EVENT_POINTER_UP,
        this.onPointerUp = this.pointerup.bind(this))
      addListener(document, EVENT_KEY_DOWN,
        this.onKeyDown = this.keydown.bind(this))
      addListener(window, EVENT_RESIZE, this.onResize = this.resize.bind(this))

      if (options.zoomable && options.zoomOnWheel) {
        addListener(viewer, EVENT_WHEEL, this.onWheel = this.wheel.bind(this), {
          passive: false, capture: true,
        })
      }

      if (options.toggleOnDblclick) {
        addListener(canvas, EVENT_DBLCLICK,
          this.onDblclick = this.dblclick.bind(this))
      }
    }, unbind: function unbind () {
      var options = this.options, viewer = this.viewer, canvas = this.canvas
      var document = this.element.ownerDocument
      removeListener(viewer, EVENT_CLICK, this.onClick)
      removeListener(viewer, EVENT_DRAG_START, this.onDragStart)
      removeListener(canvas, EVENT_POINTER_DOWN, this.onPointerDown)
      removeListener(document, EVENT_POINTER_MOVE, this.onPointerMove)
      removeListener(document, EVENT_POINTER_UP, this.onPointerUp)
      removeListener(document, EVENT_KEY_DOWN, this.onKeyDown)
      removeListener(window, EVENT_RESIZE, this.onResize)

      if (options.zoomable && options.zoomOnWheel) {
        removeListener(viewer, EVENT_WHEEL, this.onWheel, {
          passive: false, capture: true,
        })
      }

      if (options.toggleOnDblclick) {
        removeListener(canvas, EVENT_DBLCLICK, this.onDblclick)
      }
    },
  }

  var handlers = {
    click: function click (event) {
      var options = this.options, imageData = this.imageData
      var target = event.target
      var action = getData(target, DATA_ACTION)

      // NOTE: updated by Vanessa
      if (!action &&
        (target.localName === 'svg' || target.localName === 'use')) {
        target = target.localName === 'use'
          ? target.parentElement.parentElement
          : target.parentElement
        action = getData(target, DATA_ACTION)
      }

      if (!action && target.localName === 'img' &&
        target.parentElement.localName === 'li') {
        target = target.parentElement
        action = getData(target, DATA_ACTION)
      } // Cancel the emulated click when the native click event was triggered.

      if (IS_TOUCH_DEVICE && event.isTrusted && target === this.canvas) {
        clearTimeout(this.clickCanvasTimeout)
      }

      switch (action) {
        case 'mix':
          if (this.played) {
            this.stop()
          } else if (options.inline) {
            if (this.fulled) {
              this.exit()
            } else {
              this.full()
            }
          } else {
            this.hide()
          }

          break

        case 'hide':
          this.hide()
          break

        case 'view':
          this.view(getData(target, 'index'))
          break

        case 'zoom-in':
          this.zoom(0.1, true)
          break

        case 'zoom-out':
          this.zoom(-0.1, true)
          break

        case 'one-to-one':
          this.toggle()
          break

        case 'reset':
          this.reset()
          break

        case 'prev':
          this.prev(options.loop)
          break

        case 'play':
          this.play(options.fullscreen)
          break

        case 'next':
          this.next(options.loop)
          break

        case 'rotate-left':
          this.rotate(-90)
          break

        case 'rotate-right':
          this.rotate(90)
          break

        case 'flip-horizontal':
          this.scaleX(-imageData.scaleX || -1)
          break

        case 'flip-vertical':
          this.scaleY(-imageData.scaleY || -1)
          break

        default:
          if (this.played) {
            this.stop()
          }

      }
    }, dblclick: function dblclick (event) {
      event.preventDefault()

      if (this.viewed && event.target === this.image) {
        // Cancel the emulated double click when the native dblclick event was triggered.
        if (IS_TOUCH_DEVICE && event.isTrusted) {
          clearTimeout(this.doubleClickImageTimeout)
        } // XXX: No pageX/Y properties in custom event, fallback to the original event.

        this.toggle(
          event.isTrusted ? event : event.detail && event.detail.originalEvent)
      }
    }, load: function load () {
      var _this = this

      if (this.timeout) {
        clearTimeout(this.timeout)
        this.timeout = false
      }

      var element = this.element, options = this.options, image = this.image,
        index = this.index, viewerData = this.viewerData
      removeClass(image, CLASS_INVISIBLE)

      if (options.loading) {
        removeClass(this.canvas, CLASS_LOADING)
      }

      image.style.cssText = 'height:0;' +
        'margin-left:'.concat(viewerData.width / 2, 'px;') +
        'margin-top:'.concat(viewerData.height / 2, 'px;') +
        'max-width:none!important;' + 'position:relative;' + 'width:0;'
      this.initImage(function () {
        toggleClass(image, CLASS_MOVE, options.movable)
        toggleClass(image, CLASS_TRANSITION, options.transition)

        _this.renderImage(function () {
          _this.viewed = true
          _this.viewing = false

          if (isFunction(options.viewed)) {
            addListener(element, EVENT_VIEWED, options.viewed, {
              once: true,
            })
          }

          dispatchEvent(element, EVENT_VIEWED, {
            originalImage: _this.images[index], index: index, image: image,
          }, {
            cancelable: false,
          })
        })
      })
    }, loadImage: function loadImage (event) {
      var image = event.target
      var parent = image.parentNode
      var parentWidth = parent.offsetWidth || 30
      var parentHeight = parent.offsetHeight || 50
      var filled = !!getData(image, 'filled')
      getImageNaturalSizes(image, this.options,
        function (naturalWidth, naturalHeight) {
          var aspectRatio = naturalWidth / naturalHeight
          var width = parentWidth
          var height = parentHeight

          if (parentHeight * aspectRatio > parentWidth) {
            if (filled) {
              width = parentHeight * aspectRatio
            } else {
              height = parentWidth / aspectRatio
            }
          } else if (filled) {
            height = parentWidth / aspectRatio
          } else {
            width = parentHeight * aspectRatio
          }

          setStyle(image, assign({
            width: width, height: height,
          }, getTransforms({
            translateX: (parentWidth - width) / 2,
            translateY: (parentHeight - height) / 2,
          })))
        })
    }, keydown: function keydown (event) {
      var options = this.options

      if (!options.keyboard) {
        return
      }

      var keyCode = event.keyCode || event.which || event.charCode

      switch (keyCode) {
        // Enter
        case 13:
          if (this.viewer.contains(event.target)) {
            this.click(event)
          }

          break
      }

      if (!this.fulled) {
        return
      }

      switch (keyCode) {
        // Escape
        case 27:
          if (this.played) {
            this.stop()
          } else if (options.inline) {
            if (this.fulled) {
              this.exit()
            }
          } else {
            this.hide()
          }

          break
        // Space

        case 32:
          if (this.played) {
            this.stop()
          }

          break
        // ArrowLeft

        case 37:
          this.prev(options.loop)
          break
        // ArrowUp

        case 38:
          // Prevent scroll on Firefox
          event.preventDefault() // Zoom in

          this.zoom(options.zoomRatio, true)
          break
        // ArrowRight

        case 39:
          this.next(options.loop)
          break
        // ArrowDown

        case 40:
          // Prevent scroll on Firefox
          event.preventDefault() // Zoom out

          this.zoom(-options.zoomRatio, true)
          break
        // Ctrl + 0

        case 48: // Fall through
        // Ctrl + 1
        // eslint-disable-next-line no-fallthrough

        case 49:
          if (event.ctrlKey) {
            event.preventDefault()
            this.toggle()
          }

          break
      }
    }, dragstart: function dragstart (event) {
      if (event.target.localName === 'img') {
        event.preventDefault()
      }
    }, pointerdown: function pointerdown (event) {
      var options = this.options, pointers = this.pointers
      var buttons = event.buttons, button = event.button

      if (!this.viewed || this.showing || this.viewing || this.hiding // Handle mouse event and pointer event and ignore touch event
        || (event.type === 'mousedown' || event.type === 'pointerdown' &&
          event.pointerType === 'mouse') && ( // No primary button (Usually the left button)
          isNumber(buttons) && buttons !== 1 || isNumber(button) && button !== 0 // Open context menu
          || event.ctrlKey)) {
        return
      } // Prevent default behaviours as page zooming in touch devices.

      event.preventDefault()

      if (event.changedTouches) {
        forEach(event.changedTouches, function (touch) {
          pointers[touch.identifier] = getPointer(touch)
        })
      } else {
        pointers[event.pointerId || 0] = getPointer(event)
      }

      var action = options.movable ? ACTION_MOVE : false

      if (options.zoomOnTouch && options.zoomable &&
        Object.keys(pointers).length > 1) {
        action = ACTION_ZOOM
      } else if (options.slideOnTouch &&
        (event.pointerType === 'touch' || event.type === 'touchstart') &&
        this.isSwitchable()) {
        action = ACTION_SWITCH
      }

      if (options.transition &&
        (action === ACTION_MOVE || action === ACTION_ZOOM)) {
        removeClass(this.image, CLASS_TRANSITION)
      }

      this.action = action
    }, pointermove: function pointermove (event) {
      var pointers = this.pointers, action = this.action

      if (!this.viewed || !action) {
        return
      }

      event.preventDefault()

      if (event.changedTouches) {
        forEach(event.changedTouches, function (touch) {
          assign(pointers[touch.identifier] || {}, getPointer(touch, true))
        })
      } else {
        assign(pointers[event.pointerId || 0] || {}, getPointer(event, true))
      }

      this.change(event)
    }, pointerup: function pointerup (event) {
      var _this2 = this

      var options = this.options, action = this.action, pointers = this.pointers
      var pointer

      if (event.changedTouches) {
        forEach(event.changedTouches, function (touch) {
          pointer = pointers[touch.identifier]
          delete pointers[touch.identifier]
        })
      } else {
        pointer = pointers[event.pointerId || 0]
        delete pointers[event.pointerId || 0]
      }

      if (!action) {
        return
      }

      event.preventDefault()

      if (options.transition &&
        (action === ACTION_MOVE || action === ACTION_ZOOM)) {
        addClass(this.image, CLASS_TRANSITION)
      }

      this.action = false // Emulate click and double click in touch devices to support backdrop and image zooming (#210).

      if (IS_TOUCH_DEVICE && action !== ACTION_ZOOM && pointer && Date.now() -
        pointer.timeStamp < 500) {
        clearTimeout(this.clickCanvasTimeout)
        clearTimeout(this.doubleClickImageTimeout)

        if (options.toggleOnDblclick && this.viewed && event.target ===
          this.image) {
          if (this.imageClicked) {
            this.imageClicked = false // This timeout will be cleared later when a native dblclick event is triggering

            this.doubleClickImageTimeout = setTimeout(function () {
              dispatchEvent(_this2.image, EVENT_DBLCLICK, {
                originalEvent: event,
              })
            }, 50)
          } else {
            this.imageClicked = true // The default timing of a double click in Windows is 500 ms

            this.doubleClickImageTimeout = setTimeout(function () {
              _this2.imageClicked = false
            }, 500)
          }
        } else {
          this.imageClicked = false

          if (options.backdrop && options.backdrop !== 'static' &&
            event.target === this.canvas) {
            // This timeout will be cleared later when a native click event is triggering
            this.clickCanvasTimeout = setTimeout(function () {
              dispatchEvent(_this2.canvas, EVENT_CLICK, {
                originalEvent: event,
              })
            }, 50)
          }
        }
      }
    }, resize: function resize () {
      var _this3 = this

      if (!this.isShown || this.hiding) {
        return
      }

      if (this.fulled) {
        this.close()
        this.initBody()
        this.open()
      }

      this.initContainer()
      this.initViewer()
      this.renderViewer()
      this.renderList()

      if (this.viewed) {
        this.initImage(function () {
          _this3.renderImage()
        })
      }

      if (this.played) {
        if (this.options.fullscreen && this.fulled &&
          !(document.fullscreenElement || document.webkitFullscreenElement ||
            document.mozFullScreenElement || document.msFullscreenElement)) {
          this.stop()
          return
        }

        forEach(this.player.getElementsByTagName('img'), function (image) {
          addListener(image, EVENT_LOAD, _this3.loadImage.bind(_this3), {
            once: true,
          })
          dispatchEvent(image, EVENT_LOAD)
        })
      }
    }, wheel: function wheel (event) {
      var _this4 = this

      if (!this.viewed) {
        return
      }

      event.preventDefault() // Limit wheel speed to prevent zoom too fast

      if (this.wheeling) {
        return
      }

      this.wheeling = true
      setTimeout(function () {
        _this4.wheeling = false
      }, 50)
      var ratio = Number(this.options.zoomRatio) || 0.1
      var delta = 1

      if (event.deltaY) {
        delta = event.deltaY > 0 ? 1 : -1
      } else if (event.wheelDelta) {
        delta = -event.wheelDelta / 120
      } else if (event.detail) {
        delta = event.detail > 0 ? 1 : -1
      }

      this.zoom(-delta * ratio, true, event)
    },
  }

  var methods = {
    /** Show the viewer (only available in modal mode)
     * @param {boolean} [immediate=false] - Indicates if show the viewer immediately or not.
     * @returns {Viewer} this
     */
    show: function show () {
      var immediate = arguments.length > 0 && arguments[0] !== undefined
        ? arguments[0]
        : false
      var element = this.element, options = this.options

      if (options.inline || this.showing || this.isShown || this.showing) {
        return this
      }

      if (!this.ready) {
        this.build()

        if (this.ready) {
          this.show(immediate)
        }

        return this
      }

      if (isFunction(options.show)) {
        addListener(element, EVENT_SHOW, options.show, {
          once: true,
        })
      }

      if (dispatchEvent(element, EVENT_SHOW) === false || !this.ready) {
        return this
      }

      if (this.hiding) {
        this.transitioning.abort()
      }

      this.showing = true
      this.open()
      var viewer = this.viewer
      removeClass(viewer, CLASS_HIDE)
      viewer.setAttribute('role', 'dialog')
      viewer.setAttribute('aria-labelledby', this.title.id)
      viewer.setAttribute('aria-modal', true)
      viewer.removeAttribute('aria-hidden')

      if (options.transition && !immediate) {
        var shown = this.shown.bind(this)
        this.transitioning = {
          abort: function abort () {
            removeListener(viewer, EVENT_TRANSITION_END, shown)
            removeClass(viewer, CLASS_IN)
          },
        }
        addClass(viewer, CLASS_TRANSITION) // Force reflow to enable CSS3 transition

        viewer.initialOffsetWidth = viewer.offsetWidth
        addListener(viewer, EVENT_TRANSITION_END, shown, {
          once: true,
        })
        addClass(viewer, CLASS_IN)
      } else {
        addClass(viewer, CLASS_IN)
        this.shown()
      }

      return this
    },

    /**
     * Hide the viewer (only available in modal mode)
     * @param {boolean} [immediate=false] - Indicates if hide the viewer immediately or not.
     * @returns {Viewer} this
     */
    hide: function hide () {
      var _this = this

      var immediate = arguments.length > 0 && arguments[0] !== undefined
        ? arguments[0]
        : false
      var element = this.element, options = this.options

      if (options.inline || this.hiding || !(this.isShown || this.showing)) {
        return this
      }

      if (isFunction(options.hide)) {
        addListener(element, EVENT_HIDE, options.hide, {
          once: true,
        })
      }

      if (dispatchEvent(element, EVENT_HIDE) === false) {
        return this
      }

      if (this.showing) {
        this.transitioning.abort()
      }

      this.hiding = true

      if (this.played) {
        this.stop()
      } else if (this.viewing) {
        this.viewing.abort()
      }

      var viewer = this.viewer, image = this.image

      var hideImmediately = function hideImmediately () {
        removeClass(viewer, CLASS_IN)

        _this.hidden()
      }

      if (options.transition && !immediate) {
        var onViewerTransitionEnd = function onViewerTransitionEnd (event) {
          // Ignore all propagating `transitionend` events (#275).
          if (event && event.target === viewer) {
            removeListener(viewer, EVENT_TRANSITION_END, onViewerTransitionEnd)

            _this.hidden()
          }
        }

        var onImageTransitionEnd = function onImageTransitionEnd () {
          // In case of show the viewer by `viewer.show(true)` previously (#407).
          if (hasClass(viewer, CLASS_TRANSITION)) {
            addListener(viewer, EVENT_TRANSITION_END, onViewerTransitionEnd)
            removeClass(viewer, CLASS_IN)
          } else {
            hideImmediately()
          }
        }

        this.transitioning = {
          abort: function abort () {
            if (_this.viewed && hasClass(image, CLASS_TRANSITION)) {
              removeListener(image, EVENT_TRANSITION_END, onImageTransitionEnd)
            } else if (hasClass(viewer, CLASS_TRANSITION)) {
              removeListener(viewer, EVENT_TRANSITION_END,
                onViewerTransitionEnd)
            }
          },
        } // In case of hiding the viewer when holding on the image (#255),
        // note that the `CLASS_TRANSITION` class will be removed on pointer down.

        if (this.viewed && hasClass(image, CLASS_TRANSITION)) {
          addListener(image, EVENT_TRANSITION_END, onImageTransitionEnd, {
            once: true,
          })
          this.zoomTo(0, false, null, true)
        } else {
          onImageTransitionEnd()
        }
      } else {
        hideImmediately()
      }

      return this
    },

    /**
     * View one of the images with image's index
     * @param {number} index - The index of the image to view.
     * @returns {Viewer} this
     */
    view: function view () {
      var _this2 = this

      var index = arguments.length > 0 && arguments[0] !== undefined
        ? arguments[0]
        : this.options.initialViewIndex
      index = Number(index) || 0

      if (this.hiding || this.played || index < 0 || index >= this.length ||
        this.viewed && index === this.index) {
        return this
      }

      if (!this.isShown) {
        this.index = index
        return this.show()
      }

      if (this.viewing) {
        this.viewing.abort()
      }

      var element = this.element, options = this.options, title = this.title,
        canvas = this.canvas
      var item = this.items[index]
      var img = item.querySelector('img')
      var url = getData(img, 'originalUrl')
      var alt = img.getAttribute('alt')
      var image = document.createElement('img')
      forEach(options.inheritedAttributes, function (name) {
        var value = img.getAttribute(name)

        if (value !== null) {
          image.setAttribute(name, value)
        }
      })
      image.src = url
      image.alt = alt

      if (isFunction(options.view)) {
        addListener(element, EVENT_VIEW, options.view, {
          once: true,
        })
      }

      if (dispatchEvent(element, EVENT_VIEW, {
        originalImage: this.images[index], index: index, image: image,
      }) === false || !this.isShown || this.hiding || this.played) {
        return this
      }

      var activeItem = this.items[this.index]

      if (activeItem) {
        removeClass(activeItem, CLASS_ACTIVE)
        activeItem.removeAttribute('aria-selected')
      }

      addClass(item, CLASS_ACTIVE)
      item.setAttribute('aria-selected', true)

      if (options.focus) {
        item.focus()
      }

      this.image = image
      this.viewed = false
      this.index = index
      this.imageData = {}
      addClass(image, CLASS_INVISIBLE)

      if (options.loading) {
        addClass(canvas, CLASS_LOADING)
      }

      canvas.innerHTML = ''
      canvas.appendChild(image) // Center current item

      this.renderList() // Clear title

      title.innerHTML = '' // Generate title after viewed

      var onViewed = function onViewed () {
        var imageData = _this2.imageData
        var render = Array.isArray(options.title)
          ? options.title[1]
          : options.title
        title.innerHTML = escapeHTMLEntities(isFunction(render)
          ? render.call(_this2, image, imageData)
          : ''.concat(alt, ' (').
            concat(imageData.naturalWidth, ' \xD7 ').
            concat(imageData.naturalHeight, ')'))
      }

      var onLoad
      var onError
      addListener(element, EVENT_VIEWED, onViewed, {
        once: true,
      })
      this.viewing = {
        abort: function abort () {
          removeListener(element, EVENT_VIEWED, onViewed)

          if (image.complete) {
            if (_this2.imageRendering) {
              _this2.imageRendering.abort()
            } else if (_this2.imageInitializing) {
              _this2.imageInitializing.abort()
            }
          } else {
            // Cancel download to save bandwidth.
            image.src = ''
            removeListener(image, EVENT_LOAD, onLoad)

            if (_this2.timeout) {
              clearTimeout(_this2.timeout)
            }
          }
        },
      }

      if (image.complete) {
        this.load()
      } else {
        addListener(image, EVENT_LOAD, onLoad = function onLoad () {
          removeListener(image, EVENT_ERROR, onError)

          _this2.load()
        }, {
          once: true,
        })
        addListener(image, EVENT_ERROR, onError = function onError () {
          removeListener(image, EVENT_LOAD, onLoad)

          if (_this2.timeout) {
            clearTimeout(_this2.timeout)
            _this2.timeout = false
          }

          removeClass(image, CLASS_INVISIBLE)

          if (options.loading) {
            removeClass(_this2.canvas, CLASS_LOADING)
          }
        }, {
          once: true,
        })

        if (this.timeout) {
          clearTimeout(this.timeout)
        } // Make the image visible if it fails to load within 1s

        this.timeout = setTimeout(function () {
          removeClass(image, CLASS_INVISIBLE)
          _this2.timeout = false
        }, 1000)
      }

      return this
    },

    /**
     * View the previous image
     * @param {boolean} [loop=false] - Indicate if view the last one
     * when it is the first one at present.
     * @returns {Viewer} this
     */
    prev: function prev () {
      var loop = arguments.length > 0 && arguments[0] !== undefined
        ? arguments[0]
        : false
      var index = this.index - 1

      if (index < 0) {
        index = loop ? this.length - 1 : 0
      }

      this.view(index)
      return this
    },

    /**
     * View the next image
     * @param {boolean} [loop=false] - Indicate if view the first one
     * when it is the last one at present.
     * @returns {Viewer} this
     */
    next: function next () {
      var loop = arguments.length > 0 && arguments[0] !== undefined
        ? arguments[0]
        : false
      var maxIndex = this.length - 1
      var index = this.index + 1

      if (index > maxIndex) {
        index = loop ? 0 : maxIndex
      }

      this.view(index)
      return this
    },

    /**
     * Move the image with relative offsets.
     * @param {number} x - The moving distance in the horizontal direction.
     * @param {number} [y=x] The moving distance in the vertical direction.
     * @returns {Viewer} this
     */
    move: function move (x) {
      var y = arguments.length > 1 && arguments[1] !== undefined
        ? arguments[1]
        : x
      var imageData = this.imageData
      this.moveTo(isUndefined(x) ? x : imageData.x + Number(x),
        isUndefined(y) ? y : imageData.y + Number(y))
      return this
    },

    /**
     * Move the image to an absolute point.
     * @param {number} x - The new position in the horizontal direction.
     * @param {number} [y=x] - The new position in the vertical direction.
     * @param {Event} [_originalEvent=null] - The original event if any.
     * @returns {Viewer} this
     */
    moveTo: function moveTo (x) {
      var _this3 = this

      var y = arguments.length > 1 && arguments[1] !== undefined
        ? arguments[1]
        : x

      var _originalEvent = arguments.length > 2 && arguments[2] !== undefined
        ? arguments[2]
        : null

      var element = this.element, options = this.options,
        imageData = this.imageData
      x = Number(x)
      y = Number(y)

      if (this.viewed && !this.played && options.movable) {
        var oldX = imageData.x
        var oldY = imageData.y
        var changed = false

        if (isNumber(x)) {
          changed = true
        } else {
          x = oldX
        }

        if (isNumber(y)) {
          changed = true
        } else {
          y = oldY
        }

        if (changed) {
          if (isFunction(options.move)) {
            addListener(element, EVENT_MOVE, options.move, {
              once: true,
            })
          }

          if (dispatchEvent(element, EVENT_MOVE, {
            x: x, y: y, oldX: oldX, oldY: oldY, originalEvent: _originalEvent,
          }) === false) {
            return this
          }

          imageData.x = x
          imageData.y = y
          imageData.left = x
          imageData.top = y
          this.moving = true
          this.renderImage(function () {
            _this3.moving = false

            if (isFunction(options.moved)) {
              addListener(element, EVENT_MOVED, options.moved, {
                once: true,
              })
            }

            dispatchEvent(element, EVENT_MOVED, {
              x: x, y: y, oldX: oldX, oldY: oldY, originalEvent: _originalEvent,
            }, {
              cancelable: false,
            })
          })
        }
      }

      return this
    },

    /**
     * Rotate the image with a relative degree.
     * @param {number} degree - The rotate degree.
     * @returns {Viewer} this
     */
    rotate: function rotate (degree) {
      this.rotateTo((this.imageData.rotate || 0) + Number(degree))
      return this
    },

    /**
     * Rotate the image to an absolute degree.
     * @param {number} degree - The rotate degree.
     * @returns {Viewer} this
     */
    rotateTo: function rotateTo (degree) {
      var _this4 = this

      var element = this.element, options = this.options,
        imageData = this.imageData
      degree = Number(degree)

      if (isNumber(degree) && this.viewed && !this.played &&
        options.rotatable) {
        var oldDegree = imageData.rotate

        if (isFunction(options.rotate)) {
          addListener(element, EVENT_ROTATE, options.rotate, {
            once: true,
          })
        }

        if (dispatchEvent(element, EVENT_ROTATE, {
          degree: degree, oldDegree: oldDegree,
        }) === false) {
          return this
        }

        imageData.rotate = degree
        this.rotating = true
        this.renderImage(function () {
          _this4.rotating = false

          if (isFunction(options.rotated)) {
            addListener(element, EVENT_ROTATED, options.rotated, {
              once: true,
            })
          }

          dispatchEvent(element, EVENT_ROTATED, {
            degree: degree, oldDegree: oldDegree,
          }, {
            cancelable: false,
          })
        })
      }

      return this
    },

    /**
     * Scale the image on the x-axis.
     * @param {number} scaleX - The scale ratio on the x-axis.
     * @returns {Viewer} this
     */
    scaleX: function scaleX (_scaleX) {
      this.scale(_scaleX, this.imageData.scaleY)
      return this
    },

    /**
     * Scale the image on the y-axis.
     * @param {number} scaleY - The scale ratio on the y-axis.
     * @returns {Viewer} this
     */
    scaleY: function scaleY (_scaleY) {
      this.scale(this.imageData.scaleX, _scaleY)
      return this
    },

    /**
     * Scale the image.
     * @param {number} scaleX - The scale ratio on the x-axis.
     * @param {number} [scaleY=scaleX] - The scale ratio on the y-axis.
     * @returns {Viewer} this
     */
    scale: function scale (scaleX) {
      var _this5 = this

      var scaleY = arguments.length > 1 && arguments[1] !== undefined
        ? arguments[1]
        : scaleX
      var element = this.element, options = this.options,
        imageData = this.imageData
      scaleX = Number(scaleX)
      scaleY = Number(scaleY)

      if (this.viewed && !this.played && options.scalable) {
        var oldScaleX = imageData.scaleX
        var oldScaleY = imageData.scaleY
        var changed = false

        if (isNumber(scaleX)) {
          changed = true
        } else {
          scaleX = oldScaleX
        }

        if (isNumber(scaleY)) {
          changed = true
        } else {
          scaleY = oldScaleY
        }

        if (changed) {
          if (isFunction(options.scale)) {
            addListener(element, EVENT_SCALE, options.scale, {
              once: true,
            })
          }

          if (dispatchEvent(element, EVENT_SCALE, {
            scaleX: scaleX,
            scaleY: scaleY,
            oldScaleX: oldScaleX,
            oldScaleY: oldScaleY,
          }) === false) {
            return this
          }

          imageData.scaleX = scaleX
          imageData.scaleY = scaleY
          this.scaling = true
          this.renderImage(function () {
            _this5.scaling = false

            if (isFunction(options.scaled)) {
              addListener(element, EVENT_SCALED, options.scaled, {
                once: true,
              })
            }

            dispatchEvent(element, EVENT_SCALED, {
              scaleX: scaleX,
              scaleY: scaleY,
              oldScaleX: oldScaleX,
              oldScaleY: oldScaleY,
            }, {
              cancelable: false,
            })
          })
        }
      }

      return this
    },

    /**
     * Zoom the image with a relative ratio.
     * @param {number} ratio - The target ratio.
     * @param {boolean} [hasTooltip=false] - Indicates if it has a tooltip or not.
     * @param {Event} [_originalEvent=null] - The original event if any.
     * @returns {Viewer} this
     */
    zoom: function zoom (ratio) {
      var hasTooltip = arguments.length > 1 && arguments[1] !== undefined
        ? arguments[1]
        : false

      var _originalEvent = arguments.length > 2 && arguments[2] !== undefined
        ? arguments[2]
        : null

      var imageData = this.imageData
      ratio = Number(ratio)

      if (ratio < 0) {
        ratio = 1 / (1 - ratio)
      } else {
        ratio = 1 + ratio
      }

      this.zoomTo(imageData.width * ratio / imageData.naturalWidth, hasTooltip,
        _originalEvent)
      return this
    },

    /**
     * Zoom the image to an absolute ratio.
     * @param {number} ratio - The target ratio.
     * @param {boolean} [hasTooltip=false] - Indicates if it has a tooltip or not.
     * @param {Event} [_originalEvent=null] - The original event if any.
     * @param {Event} [_zoomable=false] - Indicates if the current zoom is available or not.
     * @returns {Viewer} this
     */
    zoomTo: function zoomTo (ratio) {
      var _this6 = this

      var hasTooltip = arguments.length > 1 && arguments[1] !== undefined
        ? arguments[1]
        : false

      var _originalEvent = arguments.length > 2 && arguments[2] !== undefined
        ? arguments[2]
        : null

      var _zoomable = arguments.length > 3 && arguments[3] !== undefined
        ? arguments[3]
        : false

      var element = this.element, options = this.options,
        pointers = this.pointers, imageData = this.imageData
      var x = imageData.x, y = imageData.y, width = imageData.width,
        height = imageData.height, naturalWidth = imageData.naturalWidth,
        naturalHeight = imageData.naturalHeight
      ratio = Math.max(0, ratio)

      if (isNumber(ratio) && this.viewed && !this.played &&
        (_zoomable || options.zoomable)) {
        if (!_zoomable) {
          var minZoomRatio = Math.max(0.01, options.minZoomRatio)
          var maxZoomRatio = Math.min(100, options.maxZoomRatio)
          ratio = Math.min(Math.max(ratio, minZoomRatio), maxZoomRatio)
        }

        if (_originalEvent) {
          switch (_originalEvent.type) {
            case 'wheel':
              if (options.zoomRatio >= 0.055 && ratio > 0.95 && ratio < 1.05) {
                ratio = 1
              }

              break

            case 'pointermove':
            case 'touchmove':
            case 'mousemove':
              if (ratio > 0.99 && ratio < 1.01) {
                ratio = 1
              }

              break
          }
        }

        var newWidth = naturalWidth * ratio
        var newHeight = naturalHeight * ratio
        var offsetWidth = newWidth - width
        var offsetHeight = newHeight - height
        var oldRatio = imageData.ratio

        if (isFunction(options.zoom)) {
          addListener(element, EVENT_ZOOM, options.zoom, {
            once: true,
          })
        }

        if (dispatchEvent(element, EVENT_ZOOM, {
          ratio: ratio, oldRatio: oldRatio, originalEvent: _originalEvent,
        }) === false) {
          return this
        }

        this.zooming = true

        if (_originalEvent) {
          var offset = getOffset(this.viewer)
          var center = pointers && Object.keys(pointers).length > 0
            ? getPointersCenter(pointers)
            : {
              pageX: _originalEvent.pageX, pageY: _originalEvent.pageY,
            } // Zoom from the triggering point of the event

          imageData.x -= offsetWidth *
            ((center.pageX - offset.left - x) / width)
          imageData.y -= offsetHeight *
            ((center.pageY - offset.top - y) / height)
        } else {
          // Zoom from the center of the image
          imageData.x -= offsetWidth / 2
          imageData.y -= offsetHeight / 2
        }

        imageData.left = imageData.x
        imageData.top = imageData.y
        imageData.width = newWidth
        imageData.height = newHeight
        imageData.oldRatio = oldRatio
        imageData.ratio = ratio
        this.renderImage(function () {
          _this6.zooming = false

          if (isFunction(options.zoomed)) {
            addListener(element, EVENT_ZOOMED, options.zoomed, {
              once: true,
            })
          }

          dispatchEvent(element, EVENT_ZOOMED, {
            ratio: ratio, oldRatio: oldRatio, originalEvent: _originalEvent,
          }, {
            cancelable: false,
          })
        })

        if (hasTooltip) {
          this.tooltip()
        }
      }

      return this
    },

    /**
     * Play the images
     * @param {boolean|FullscreenOptions} [fullscreen=false] - Indicate if request fullscreen or not.
     * @returns {Viewer} this
     */
    play: function play () {
      var _this7 = this

      var fullscreen = arguments.length > 0 && arguments[0] !== undefined
        ? arguments[0]
        : false

      if (!this.isShown || this.played) {
        return this
      }

      var element = this.element, options = this.options

      if (isFunction(options.play)) {
        addListener(element, EVENT_PLAY, options.play, {
          once: true,
        })
      }

      if (dispatchEvent(element, EVENT_PLAY) === false) {
        return this
      }

      var player = this.player
      var onLoad = this.loadImage.bind(this)
      var list = []
      var total = 0
      var index = 0
      this.played = true
      this.onLoadWhenPlay = onLoad

      if (fullscreen) {
        this.requestFullscreen(fullscreen)
      }

      addClass(player, CLASS_SHOW)
      forEach(this.items, function (item, i) {
        var img = item.querySelector('img')
        var image = document.createElement('img')
        image.src = getData(img, 'originalUrl')
        image.alt = img.getAttribute('alt')
        image.referrerPolicy = img.referrerPolicy
        total += 1
        addClass(image, CLASS_FADE)
        toggleClass(image, CLASS_TRANSITION, options.transition)

        if (hasClass(item, CLASS_ACTIVE)) {
          addClass(image, CLASS_IN)
          index = i
        }

        list.push(image)
        addListener(image, EVENT_LOAD, onLoad, {
          once: true,
        })
        player.appendChild(image)
      })

      if (isNumber(options.interval) && options.interval > 0) {
        var play = function play () {
          _this7.playing = setTimeout(function () {
            removeClass(list[index], CLASS_IN)
            index += 1
            index = index < total ? index : 0
            addClass(list[index], CLASS_IN)
            play()
          }, options.interval)
        }

        if (total > 1) {
          play()
        }
      }

      return this
    }, // Stop play
    stop: function stop () {
      var _this8 = this

      if (!this.played) {
        return this
      }

      var element = this.element, options = this.options

      if (isFunction(options.stop)) {
        addListener(element, EVENT_STOP, options.stop, {
          once: true,
        })
      }

      if (dispatchEvent(element, EVENT_STOP) === false) {
        return this
      }

      var player = this.player
      this.played = false
      clearTimeout(this.playing)
      forEach(player.getElementsByTagName('img'), function (image) {
        removeListener(image, EVENT_LOAD, _this8.onLoadWhenPlay)
      })
      removeClass(player, CLASS_SHOW)
      player.innerHTML = ''
      this.exitFullscreen()
      return this
    }, // Enter modal mode (only available in inline mode)
    full: function full () {
      var _this9 = this

      var options = this.options, viewer = this.viewer, image = this.image,
        list = this.list

      if (!this.isShown || this.played || this.fulled || !options.inline) {
        return this
      }

      this.fulled = true
      this.open()
      addClass(this.button, CLASS_FULLSCREEN_EXIT)

      if (options.transition) {
        removeClass(list, CLASS_TRANSITION)

        if (this.viewed) {
          removeClass(image, CLASS_TRANSITION)
        }
      }

      addClass(viewer, CLASS_FIXED)
      viewer.setAttribute('role', 'dialog')
      viewer.setAttribute('aria-labelledby', this.title.id)
      viewer.setAttribute('aria-modal', true)
      viewer.removeAttribute('style')
      setStyle(viewer, {
        zIndex: options.zIndex,
      })

      if (options.focus) {
        this.enforceFocus()
      }

      this.initContainer()
      this.viewerData = assign({}, this.containerData)
      this.renderList()

      if (this.viewed) {
        this.initImage(function () {
          _this9.renderImage(function () {
            if (options.transition) {
              setTimeout(function () {
                addClass(image, CLASS_TRANSITION)
                addClass(list, CLASS_TRANSITION)
              }, 0)
            }
          })
        })
      }

      return this
    }, // Exit modal mode (only available in inline mode)
    exit: function exit () {
      var _this10 = this

      var options = this.options, viewer = this.viewer, image = this.image,
        list = this.list

      if (!this.isShown || this.played || !this.fulled || !options.inline) {
        return this
      }

      this.fulled = false
      this.close()
      removeClass(this.button, CLASS_FULLSCREEN_EXIT)

      if (options.transition) {
        removeClass(list, CLASS_TRANSITION)

        if (this.viewed) {
          removeClass(image, CLASS_TRANSITION)
        }
      }

      if (options.focus) {
        this.clearEnforceFocus()
      }

      viewer.removeAttribute('role')
      viewer.removeAttribute('aria-labelledby')
      viewer.removeAttribute('aria-modal')
      removeClass(viewer, CLASS_FIXED)
      setStyle(viewer, {
        zIndex: options.zIndexInline,
      })
      this.viewerData = assign({}, this.parentData)
      this.renderViewer()
      this.renderList()

      if (this.viewed) {
        this.initImage(function () {
          _this10.renderImage(function () {
            if (options.transition) {
              setTimeout(function () {
                addClass(image, CLASS_TRANSITION)
                addClass(list, CLASS_TRANSITION)
              }, 0)
            }
          })
        })
      }

      return this
    }, // Show the current ratio of the image with percentage
    tooltip: function tooltip () {
      var _this11 = this

      var options = this.options, tooltipBox = this.tooltipBox,
        imageData = this.imageData

      if (!this.viewed || this.played || !options.tooltip) {
        return this
      }

      tooltipBox.textContent = ''.concat(Math.round(imageData.ratio * 100), '%')

      if (!this.tooltipping) {
        if (options.transition) {
          if (this.fading) {
            dispatchEvent(tooltipBox, EVENT_TRANSITION_END)
          }

          addClass(tooltipBox, CLASS_SHOW)
          addClass(tooltipBox, CLASS_FADE)
          addClass(tooltipBox, CLASS_TRANSITION)
          tooltipBox.removeAttribute('aria-hidden') // Force reflow to enable CSS3 transition

          tooltipBox.initialOffsetWidth = tooltipBox.offsetWidth
          addClass(tooltipBox, CLASS_IN)
        } else {
          addClass(tooltipBox, CLASS_SHOW)
          tooltipBox.removeAttribute('aria-hidden')
        }
      } else {
        clearTimeout(this.tooltipping)
      }

      this.tooltipping = setTimeout(function () {
        if (options.transition) {
          addListener(tooltipBox, EVENT_TRANSITION_END, function () {
            removeClass(tooltipBox, CLASS_SHOW)
            removeClass(tooltipBox, CLASS_FADE)
            removeClass(tooltipBox, CLASS_TRANSITION)
            tooltipBox.setAttribute('aria-hidden', true)
            _this11.fading = false
          }, {
            once: true,
          })
          removeClass(tooltipBox, CLASS_IN)
          _this11.fading = true
        } else {
          removeClass(tooltipBox, CLASS_SHOW)
          tooltipBox.setAttribute('aria-hidden', true)
        }

        _this11.tooltipping = false
      }, 1000)
      return this
    },

    /**
     * Toggle the image size between its current size and natural size
     * @param {Event} [_originalEvent=null] - The original event if any.
     * @returns {Viewer} this
     */
    toggle: function toggle () {
      var _originalEvent = arguments.length > 0 && arguments[0] !== undefined
        ? arguments[0]
        : null

      if (this.imageData.ratio === 1) {
        this.zoomTo(this.imageData.oldRatio, true, _originalEvent)
      } else {
        this.zoomTo(1, true, _originalEvent)
      }

      return this
    }, // Reset the image to its initial state
    reset: function reset () {
      if (this.viewed && !this.played) {
        this.imageData = assign({}, this.initialImageData)
        this.renderImage()
      }

      return this
    }, // Update viewer when images changed
    update: function update () {
      var _this12 = this

      var element = this.element, options = this.options, isImg = this.isImg // Destroy viewer if the target image was deleted

      if (isImg && !element.parentNode) {
        return this.destroy()
      }

      var images = []
      forEach(isImg ? [element] : element.querySelectorAll('img'),
        function (image) {
          if (isFunction(options.filter)) {
            if (options.filter.call(_this12, image)) {
              images.push(image)
            }
          } else if (_this12.getImageURL(image)) {
            images.push(image)
          }
        })

      if (!images.length) {
        return this
      }

      this.images = images
      this.length = images.length

      if (this.ready) {
        var changedIndexes = []
        forEach(this.items, function (item, i) {
          var img = item.querySelector('img')
          var image = images[i]

          if (image && img) {
            if (image.src !== img.src // Title changed (#408)
              || image.alt !== img.alt) {
              changedIndexes.push(i)
            }
          } else {
            changedIndexes.push(i)
          }
        })
        setStyle(this.list, {
          width: 'auto',
        })
        this.initList()

        if (this.isShown) {
          if (this.length) {
            if (this.viewed) {
              var changedIndex = changedIndexes.indexOf(this.index)

              if (changedIndex >= 0) {
                this.viewed = false
                this.view(
                  Math.max(Math.min(this.index - changedIndex, this.length - 1),
                    0))
              } else {
                var activeItem = this.items[this.index] // Reactivate the current viewing item after reset the list.

                addClass(activeItem, CLASS_ACTIVE)
                activeItem.setAttribute('aria-selected', true)
              }
            }
          } else {
            this.image = null
            this.viewed = false
            this.index = 0
            this.imageData = {}
            this.canvas.innerHTML = ''
            this.title.innerHTML = ''
          }
        }
      } else {
        this.build()
      }

      return this
    }, // Destroy the viewer
    destroy: function destroy () {
      var element = this.element, options = this.options

      if (!element[NAMESPACE]) {
        return this
      }

      this.destroyed = true

      if (this.ready) {
        if (this.played) {
          this.stop()
        }

        if (options.inline) {
          if (this.fulled) {
            this.exit()
          }

          this.unbind()
        } else if (this.isShown) {
          if (this.viewing) {
            if (this.imageRendering) {
              this.imageRendering.abort()
            } else if (this.imageInitializing) {
              this.imageInitializing.abort()
            }
          }

          if (this.hiding) {
            this.transitioning.abort()
          }

          this.hidden()
        } else if (this.showing) {
          this.transitioning.abort()
          this.hidden()
        }

        this.ready = false
        this.viewer.parentNode.removeChild(this.viewer)
      } else if (options.inline) {
        if (this.delaying) {
          this.delaying.abort()
        } else if (this.initializing) {
          this.initializing.abort()
        }
      }

      if (!options.inline) {
        removeListener(element, EVENT_CLICK, this.onStart)
      }

      element[NAMESPACE] = undefined
      return this
    },
  }

  var others = {
    getImageURL: function getImageURL (image) {
      var url = this.options.url

      if (isString(url)) {
        url = image.getAttribute(url)
      } else if (isFunction(url)) {
        url = url.call(this, image)
      } else {
        url = ''
      }

      return url
    }, enforceFocus: function enforceFocus () {
      var _this = this

      this.clearEnforceFocus()
      addListener(document, EVENT_FOCUSIN, this.onFocusin = function (event) {
        var viewer = _this.viewer
        var target = event.target

        if (target !== document && target !== viewer && !viewer.contains(target) // Avoid conflicts with other modals (#474)
          && (target.getAttribute('tabindex') === null ||
            target.getAttribute('aria-modal') !== 'true')) {
          viewer.focus()
        }
      })
    }, clearEnforceFocus: function clearEnforceFocus () {
      if (this.onFocusin) {
        removeListener(document, EVENT_FOCUSIN, this.onFocusin)
        this.onFocusin = null
      }
    }, open: function open () {
      var body = this.body
      addClass(body, CLASS_OPEN)
      body.style.paddingRight = ''.concat(this.scrollbarWidth +
        (parseFloat(this.initialBodyComputedPaddingRight) || 0), 'px')
    }, close: function close () {
      var body = this.body
      removeClass(body, CLASS_OPEN)
      body.style.paddingRight = this.initialBodyPaddingRight
    }, shown: function shown () {
      var element = this.element, options = this.options, viewer = this.viewer
      this.fulled = true
      this.isShown = true
      this.render()
      this.bind()
      this.showing = false

      if (options.focus) {
        viewer.focus()
        this.enforceFocus()
      }

      if (isFunction(options.shown)) {
        addListener(element, EVENT_SHOWN, options.shown, {
          once: true,
        })
      }

      if (dispatchEvent(element, EVENT_SHOWN) === false) {
        return
      }

      if (this.ready && this.isShown && !this.hiding) {
        this.view(this.index)
      }
    }, hidden: function hidden () {
      var element = this.element, options = this.options, viewer = this.viewer

      if (options.fucus) {
        this.clearEnforceFocus()
      }

      this.fulled = false
      this.viewed = false
      this.isShown = false
      this.close()
      this.unbind()
      addClass(viewer, CLASS_HIDE)
      viewer.removeAttribute('role')
      viewer.removeAttribute('aria-labelledby')
      viewer.removeAttribute('aria-modal')
      viewer.setAttribute('aria-hidden', true)
      this.resetList()
      this.resetImage()
      this.hiding = false

      if (!this.destroyed) {
        if (isFunction(options.hidden)) {
          addListener(element, EVENT_HIDDEN, options.hidden, {
            once: true,
          })
        }

        dispatchEvent(element, EVENT_HIDDEN, null, {
          cancelable: false,
        })
      }
    }, requestFullscreen: function requestFullscreen (options) {
      var document = this.element.ownerDocument

      if (this.fulled &&
        !(document.fullscreenElement || document.webkitFullscreenElement ||
          document.mozFullScreenElement || document.msFullscreenElement)) {
        var documentElement = document.documentElement // Element.requestFullscreen()

        if (documentElement.requestFullscreen) {
          // Avoid TypeError when convert `options` to dictionary
          if (isPlainObject(options)) {
            documentElement.requestFullscreen(options)
          } else {
            documentElement.requestFullscreen()
          }
        } else if (documentElement.webkitRequestFullscreen) {
          documentElement.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT)
        } else if (documentElement.mozRequestFullScreen) {
          documentElement.mozRequestFullScreen()
        } else if (documentElement.msRequestFullscreen) {
          documentElement.msRequestFullscreen()
        }
      }
    }, exitFullscreen: function exitFullscreen () {
      var document = this.element.ownerDocument

      if (this.fulled &&
        (document.fullscreenElement || document.webkitFullscreenElement ||
          document.mozFullScreenElement || document.msFullscreenElement)) {
        // Document.exitFullscreen()
        if (document.exitFullscreen) {
          document.exitFullscreen()
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen()
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen()
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen()
        }
      }
    }, change: function change (event) {
      var options = this.options, pointers = this.pointers
      var pointer = pointers[Object.keys(pointers)[0]] // In the case of the `pointers` object is empty (#421)

      if (!pointer) {
        return
      }

      var offsetX = pointer.endX - pointer.startX
      var offsetY = pointer.endY - pointer.startY

      switch (this.action) {
        // Move the current image
        case ACTION_MOVE:
          this.move(offsetX, offsetY, event)
          break
        // Zoom the current image

        case ACTION_ZOOM:
          this.zoom(getMaxZoomRatio(pointers), false, event)
          break

        case ACTION_SWITCH: {
          this.action = 'switched'
          var absoluteOffsetX = Math.abs(offsetX)

          if (absoluteOffsetX > 1 && absoluteOffsetX > Math.abs(offsetY)) {
            // Empty `pointers` as `touchend` event will not be fired after swiped in iOS browsers.
            this.pointers = {}

            if (offsetX > 1) {
              this.prev(options.loop)
            } else if (offsetX < -1) {
              this.next(options.loop)
            }
          }

          break
        }
      } // Override

      forEach(pointers, function (p) {
        p.startX = p.endX
        p.startY = p.endY
      })
    }, isSwitchable: function isSwitchable () {
      var imageData = this.imageData, viewerData = this.viewerData
      return this.length > 1 && imageData.x >= 0 && imageData.y >= 0 &&
        imageData.width <= viewerData.width && imageData.height <=
        viewerData.height
    },
  }

  var AnotherViewer = WINDOW.Viewer

  var getUniqueID = function (id) {
    return function () {
      id += 1
      return id
    }
  }(-1)

  var Viewer = /*#__PURE__*/function () {
    /**
     * Create a new Viewer.
     * @param {Element} element - The target element for viewing.
     * @param {Object} [options={}] - The configuration options.
     */
    function Viewer (element) {
      var options = arguments.length > 1 && arguments[1] !== undefined
        ? arguments[1]
        : {}

      _classCallCheck(this, Viewer)

      if (!element || element.nodeType !== 1) {
        throw new Error(
          'The first argument is required and must be an element.')
      }

      this.element = element
      this.options = assign({}, DEFAULTS, isPlainObject(options) && options)
      this.action = false
      this.fading = false
      this.fulled = false
      this.hiding = false
      this.imageClicked = false
      this.imageData = {}
      this.index = this.options.initialViewIndex
      this.isImg = false
      this.isShown = false
      this.length = 0
      this.moving = false
      this.played = false
      this.playing = false
      this.pointers = {}
      this.ready = false
      this.rotating = false
      this.scaling = false
      this.showing = false
      this.timeout = false
      this.tooltipping = false
      this.viewed = false
      this.viewing = false
      this.wheeling = false
      this.zooming = false
      this.id = getUniqueID()
      this.init()
    }

    _createClass(Viewer, [
      {
        key: 'init', value: function init () {
          var _this = this

          var element = this.element, options = this.options

          if (element[NAMESPACE]) {
            return
          }

          element[NAMESPACE] = this // The `focus` option requires the `keyboard` option set to `true`.

          if (options.focus && !options.keyboard) {
            options.focus = false
          }

          var isImg = element.localName === 'img'
          var images = []
          forEach(isImg ? [element] : element.querySelectorAll('img'),
            function (image) {
              if (isFunction(options.filter)) {
                if (options.filter.call(_this, image)) {
                  images.push(image)
                }
              } else if (_this.getImageURL(image)) {
                images.push(image)
              }
            })
          this.isImg = isImg
          this.length = images.length
          this.images = images
          this.initBody() // Override `transition` option if it is not supported

          if (isUndefined(document.createElement(NAMESPACE).style.transition)) {
            options.transition = false
          }

          if (options.inline) {
            var count = 0

            var progress = function progress () {
              count += 1

              if (count === _this.length) {
                var timeout
                _this.initializing = false
                _this.delaying = {
                  abort: function abort () {
                    clearTimeout(timeout)
                  },
                } // build asynchronously to keep `this.viewer` is accessible in `ready` event handler.

                timeout = setTimeout(function () {
                  _this.delaying = false

                  _this.build()
                }, 0)
              }
            }

            this.initializing = {
              abort: function abort () {
                forEach(images, function (image) {
                  if (!image.complete) {
                    removeListener(image, EVENT_LOAD, progress)
                  }
                })
              },
            }
            forEach(images, function (image) {
              if (image.complete) {
                progress()
              } else {
                addListener(image, EVENT_LOAD, progress, {
                  once: true,
                })
              }
            })
          } else {
            addListener(element, EVENT_CLICK, this.onStart = function (_ref) {
              var target = _ref.target

              if (target.localName === 'img' && (!isFunction(options.filter) ||
                options.filter.call(_this, target))) {
                _this.view(_this.images.indexOf(target))
              }
            })
          }
        },
      }, {
        key: 'build', value: function build () {
          if (this.ready) {
            return
          }

          var element = this.element, options = this.options
          var parent = element.parentNode
          var template = document.createElement('div')
          template.innerHTML = TEMPLATE
          var viewer = template.querySelector(
            '.'.concat(NAMESPACE, '-container'))
          var title = viewer.querySelector('.'.concat(NAMESPACE, '-title'))
          var toolbar = viewer.querySelector('.'.concat(NAMESPACE, '-toolbar'))
          var navbar = viewer.querySelector('.'.concat(NAMESPACE, '-navbar'))
          var button = viewer.querySelector('.'.concat(NAMESPACE, '-button'))
          var canvas = viewer.querySelector('.'.concat(NAMESPACE, '-canvas'))
          this.parent = parent
          this.viewer = viewer
          this.title = title
          this.toolbar = toolbar
          this.navbar = navbar
          this.button = button
          this.canvas = canvas
          this.footer = viewer.querySelector('.'.concat(NAMESPACE, '-footer'))
          this.tooltipBox = viewer.querySelector(
            '.'.concat(NAMESPACE, '-tooltip'))
          this.player = viewer.querySelector('.'.concat(NAMESPACE, '-player'))
          this.list = viewer.querySelector('.'.concat(NAMESPACE, '-list'))
          viewer.id = ''.concat(NAMESPACE).concat(this.id)
          title.id = ''.concat(NAMESPACE, 'Title').concat(this.id)
          addClass(title, !options.title ? CLASS_HIDE : getResponsiveClass(
            Array.isArray(options.title) ? options.title[0] : options.title))
          addClass(navbar,
            !options.navbar ? CLASS_HIDE : getResponsiveClass(options.navbar))
          toggleClass(button, CLASS_HIDE, !options.button)

          if (options.keyboard) {
            button.setAttribute('tabindex', 0)
          }

          if (options.backdrop) {
            addClass(viewer, ''.concat(NAMESPACE, '-backdrop'))

            if (!options.inline && options.backdrop !== 'static') {
              setData(canvas, DATA_ACTION, 'hide')
            }
          }

          if (isString(options.className) && options.className) {
            // In case there are multiple class names
            options.className.split(REGEXP_SPACES).
              forEach(function (className) {
                addClass(viewer, className)
              })
          }

          if (options.toolbar) {
            var list = document.createElement('ul')
            var custom = isPlainObject(options.toolbar)
            var zoomButtons = BUTTONS.slice(0, 3)
            var rotateButtons = BUTTONS.slice(7, 9)
            var scaleButtons = BUTTONS.slice(9)

            if (!custom) {
              addClass(toolbar, getResponsiveClass(options.toolbar))
            }

            forEach(custom ? options.toolbar : BUTTONS,
              function (value, index) {
                var deep = custom && isPlainObject(value)
                var name = custom ? hyphenate(index) : value
                var show = deep && !isUndefined(value.show) ? value.show : value

                if (!show || !options.zoomable && zoomButtons.indexOf(name) !==
                  -1 || !options.rotatable && rotateButtons.indexOf(name) !==
                  -1 || !options.scalable && scaleButtons.indexOf(name) !==
                  -1) {
                  return
                }

                var size = deep && !isUndefined(value.size) ? value.size : value
                var click = deep && !isUndefined(value.click)
                  ? value.click
                  : value
                var item = document.createElement('li')

                if (options.keyboard) {
                  item.setAttribute('tabindex', 0)
                }

                item.setAttribute('role', 'button')
                addClass(item, ''.concat(NAMESPACE, '-').concat(name))

                if (!isFunction(click)) {
                  setData(item, DATA_ACTION, name)
                }

                if (isNumber(show)) {
                  addClass(item, getResponsiveClass(show))
                }

                if (['small', 'large'].indexOf(size) !== -1) {
                  addClass(item, ''.concat(NAMESPACE, '-').concat(size))
                } else if (name === 'play') {
                  addClass(item, ''.concat(NAMESPACE, '-large'))
                }

                if (isFunction(click)) {
                  addListener(item, EVENT_CLICK, click)
                }
                // NOTE: updated by Vanessa
                let iconName = ''
                switch (name) {
                  case 'zoom-in':
                    iconName = 'Add'
                    break
                  case 'zoom-out':
                    iconName = 'Line'
                    break
                  case 'one-to-one':
                    iconName = 'Pause'
                    break
                  case 'reset':
                    iconName = 'Refresh'
                    break
                  case 'prev':
                    iconName = 'Left'
                    break
                  case 'play':
                    iconName = 'Play'
                    break
                  case'next':
                    iconName = 'Right'
                    break
                  case 'rotate-left':
                    iconName = 'Undo'
                    break
                  case 'rotate-right':
                    iconName = 'Redo'
                    break
                  case 'flip-horizontal':
                    iconName = 'SplitLR'
                    break
                  case 'flip-vertical':
                    iconName = 'SplitTB'
                    break
                  case 'close':
                    iconName = 'Close'
                    break
                }
                item.innerHTML = `<svg${name === 'close'
                  ? ' style="width:8px"'
                  : ''}><use xlink:href="#icon${iconName}"></use></svg>`
                list.appendChild(item)
              })
            toolbar.appendChild(list)
          } else {
            addClass(toolbar, CLASS_HIDE)
          }

          if (!options.rotatable) {
            var rotates = toolbar.querySelectorAll('li[class*="rotate"]')
            addClass(rotates, CLASS_INVISIBLE)
            forEach(rotates, function (rotate) {
              toolbar.appendChild(rotate)
            })
          }

          if (options.inline) {
            addClass(button, CLASS_FULLSCREEN)
            setStyle(viewer, {
              zIndex: options.zIndexInline,
            })

            if (window.getComputedStyle(parent).position === 'static') {
              setStyle(parent, {
                position: 'relative',
              })
            }

            parent.insertBefore(viewer, element.nextSibling)
          } else {
            addClass(button, CLASS_CLOSE)
            addClass(viewer, CLASS_FIXED)
            addClass(viewer, CLASS_FADE)
            addClass(viewer, CLASS_HIDE)
            setStyle(viewer, {
              zIndex: options.zIndex,
            })
            var container = options.container

            if (isString(container)) {
              container = element.ownerDocument.querySelector(container)
            }

            if (!container) {
              container = this.body
            }

            container.appendChild(viewer)
          }

          if (options.inline) {
            this.render()
            this.bind()
            this.isShown = true
          }

          this.ready = true

          if (isFunction(options.ready)) {
            addListener(element, EVENT_READY, options.ready, {
              once: true,
            })
          }

          if (dispatchEvent(element, EVENT_READY) === false) {
            this.ready = false
            return
          }

          if (this.ready && options.inline) {
            this.view(this.index)
          }
        }, /**
         * Get the no conflict viewer class.
         * @returns {Viewer} The viewer class.
         */

      }], [
      {
        key: 'noConflict', value: function noConflict () {
          window.Viewer = AnotherViewer
          return Viewer
        }, /**
         * Change the default options.
         * @param {Object} options - The new default options.
         */

      }, {
        key: 'setDefaults', value: function setDefaults (options) {
          assign(DEFAULTS, isPlainObject(options) && options)
        },
      }])

    return Viewer
  }()

  assign(Viewer.prototype, render, events, handlers, methods, others)

  return Viewer

}))
