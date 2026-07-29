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
	"errors"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ConradIrwin/font/sfnt"
	"github.com/flopp/go-findfont"
	"github.com/siyuan-note/logging"
)

var (
	sysFonts     []*Font
	sysFontsLock = sync.Mutex{}
)

func LoadSysFonts() []*Font {
	sysFontsLock.Lock()
	defer sysFontsLock.Unlock()

	if 0 < len(sysFonts) {
		return sysFonts
	}

	start := time.Now()
	sysFonts = loadFonts()

	sort.Slice(sysFonts, func(i, j int) bool {
		return sysFonts[i].DisplayName < sysFonts[j].DisplayName
	})

	logging.LogInfof("loaded system fonts [%d] in [%dms]", len(sysFonts), time.Since(start).Milliseconds())
	return sysFonts
}

type Font struct {
	Family      string `json:"family"`      // 对应 CSS font-family
	Weight      int    `json:"weight"`      // 对应 CSS font-weight
	DisplayName string `json:"displayName"` // 给人看的名称 (Family + Subfamily)
}

func loadFonts() (ret []*Font) {
	ret = []*Font{}
	for _, fontPath := range findfont.List() {
		if strings.HasSuffix(strings.ToLower(fontPath), ".ttc") {
			families := parseTTCFontFamily(fontPath)
			for _, f := range families {
				if existFont(f, ret) {
					continue
				}

				ret = append(ret, f)
				//LogInfof("[%s] [%s]", fontPath, family)
			}
		} else if strings.HasSuffix(strings.ToLower(fontPath), ".otf") || strings.HasSuffix(strings.ToLower(fontPath), ".ttf") {
			f := parseTTFFontFamily(fontPath)
			if nil != f {
				if existFont(f, ret) {
					continue
				}

				ret = append(ret, f)
				//logging.LogInfof("[%s] [%s]", fontPath, family)
			}
		}
	}
	return
}

func existFont(f *Font, fonts []*Font) bool {
	for _, font := range fonts {
		if strings.EqualFold(f.Family, font.Family) && f.Weight == font.Weight {
			return true
		}
	}
	return false
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
		font := parseFont(f)
		if nil != font {
			ret = append(ret, font)
		}
	}
	return
}

func parseTTFFontFamily(fontPath string) *Font {
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

func parseFont(font *sfnt.Font) *Font {
	ret, _ := parseFontInfo(font)
	return ret
}

func parseFontInfo(font *sfnt.Font) (*Font, error) {
	t, err := font.NameTable()
	if err != nil {
		return nil, err
	}

	entries := t.List()
	family := selectFontName(entries, sfnt.NamePreferredFamily, sfnt.NameFontFamily)
	subfamily := selectFontName(entries, sfnt.NamePreferredSubfamily, sfnt.NameFontSubfamily)

	weight := 400
	os2, err := font.OS2Table()
	if nil == err {
		weight = int(os2.USWeightClass)
	}

	if weight == 400 && subfamily != "" {
		s := strings.ToLower(subfamily)
		// 自动匹配 W01-W09
		for i := 1; i <= 9; i++ {
			wStr := "w0" + strconv.Itoa(i)
			if strings.Contains(s, wStr) {
				weight = i * 100
				break
			}
		}

		// 自动匹配 W1-W9（部分字体使用不带前导零的缩写）
		if weight == 400 {
			for i := 1; i <= 9; i++ {
				wStr := "w" + strconv.Itoa(i)
				if strings.Contains(s, wStr) {
					weight = i * 100
					break
				}
			}
		}

		// 自动匹配标准关键词
		if weight == 400 { // 如果 W 系列没匹配到
			switch {
			case strings.Contains(s, "thin"):
				weight = 100
			case strings.Contains(s, "light"):
				weight = 300
			case strings.Contains(s, "medium"):
				weight = 500
			case strings.Contains(s, "semibold") || strings.Contains(s, "demi"):
				weight = 600
			case strings.Contains(s, "bold"):
				weight = 700
			case strings.Contains(s, "black") || strings.Contains(s, "heavy"):
				weight = 900
			}
		}
	}

	if family == "" || strings.HasPrefix(family, ".") {
		return nil, errors.New("font family is empty")
	}

	displayName := family
	if subfamily != "" && !strings.EqualFold(subfamily, "Regular") {
		displayName = family + " " + subfamily
	}

	return &Font{
		Family:      family,
		Weight:      weight,
		DisplayName: displayName,
	}, nil
}

func selectFontName(entries []*sfnt.NameEntry, nameIDs ...sfnt.NameID) string {
	for _, nameID := range nameIDs {
		var selected string
		selectedScore := 4
		for _, entry := range entries {
			if entry.NameID != nameID {
				continue
			}

			value := strings.Trim(strings.TrimSpace(entry.String()), "\x00")
			if value == "" {
				continue
			}

			score := 3
			switch {
			case entry.LanguageID == sfnt.PlatformLanguageID(1033):
				score = 0
			case entry.LanguageID == sfnt.PlatformLanguageID(2052):
				score = 1
			case entry.PlatformID == sfnt.PlatformUnicode:
				score = 2
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
