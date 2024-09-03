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

package model

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func SearchWidget(keyword string) (ret []*Block) {
	ret = []*Block{}
	widgetsDir := filepath.Join(util.DataDir, "widgets")
	entries, err := os.ReadDir(widgetsDir)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", widgetsDir, err)
		return
	}

	k := strings.ToLower(keyword)
	var widgets []*bazaar.Widget
	for _, entry := range entries {
		if !util.IsDirRegularOrSymlink(entry) {
			continue
		}
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		widget, _ := bazaar.WidgetJSON(entry.Name())
		if nil == widget {
			continue
		}

		widgets = append(widgets, widget)
	}

	widgets = filterWidgets(widgets, k)
	for _, widget := range widgets {
		b := &Block{
			Name:    bazaar.GetPreferredName(widget.Package),
			Content: widget.Name,
		}
		ret = append(ret, b)
	}

	return
}
