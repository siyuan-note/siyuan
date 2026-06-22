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

package agent

import (
	"embed"
	"encoding/json"
	"strings"
	"sync"
)

//go:embed models.json
var modelsJSON embed.FS

// modelMetaEntry 对应 models.json 中单个模型的值对象，目前仅含 contextLength。
type modelMetaEntry struct {
	ContextLength int `json:"contextLength"`
}

var (
	modelContextOnce  sync.Once
	modelContextLimit map[string]int
)

// loadModelContext 惰性解析嵌入的 models.json，构建「模型名 → 上下文窗口」映射。
// models.json 顶层含一个保留的 _meta 元数据对象，解析时跳过它（其值结构与模型条目不同）。
func loadModelContext() map[string]int {
	modelContextOnce.Do(func() {
		raw, err := modelsJSON.ReadFile("models.json")
		if err != nil {
			return
		}
		var decoded map[string]json.RawMessage
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return
		}
		result := make(map[string]int, len(decoded))
		for name, value := range decoded {
			if name == "_meta" {
				continue
			}
			var entry modelMetaEntry
			if err := json.Unmarshal(value, &entry); err != nil {
				continue
			}
			if entry.ContextLength > 0 {
				// key 转小写存储，使匹配大小写不敏感（用户填写 Baichuan4-Turbo / baichuan4-turbo 均可命中）。
				result[strings.ToLower(name)] = entry.ContextLength
			}
		}
		modelContextLimit = result
	})
	return modelContextLimit
}

// GetModelContextLimit 返回模型的上下文窗口大小（单位：token）。未知模型返回 0。
// 匹配大小写不敏感（表 key 与查询参数均转小写）。
// 匹配顺序：先按完整模型名精确查找；再按「末段」（去掉 provider 前缀）查找，
// 兼容用户填写带前缀的 id（如 z-ai/glm-4.6）。表本身以末段为 key，故末段匹配即直接命中。
func GetModelContextLimit(model string) int {
	if model == "" {
		return 0
	}
	table := loadModelContext()
	if table == nil {
		return 0
	}
	lower := strings.ToLower(model)
	if limit, ok := table[lower]; ok {
		return limit
	}
	if idx := strings.LastIndexByte(lower, '/'); idx >= 0 {
		if limit, ok := table[lower[idx+1:]]; ok {
			return limit
		}
	}
	return 0
}
