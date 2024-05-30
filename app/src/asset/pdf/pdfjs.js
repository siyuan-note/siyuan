/* Copyright 2016 Mozilla Foundation
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
/* globals module, __non_webpack_require__ */

const {Constants} = require('../../constants')
async function init() {
  let pdfjsLibImport = await import(/* webpackIgnore: true */`${Constants.PROTYLE_CDN}/js/pdf/pdf.mjs`)
  for (let key in pdfjsLibImport){
    pdfjsLib[key] = pdfjsLibImport[key]
  }
}
init()
let pdfjsLib = {}
pdfjsLib['createPromiseCapability'] = ()=>{
  return Promise.withResolvers()
}

module.exports = pdfjsLib