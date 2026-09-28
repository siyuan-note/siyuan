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

import "strings"

// DocTitleSlash 是文档标题中的斜杠在层级路径中的编码。
const DocTitleSlash = "\U000F0000"

func EncodeDocTitlePath(title string) string {
	return strings.ReplaceAll(title, "/", DocTitleSlash)
}

func DecodeDocTitlePath(title string) string {
	return strings.ReplaceAll(title, DocTitleSlash, "/")
}
