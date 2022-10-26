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
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func getVirtualRefKeywords() (ret []string) {
	ret = sql.QueryVirtualRefKeywords(Conf.Search.VirtualRefName, Conf.Search.VirtualRefAlias, Conf.Search.VirtualRefAnchor, Conf.Search.VirtualRefDoc)
	if "" != strings.TrimSpace(Conf.Editor.VirtualBlockRefInclude) {
		include := strings.ReplaceAll(Conf.Editor.VirtualBlockRefInclude, "\\,", "__comma@sep__")
		includes := strings.Split(include, ",")
		var tmp []string
		for _, e := range includes {
			e = strings.ReplaceAll(e, "__comma@sep__", ",")
			tmp = append(tmp, e)
		}
		includes = tmp
		ret = append(ret, includes...)
		ret = gulu.Str.RemoveDuplicatedElem(ret)
	}

	if "" != strings.TrimSpace(Conf.Editor.VirtualBlockRefExclude) {
		exclude := strings.ReplaceAll(Conf.Editor.VirtualBlockRefExclude, "\\,", "__comma@sep__")
		excludes := strings.Split(exclude, ",")
		var tmp []string
		for _, e := range excludes {
			e = strings.ReplaceAll(e, "__comma@sep__", ",")
			tmp = append(tmp, e)
		}
		excludes = tmp
		ret = gulu.Str.ExcludeElem(ret, excludes)
	}
	return
}
