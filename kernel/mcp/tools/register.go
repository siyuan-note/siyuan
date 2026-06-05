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

package tools

import "sync"

var registryMu sync.RWMutex
var Registry = map[string]*Tool{}

func GetTool(name string) *Tool {
	registryMu.RLock()
	defer registryMu.RUnlock()
	return Registry[name]
}

func GetAllTools() []*Tool {
	registryMu.RLock()
	defer registryMu.RUnlock()
	result := make([]*Tool, 0, len(Registry))
	for _, t := range Registry {
		result = append(result, t)
	}
	return result
}

func SetTool(name string, t *Tool) {
	registryMu.Lock()
	defer registryMu.Unlock()
	Registry[name] = t
}

func register(t *Tool) {
	SetTool(t.Name, t)
}
