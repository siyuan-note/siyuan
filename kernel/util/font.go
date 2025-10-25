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

import (
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/ConradIrwin/font/sfnt"
	"github.com/flopp/go-findfont"
	"github.com/siyuan-note/logging"
	ttc "golang.org/x/image/font/sfnt"
	textUnicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

var (
	sysFonts     []string
	sysFontsLock = sync.Mutex{}
)

func LoadSysFonts() (ret []string) {
	sysFontsLock.Lock()
	defer sysFontsLock.Unlock()

	if 0 < len(sysFonts) {
		return sysFonts
	}

	start := time.Now()
	fonts := loadFonts()
	ret = []string{}
	for _, font := range fonts {
		ret = append(ret, font.Family)
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	sort.Strings(ret)
	sysFonts = ret
	logging.LogInfof("loaded system fonts [%d] in [%dms]", len(sysFonts), time.Since(start).Milliseconds())
	return
}

type Font struct {
	Path   string
	Family string
}

func loadFonts() (ret []*Font) {
	ret = []*Font{}
	for _, fontPath := range findfont.List() {
		if strings.HasSuffix(strings.ToLower(fontPath), ".ttc") {
			families := parseTTCFontFamily(fontPath)
			for _, family := range families {
				if existFont(family, ret) {
					continue
				}

				ret = append(ret, &Font{fontPath, family})
				//LogInfof("[%s] [%s]", fontPath, family)
			}
		} else if strings.HasSuffix(strings.ToLower(fontPath), ".otf") || strings.HasSuffix(strings.ToLower(fontPath), ".ttf") {
			family := parseTTFFontFamily(fontPath)
			if "" != family {
				if existFont(family, ret) {
					continue
				}

				ret = append(ret, &Font{fontPath, family})
				//logging.LogInfof("[%s] [%s]", fontPath, family)
			}
		}
	}
	return
}

func existFont(family string, fonts []*Font) bool {
	for _, font := range fonts {
		if strings.EqualFold(family, font.Family) {
			return true
		}
	}
	return false
}

func parseTTCFontFamily(fontPath string) (ret []string) {
	defer logging.Recover()

	data, err := os.ReadFile(fontPath)
	if err != nil {
		//logging.LogErrorf("read font file [%s] failed: %s", fontPath, err)
		return
	}
	collection, err := ttc.ParseCollection(data)
	if err != nil {
		//LogErrorf("parse font collection [%s] failed: %s", fontPath, err)
		return
	}

	for i := 0; i < collection.NumFonts(); i++ {
		font, err := collection.Font(i)
		if err != nil {
			//LogErrorf("get font [%s] failed: %s", fontPath, err)
			continue
		}

		family, _ := font.Name(nil, ttc.NameIDFull)
		family = strings.TrimSpace(family)
		if "" != family && !strings.HasPrefix(family, ".") {
			ret = append(ret, family)
		}

		family, _ = font.Name(nil, ttc.NameIDFamily)
		family = strings.TrimSpace(family)
		if "" != family && !strings.HasPrefix(family, ".") {
			ret = append(ret, family)
		}

		family, _ = font.Name(nil, ttc.NameIDTypographicFamily)
		family = strings.TrimSpace(family)
		if "" != family && !strings.HasPrefix(family, ".") {
			ret = append(ret, family)
		}
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func parseTTFFontFamily(fontPath string) (ret string) {
	defer logging.Recover()

	fontFile, err := os.Open(fontPath)
	defer fontFile.Close()
	if err != nil {
		//LogErrorf("open font file [%s] failed: %s", fontPath, err)
		return
	}
	font, err := sfnt.Parse(fontFile)
	if err != nil {
		//LogErrorf("parse font [%s] failed: %s", fontPath, err)
		return
	}

	t, err := font.NameTable()
	if err != nil {
		logging.LogErrorf("get font [%s] name table failed: %s", fontPath, err)
		return
	}

	var family, subfamily string
	for _, e := range t.List() {
		if sfnt.NameFontFamily == e.NameID && (sfnt.PlatformLanguageID(1033) == e.LanguageID || sfnt.PlatformLanguageID(2052) == e.LanguageID) {
			v, _, err := transform.Bytes(textUnicode.UTF16(textUnicode.BigEndian, textUnicode.IgnoreBOM).NewDecoder(), e.Value)
			if err == nil {
				family = strings.TrimSpace(string(v))
			}
		}
		if sfnt.NamePreferredFamily == e.NameID && (sfnt.PlatformLanguageID(1033) == e.LanguageID || sfnt.PlatformLanguageID(2052) == e.LanguageID) {
			v, _, err := transform.Bytes(textUnicode.UTF16(textUnicode.BigEndian, textUnicode.IgnoreBOM).NewDecoder(), e.Value)
			if err == nil {
				family = strings.TrimSpace(string(v))
			}
		}
		if sfnt.NameFontSubfamily == e.NameID && (sfnt.PlatformLanguageID(1033) == e.LanguageID || sfnt.PlatformLanguageID(2052) == e.LanguageID) {
			v, _, err := transform.Bytes(textUnicode.UTF16(textUnicode.BigEndian, textUnicode.IgnoreBOM).NewDecoder(), e.Value)
			if err == nil {
				subfamily = strings.TrimSpace(string(v))
			}
		}
		if sfnt.NamePreferredSubfamily == e.NameID && (sfnt.PlatformLanguageID(1033) == e.LanguageID || sfnt.PlatformLanguageID(2052) == e.LanguageID) {
			v, _, err := transform.Bytes(textUnicode.UTF16(textUnicode.BigEndian, textUnicode.IgnoreBOM).NewDecoder(), e.Value)
			if err == nil {
				subfamily = strings.TrimSpace(string(v))
			}
		}
	}

	//if family != "" && !strings.HasPrefix(family, ".") {
	//	if subfamily != "" && !strings.Contains(subfamily, "<") && !strings.EqualFold(subfamily, "Regular") {
	//		ret = family + "(" + subfamily + ")"
	//	} else {
	//		ret = family
	//	}
	//}
	// TODO: 字重加载方案
	_ = subfamily
	ret = family
	return
}
