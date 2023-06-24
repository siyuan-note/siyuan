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

package api

import (
	"github.com/88250/clipboard"
	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
)

func readFilePaths(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	var paths []string
	if !gulu.OS.IsLinux() { // Linux 端不再支持 `粘贴为纯文本` 时处理文件绝对路径 https://github.com/siyuan-note/siyuan/issues/5825
		paths, _ = clipboard.ReadFilePaths()
	}
	if 1 > len(paths) {
		paths = []string{}
	}
	ret.Data = paths
}
