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
	"path/filepath"

	"github.com/88250/gulu"
)

func I18nTerm(language, key string) (ret string) {
	// 优先按入参 language 拼 .json；找不到时按 BCP 47 ↔ 历史下划线文件名兼容回退。
	p := filepath.Join(WorkingDir, "appearance", "langs", language+".json")
	if _, err := os.Stat(p); nil != err {
		p = filepath.Join(WorkingDir, "appearance", "langs", LangToFile(language)+".json")
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var m map[string]interface{}
	if err = gulu.JSON.UnmarshalJSON(data, &m); err != nil {
		return
	}
	if v, ok := m[key].(string); ok {
		ret = v
	}
	return
}
