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

/** @typedef {import("./interfaces").IL10n} IL10n */

// NOTE

import {L10n} from "./l10n.js";

/**
 * @implements {IL10n}
 */
class GenericL10n extends L10n {
    constructor(lang) {
        super({lang});
        this._setL10n({
            formatMessages: (msg) => {
                return new Promise(resolve => {
                    let lang = window.siyuan.languages[msg[0].id] ||msg[0].id
                    if (msg[0].args) {
                        Object.keys(msg[0].args).forEach(key => {
                            lang = lang.replace('${' + key + '}', msg[0].args[key]);
                        });
                    }
                    resolve([{value: lang}]);
                });
            },
            connectRoot: () => {
            },
            translateRoots: () => {
            },
            translateElements: () => {
            },
            disconnectRoot: () => {
            },
            pauseObserving: () => {
            },
            resumeObserving: () => {
            },
        });
    }
}

export {GenericL10n};
