// SiYuan - From thought to insight, with agents
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

import (
	"encoding/binary"
	"errors"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ConradIrwin/font/sfnt"
	"github.com/flopp/go-findfont"
	"github.com/siyuan-note/logging"
)

var (
	sysFonts     []*Font
	sysFontsLang string
	sysFontsLock = sync.Mutex{}
)

func LoadSysFonts() []*Font {
	sysFontsLock.Lock()
	defer sysFontsLock.Unlock()

	if 0 < len(sysFonts) && sysFontsLang == Lang {
		return sysFonts
	}

	start := time.Now()
	sysFonts = loadFonts()
	sysFontsLang = Lang

	sort.Slice(sysFonts, func(i, j int) bool {
		return sysFonts[i].DisplayName < sysFonts[j].DisplayName
	})

	logging.LogInfof("loaded system fonts [%d] in [%dms]", len(sysFonts), time.Since(start).Milliseconds())
	return sysFonts
}

type Font struct {
	Family      string   `json:"family"`            // 对应 CSS font-family
	Weight      int      `json:"weight"`            // 对应 CSS font-weight
	DisplayName string   `json:"displayName"`       // 给人看的名称 (Family + Subfamily)
	Aliases     []string `json:"aliases,omitempty"` // 用于字体搜索的本地化名称和内部名称
}

type fontLanguage struct {
	PlatformID sfnt.PlatformID
	LanguageID sfnt.PlatformLanguageID
}

var microsoftFontLanguageIDs = map[string][]sfnt.PlatformLanguageID{
	"ar":    {0x0401},
	"de":    {0x0407},
	"en":    {0x0409},
	"es":    {0x0c0a, 0x040a},
	"fr":    {0x040c},
	"he":    {0x040d},
	"hi":    {0x0439},
	"id":    {0x0421},
	"it":    {0x0410},
	"ja":    {0x0411},
	"ko":    {0x0412},
	"nl":    {0x0413},
	"pl":    {0x0415},
	"pt-BR": {0x0416},
	"ru":    {0x0419},
	"sk":    {0x041b},
	"th":    {0x041e},
	"tr":    {0x041f},
	"uk":    {0x0422},
	"zh-CN": {0x0804, 0x1004},
	"zh-TW": {0x0404, 0x0c04, 0x1404},
}

var macFontLanguageIDs = map[string]sfnt.PlatformLanguageID{
	"ar": 12, "de": 2, "en": 0, "es": 6, "fr": 1, "he": 10, "hi": 21, "id": 81,
	"it": 3, "ja": 11, "ko": 23, "nl": 4, "pl": 25, "pt-BR": 8, "ru": 32, "sk": 39,
	"th": 22, "tr": 17, "uk": 45, "zh-CN": 33, "zh-TW": 19,
}

func loadFonts() (ret []*Font) {
	ret = []*Font{}
	for _, fontPath := range findfont.List() {
		if strings.HasSuffix(strings.ToLower(fontPath), ".ttc") {
			families := parseTTCFontFamily(fontPath)
			for _, f := range families {
				ret = addFont(ret, f)
				//LogInfof("[%s] [%s]", fontPath, family)
			}
		} else if strings.HasSuffix(strings.ToLower(fontPath), ".otf") || strings.HasSuffix(strings.ToLower(fontPath), ".ttf") {
			for _, f := range parseTTFFontFamily(fontPath) {
				ret = addFont(ret, f)
				//logging.LogInfof("[%s] [%s]", fontPath, family)
			}
		}
	}
	for _, font := range loadPlatformFonts() {
		ret = addFont(ret, font)
	}
	return
}

func addFont(fonts []*Font, f *Font) []*Font {
	if nil == f || "" == f.Family {
		return fonts
	}
	for _, font := range fonts {
		if strings.EqualFold(f.Family, font.Family) && f.Weight == font.Weight {
			font.Aliases = mergeFontAliases(font.Aliases, f.Aliases, font.Family, font.DisplayName)
			return fonts
		}
	}
	f.Aliases = mergeFontAliases(nil, f.Aliases, f.Family, f.DisplayName)
	return append(fonts, f)
}

func parseTTCFontFamily(fontPath string) (ret []*Font) {
	defer logging.Recover()

	fontFile, err := os.Open(fontPath)
	if err != nil {
		//logging.LogErrorf("read font file [%s] failed: %s", fontPath, err)
		return
	}
	defer fontFile.Close()

	fonts, err := sfnt.ParseCollection(fontFile)
	if err != nil {
		//LogErrorf("parse font collection [%s] failed: %s", fontPath, err)
		return
	}

	for _, f := range fonts {
		ret = append(ret, parseFont(f)...)
	}
	return
}

func parseTTFFontFamily(fontPath string) (ret []*Font) {
	defer logging.Recover()

	fontFile, err := os.Open(fontPath)
	if err != nil {
		//LogErrorf("open font file [%s] failed: %s", fontPath, err)
		return nil
	}
	defer fontFile.Close()

	font, err := sfnt.Parse(fontFile)
	if err != nil {
		//logging.LogErrorf("parse font [%s] failed: %s", fontFile.Name(), err)
		return nil
	}
	return parseFont(font)
}

func parseFont(font *sfnt.Font) (ret []*Font) {
	defaultFont, err := parseFontInfo(font)
	if err != nil {
		return nil
	}
	ret = append(ret, defaultFont)
	ret = append(ret, parseFontVariations(font, defaultFont)...)
	return
}

func parseFontVariations(font *sfnt.Font, defaultFont *Font) (ret []*Font) {
	defer logging.Recover()

	// 可变字体通过 fvar 表声明字重等可变轴，named instances 提供了命名的字重实例
	table, err := font.Table(sfnt.MustNamedTag("fvar"))
	if err != nil {
		return nil
	}
	buf := table.Bytes()
	if len(buf) < 16 {
		return nil
	}
	axesArrayOffset := int(binary.BigEndian.Uint16(buf[4:6]))
	axisCount := int(binary.BigEndian.Uint16(buf[8:10]))
	axisSize := int(binary.BigEndian.Uint16(buf[10:12]))
	instanceCount := int(binary.BigEndian.Uint16(buf[12:14]))
	instanceSize := int(binary.BigEndian.Uint16(buf[14:16]))
	if axisSize < 20 || instanceSize < 4+axisCount*4 || len(buf) < axesArrayOffset+axisCount*axisSize+instanceCount*instanceSize {
		return nil
	}

	// 找到 wght 轴在实例坐标中的位置
	wghtAxisIndex := -1
	for i := 0; i < axisCount; i++ {
		base := axesArrayOffset + i*axisSize
		if "wght" == string(buf[base:base+4]) {
			wghtAxisIndex = i
			break
		}
	}
	if wghtAxisIndex < 0 {
		return nil
	}

	t, err := font.NameTable()
	if err != nil {
		return nil
	}
	entries := t.List()
	localizedFamily := selectLocalizedFontName(entries, sfnt.NamePreferredFamily, sfnt.NameFontFamily)
	if "" == localizedFamily {
		localizedFamily = defaultFont.Family
	}
	instancesBase := axesArrayOffset + axisCount*axisSize
	for i := 0; i < instanceCount; i++ {
		base := instancesBase + i*instanceSize
		subfamilyNameID := binary.BigEndian.Uint16(buf[base : base+2])
		// wght 坐标是 16.16 定点数，取整后即为 CSS font-weight
		weight := int(float64(int32(binary.BigEndian.Uint32(buf[base+4+wghtAxisIndex*4:base+8+wghtAxisIndex*4])))/65536 + 0.5)
		if weight < 1 || 1000 < weight {
			continue
		}
		subfamily := selectFontName(entries, sfnt.NameID(subfamilyNameID))
		if "" == subfamily {
			continue
		}
		localizedSubfamily := selectLocalizedFontName(entries, sfnt.NameID(subfamilyNameID))
		if "" == localizedSubfamily {
			localizedSubfamily = subfamily
		}

		displayName := localizedFamily
		if !strings.EqualFold(subfamily, "Regular") {
			displayName = localizedFamily + " " + localizedSubfamily
		}
		aliases := collectFontAliases(entries, sfnt.NameID(subfamilyNameID))
		aliases = append(aliases, defaultFont.Aliases...)
		ret = append(ret, &Font{
			Family:      defaultFont.Family,
			Weight:      weight,
			DisplayName: displayName,
			Aliases:     aliases,
		})
	}
	return
}

func parseFontInfo(font *sfnt.Font) (*Font, error) {
	t, err := font.NameTable()
	if err != nil {
		return nil, err
	}

	entries := t.List()
	family := selectFontName(entries, sfnt.NamePreferredFamily, sfnt.NameFontFamily)
	subfamily := selectFontName(entries, sfnt.NamePreferredSubfamily, sfnt.NameFontSubfamily)
	localizedFamily := selectLocalizedFontName(entries, sfnt.NamePreferredFamily, sfnt.NameFontFamily)
	localizedSubfamily := selectLocalizedFontName(entries, sfnt.NamePreferredSubfamily, sfnt.NameFontSubfamily)
	if "" == localizedFamily {
		localizedFamily = family
	}
	if "" == localizedSubfamily {
		localizedSubfamily = subfamily
	}

	weight := 400
	os2, err := font.OS2Table()
	if nil == err {
		weight = int(os2.USWeightClass)
	}

	weight = inferFontWeight(weight, subfamily)

	if family == "" || strings.HasPrefix(family, ".") {
		return nil, errors.New("font family is empty")
	}

	displayName := localizedFamily
	if subfamily != "" && !strings.EqualFold(subfamily, "Regular") {
		displayName = localizedFamily + " " + localizedSubfamily
	}
	aliases := collectFontAliases(entries,
		sfnt.NamePreferredFamily, sfnt.NameFontFamily, sfnt.NameWWSFamily,
		sfnt.NamePreferredSubfamily, sfnt.NameFontSubfamily, sfnt.NameWWSSubfamily,
		sfnt.NameFull, sfnt.NameCompatibleFull, sfnt.NamePostscript)

	return &Font{
		Family:      family,
		Weight:      weight,
		DisplayName: displayName,
		Aliases:     aliases,
	}, nil
}

func selectFontName(entries []*sfnt.NameEntry, nameIDs ...sfnt.NameID) string {
	return selectFontNameWithLanguages(entries, []fontLanguage{
		{PlatformID: sfnt.PlatformMicrosoft, LanguageID: sfnt.PlatformLanguageID(1033)},
		{PlatformID: sfnt.PlatformMac, LanguageID: sfnt.PlatformLanguageID(0)},
	}, nameIDs...)
}

func selectLocalizedFontName(entries []*sfnt.NameEntry, nameIDs ...sfnt.NameID) string {
	for _, language := range preferredFontLanguages(Lang) {
		for _, nameID := range nameIDs {
			for _, entry := range entries {
				if entry.NameID == nameID && entry.PlatformID == language.PlatformID &&
					entry.LanguageID == language.LanguageID {
					if value := fontNameValue(entry); "" != value {
						return value
					}
				}
			}
		}
	}
	return selectFontName(entries, nameIDs...)
}

func selectFontNameWithLanguages(entries []*sfnt.NameEntry, languages []fontLanguage, nameIDs ...sfnt.NameID) string {
	for _, nameID := range nameIDs {
		var selected string
		selectedScore := len(languages) + 2
		for _, entry := range entries {
			if entry.NameID != nameID {
				continue
			}

			value := fontNameValue(entry)
			if value == "" {
				continue
			}

			score := len(languages) + 1
			for i, language := range languages {
				if entry.PlatformID == language.PlatformID && entry.LanguageID == language.LanguageID {
					score = i
					break
				}
			}
			if score == len(languages)+1 && entry.PlatformID == sfnt.PlatformUnicode {
				score = len(languages)
			}
			if score < selectedScore {
				selected = value
				selectedScore = score
			}
		}
		if selected != "" {
			return selected
		}
	}
	return ""
}

func preferredFontLanguages(lang string) (ret []fontLanguage) {
	lang = LangToBCP47(lang)
	for _, languageID := range microsoftFontLanguageIDs[lang] {
		ret = append(ret, fontLanguage{PlatformID: sfnt.PlatformMicrosoft, LanguageID: languageID})
	}
	if languageID, ok := macFontLanguageIDs[lang]; ok {
		ret = append(ret, fontLanguage{PlatformID: sfnt.PlatformMac, LanguageID: languageID})
	}
	return
}

func fontNameValue(entry *sfnt.NameEntry) string {
	value := strings.Trim(strings.TrimSpace(entry.String()), "\x00")
	if "" == value || !utf8.ValidString(value) {
		return ""
	}
	for _, r := range value {
		if unicode.IsControl(r) && !unicode.IsSpace(r) {
			return ""
		}
	}
	return value
}

func collectFontAliases(entries []*sfnt.NameEntry, nameIDs ...sfnt.NameID) (ret []string) {
	for _, entry := range entries {
		matched := false
		for _, nameID := range nameIDs {
			if entry.NameID == nameID {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		if value := fontNameValue(entry); "" != value {
			ret = appendFontAlias(ret, value)
		}
	}
	return
}

func mergeFontAliases(base, aliases []string, excluded ...string) (ret []string) {
	for _, alias := range base {
		ret = appendFontAlias(ret, alias)
	}
	for _, alias := range aliases {
		ret = appendFontAlias(ret, alias)
	}
	filtered := ret[:0]
	for _, alias := range ret {
		exclude := false
		for _, value := range excluded {
			if strings.EqualFold(alias, value) {
				exclude = true
				break
			}
		}
		if !exclude {
			filtered = append(filtered, alias)
		}
	}
	return filtered
}

func appendFontAlias(aliases []string, alias string) []string {
	alias = strings.TrimSpace(alias)
	if "" == alias {
		return aliases
	}
	for _, existing := range aliases {
		if strings.EqualFold(existing, alias) {
			return aliases
		}
	}
	return append(aliases, alias)
}

func inferFontWeight(weight int, subfamily string) int {
	if weight != 400 || "" == subfamily {
		return weight
	}
	s := strings.ToLower(subfamily)
	// 自动匹配 W01-W09
	for i := 1; i <= 9; i++ {
		if strings.Contains(s, "w0"+strconv.Itoa(i)) {
			return i * 100
		}
	}
	// 自动匹配 W1-W9（部分字体使用不带前导零的缩写）
	for i := 1; i <= 9; i++ {
		if strings.Contains(s, "w"+strconv.Itoa(i)) {
			return i * 100
		}
	}
	// 自动匹配标准关键词
	switch {
	case strings.Contains(s, "thin") || strings.Contains(s, "hairline"):
		return 100
	case strings.Contains(s, "extra light") || strings.Contains(s, "extralight") || strings.Contains(s, "ultra light") || strings.Contains(s, "ultralight"):
		return 200
	case strings.Contains(s, "light"):
		return 300
	case strings.Contains(s, "medium"):
		return 500
	case strings.Contains(s, "semibold") || strings.Contains(s, "semi bold") || strings.Contains(s, "demi"):
		return 600
	case strings.Contains(s, "extra bold") || strings.Contains(s, "extrabold") || strings.Contains(s, "ultra bold") || strings.Contains(s, "ultrabold"):
		return 800
	case strings.Contains(s, "bold"):
		return 700
	case strings.Contains(s, "black"):
		return 900
	case strings.Contains(s, "heavy"):
		return 900
	}
	return weight
}

func fontWeightFromNormalizedTrait(weight float64, style string) int {
	if inferred := inferFontWeight(400, style); inferred != 400 {
		return inferred
	}
	switch {
	case weight <= -0.5:
		return 100
	case weight <= -0.25:
		return 300
	case weight < 0.15:
		return 400
	case weight < 0.28:
		return 500
	case weight < 0.35:
		return 600
	case weight < 0.5:
		return 700
	case weight < 0.6:
		return 800
	default:
		return 900
	}
}
