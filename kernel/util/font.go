// SiYuan - Build Your Eternal Digital Garden
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
	"os"
	"sort"
	"strings"

	"github.com/88250/gulu"
	"github.com/ConradIrwin/font/sfnt"
	"github.com/flopp/go-findfont"
	"github.com/siyuan-note/logging"
	ttc "golang.org/x/image/font/sfnt"
	textUnicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

func GetSysFonts(currentLanguage string) (ret []string) {
	fonts := loadFonts(currentLanguage)
	ret = gulu.Str.RemoveDuplicatedElem(fonts)
	ret = removeUnusedFonts(ret)
	sort.Strings(ret)
	return
}

func removeUnusedFonts(fonts []string) (ret []string) {
	ret = []string{}
	for _, font := range fonts {
		if strings.HasPrefix(font, "Noto Sans") {
			continue
		}
		ret = append(ret, font)
	}
	return
}

func loadFonts(currentLanguage string) (ret []string) {
	ret = []string{}
	for _, f := range findfont.List() {
		if strings.HasSuffix(strings.ToLower(f), ".ttc") {
			data, err := os.ReadFile(f)
			if nil != err {
				logging.LogErrorf("read font file [%s] failed: %s", f, err)
				continue
			}
			collection, err := ttc.ParseCollection(data)
			if nil != err {
				//LogErrorf("parse font collection [%s] failed: %s", f, err)
				continue
			}

			for i := 0; i < collection.NumFonts(); i++ {
				font, err := collection.Font(i)
				if nil != err {
					//LogErrorf("get font [%s] failed: %s", f, err)
					continue
				}
				if family := parseFontFamily(font); "" != family {
					ret = append(ret, family)
					//LogInfof("[%s] [%s]", f, family)
				}
			}
		} else if strings.HasSuffix(strings.ToLower(f), ".otf") || strings.HasSuffix(strings.ToLower(f), ".ttf") {
			fontFile, err := os.Open(f)
			if nil != err {
				//LogErrorf("open font file [%s] failed: %s", f, err)
				continue
			}
			font, err := sfnt.Parse(fontFile)
			if nil != err {
				//LogErrorf("parse font [%s] failed: %s", f, err)
				continue
			}

			t, err := font.NameTable()
			if nil != err {
				//LogErrorf("parse font name table [%s] failed: %s", f, err)
				return
			}
			fontFile.Close()
			var family, familyChinese string
			for _, e := range t.List() {
				if sfnt.NameFontFamily != e.NameID && sfnt.NamePreferredFamily != e.NameID {
					continue
				}

				if sfnt.PlatformLanguageID(1033) == e.LanguageID {
					v, _, err := transform.Bytes(textUnicode.UTF16(textUnicode.BigEndian, textUnicode.IgnoreBOM).NewDecoder(), e.Value)
					if nil != err {
						//LogErrorf("decode font family [%s] failed: %s", f, err)
						continue
					}
					val := string(v)
					if sfnt.NameFontFamily == e.NameID && "" != val {
						family = val
					}
					if sfnt.NamePreferredFamily == e.NameID && "" != val {
						family = val
					}
				} else if sfnt.PlatformLanguageID(2052) == e.LanguageID {
					if "zh_CN" != currentLanguage {
						continue
					}

					v, _, err := transform.Bytes(textUnicode.UTF16(textUnicode.BigEndian, textUnicode.IgnoreBOM).NewDecoder(), e.Value)
					if nil != err {
						//LogErrorf("decode font family [%s] failed: %s", f, err)
						continue
					}
					val := string(v)
					if sfnt.NameFontFamily == e.NameID && "" != val {
						familyChinese = val
					}
					if sfnt.NamePreferredFamily == e.NameID && "" != val {
						familyChinese = val
					}
				}
			}
			if "" != family && !strings.HasPrefix(family, ".") {
				ret = append(ret, family)
				//LogInfof("[%s] [%s]", f, family)
			}
			if "" != familyChinese && !strings.HasPrefix(familyChinese, ".") {
				ret = append(ret, familyChinese)
				//LogInfof("[%s] [%s]", f, family)
			}
		}
	}
	return
}

func parseFontFamily(font *ttc.Font) string {
	family, _ := font.Name(nil, ttc.NameIDTypographicFamily)
	if "" == family {
		family, _ = font.Name(nil, ttc.NameIDFamily)
	}
	if strings.HasPrefix(family, ".") {
		return ""
	}
	return family
}
