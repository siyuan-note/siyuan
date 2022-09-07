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

package model

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/siyuan-note/siyuan/kernel/search"
)

func SearchWidget(keyword string) (ret []*Block) {
	ret = []*Block{}
	widgets := filepath.Join(util.DataDir, "widgets")
	dirs, err := os.ReadDir(widgets)
	if nil != err {
		logging.LogErrorf("read dir [%s] failed: %s", widgets, err)
		return
	}

	k := strings.ToLower(keyword)
	for _, dir := range dirs {
		name := strings.ToLower(dir.Name())
		if strings.HasPrefix(name, ".") {
			continue
		}

		if strings.Contains(name, k) {
			name = dir.Name()
			if "" != keyword {
				_, name = search.MarkText(dir.Name(), keyword, 32, Conf.Search.CaseSensitive)
			}
			b := &Block{Content: name}
			ret = append(ret, b)
		}
	}
	return
}
