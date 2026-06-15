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

// langMigration 从旧语言代码（下划线形式）映射到 BCP 47 合规新值。
// 历史值参考 https://github.com/siyuan-note/siyuan/issues/7098
var langMigration = map[string]string{
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

// langFileStem 从 BCP 47 新值映射到 i18n 文件名 stem（去 .json 后缀）。
// i18n 资源文件保持历史命名（zh_CN.json 等），逻辑值与文件名通过此表衔接。
var langFileStem = map[string]string{
	"zh-CN":  "zh_CN",
	"zh-TW":  "zh_CHT",
	"en":     "en_US",
	"de":     "de_DE",
	"fr":     "fr_FR",
	"es":     "es_ES",
	"pt-BR":  "pt_BR",
	"it":     "it_IT",
	"ja":     "ja_JP",
	"ko":     "ko_KR",
	"ru":     "ru_RU",
	"uk":     "uk_UA",
	"pl":     "pl_PL",
	"nl":     "nl_NL",
	"ar":     "ar_SA",
	"he":     "he_IL",
	"hi":     "hi_IN",
	"id":     "id_ID",
	"th":     "th_TH",
	"tr":     "tr_TR",
	"sk":     "sk_SK",
}

// fileStemToLang 是 langFileStem 的反向映射，由 init 自动构造。
var fileStemToLang = func() map[string]string {
	m := make(map[string]string, len(langFileStem))
	for lang, stem := range langFileStem {
		m[stem] = lang
	}
	return m
}()

// MigrateLang 把历史语言代码迁移为 BCP 47 合规新值。
// 已是新值或未知值原样返回。
func MigrateLang(lang string) string {
	if v, ok := langMigration[lang]; ok {
		return v
	}
	return lang
}

// LangToFile 把 BCP 47 语言代码映射为 i18n 文件名 stem（不含 .json）。
// 兼容直接传入旧文件名 stem（如 zh_CN）的情况。
func LangToFile(lang string) string {
	if stem, ok := langFileStem[lang]; ok {
		return stem
	}
	// 兜底：若 lang 本身就是文件名 stem（zh_CN 等），原样返回
	return lang
}

// FileToLang 把 i18n 文件名 stem（如 zh_CN）反向映射为 BCP 47 新值。
// 已是新值或未知 stem 原样返回。
func FileToLang(stem string) string {
	if lang, ok := fileStemToLang[stem]; ok {
		return lang
	}
	return stem
}
