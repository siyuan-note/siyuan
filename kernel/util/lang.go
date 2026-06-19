// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

// langLegacyToBCP47 从历史下划线标识映射到 BCP 47 标准语言代码。
var LangLegacyToBCP47 = map[string]string{
	"zh_CN":  "zh-CN",
	"zh_CHT": "zh-TW",
	"en_US":  "en",
	"de_DE":  "de",
	"fr_FR":  "fr",
	"es_ES":  "es",
	"pt_BR":  "pt-BR",
	"it_IT":  "it",
	"ja_JP":  "ja",
	"ko_KR":  "ko",
	"ru_RU":  "ru",
	"uk_UA":  "uk",
	"pl_PL":  "pl",
	"nl_NL":  "nl",
	"ar_SA":  "ar",
	"he_IL":  "he",
	"hi_IN":  "hi",
	"id_ID":  "id",
	"th_TH":  "th",
	"tr_TR":  "tr",
	"sk_SK":  "sk",
}

// langBCP47ToLegacy 从 BCP 47 标准语言代码映射到历史下划线标识。
var langBCP47ToLegacy map[string]string

func init() {
	langBCP47ToLegacy = make(map[string]string, len(LangLegacyToBCP47))
	for legacy, bcp47 := range LangLegacyToBCP47 {
		langBCP47ToLegacy[bcp47] = legacy
	}
}

// LangToBCP47 把历史下划线标识映射为 BCP 47 标准语言代码（如 zh_CN → zh-CN）。
// 不是历史下划线标识时原样返回。
func LangToBCP47(lang string) string {
	if v, ok := LangLegacyToBCP47[lang]; ok {
		return v
	}
	return lang
}

// LangToLegacy 把 BCP 47 标准语言代码映射为历史下划线标识（如 zh-CN → zh_CN）。
// 不是 BCP 47 标准语言代码时原样返回。
func LangToLegacy(lang string) string {
	if legacy, ok := langBCP47ToLegacy[lang]; ok {
		return legacy
	}
	return lang
}
