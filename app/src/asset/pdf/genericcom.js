/* Copyright 2017 Mozilla Foundation
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

import { BasePreferences } from "./preferences.js";
// NOTE
// import { DownloadManager } from "./download_manager.js";
import { GenericScripting } from "./generic_scripting.js";
import { shadow } from './pdfjs'

if (typeof PDFJSDev !== "undefined" && !PDFJSDev.test("GENERIC")) {
  throw new Error(
    'Module "pdfjs-web/genericcom" shall not be used outside GENERIC build.'
  );
}

const GenericCom = {};

class GenericPreferences extends BasePreferences {
  async _writeToStorage(prefObj) {
    localStorage.setItem("pdfjs.preferences", JSON.stringify(prefObj));
  }

  async _readFromStorage(prefObj) {
    return JSON.parse(localStorage.getItem("pdfjs.preferences"));
  }
}

// NOTE
class GenericExternalServices {
  constructor () {
    throw new Error('Cannot initialize DefaultExternalServices.')
  }

  static updateFindControlState (data) {}

  static updateFindMatchesCount (data) {}

  static initPassiveLoading (callbacks) {}

  static async fallback (data) {}

  static reportTelemetry (data) {}

  static get supportsIntegratedFind () {
    return shadow(this, 'supportsIntegratedFind', false)
  }

  static get supportsDocumentFonts () {
    return shadow(this, 'supportsDocumentFonts', true)
  }

  static get supportedMouseWheelZoomModifierKeys () {
    return shadow(this, 'supportedMouseWheelZoomModifierKeys', {
      ctrlKey: true,
      metaKey: true,
    })
  }

  static get isInAutomation () {
    return shadow(this, 'isInAutomation', false)
  }

  static createDownloadManager(options) {
    // NOTE
    // return new DownloadManager();
  }

  static createPreferences() {
    return new GenericPreferences();
  }

  static createL10n({ locale = "en-US" }) {
    // NOTE
    // return new GenericL10n(locale);
  }

  static createScripting({ sandboxBundleSrc }) {
    return new GenericScripting(sandboxBundleSrc);
  }
}
// NOTE
export { GenericCom, GenericExternalServices };
