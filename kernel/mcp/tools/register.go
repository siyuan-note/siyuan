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

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

var registryMu sync.RWMutex
var Registry = map[string]*Tool{}
var registryValidators = map[string]*ToolValidator{}
var registryObservers = map[uint64]func(string, *Tool){}
var registryObserverID uint64

func GetTool(name string) *Tool {
	tool, _ := LookupToolWithValidator(name)
	return tool
}

func LookupTool(name string) *Tool {
	tool, _ := LookupToolWithValidator(name)
	return tool
}

func LookupToolWithValidator(name string) (*Tool, *ToolValidator) {
	registryMu.RLock()
	defer registryMu.RUnlock()

	key, tool := lookupToolLocked(name)
	return tool, registryValidators[key]
}

func lookupToolLocked(name string) (string, *Tool) {
	name = strings.TrimSpace(name)

	if t := Registry[name]; t != nil {
		return name, t
	}

	lower := strings.ToLower(name)
	for k, v := range Registry {
		if strings.ToLower(k) == lower {
			return k, v
		}
	}

	if prefix := "siyuan_"; strings.HasPrefix(lower, prefix) {
		base := strings.TrimPrefix(lower, prefix)
		for k, v := range Registry {
			if strings.ToLower(k) == base {
				return k, v
			}
		}
	}

	return "", nil
}

func GetAllTools() []*Tool {
	registryMu.RLock()
	defer registryMu.RUnlock()
	result := make([]*Tool, 0, len(Registry))
	for _, t := range Registry {
		result = append(result, t)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})
	return result
}

func SetTool(name string, t *Tool) error {
	validator, err := CompileToolValidator(t)
	if err != nil {
		return err
	}
	registryMu.Lock()
	defer registryMu.Unlock()
	Registry[name] = t
	registryValidators[name] = validator
	notifyRegistryObservers(name, t)
	return nil
}

func RemoveTool(name string) {
	registryMu.Lock()
	defer registryMu.Unlock()
	delete(Registry, name)
	delete(registryValidators, name)
	notifyRegistryObservers(name, nil)
}

func RemoveToolIf(name string, tool *Tool) {
	registryMu.Lock()
	defer registryMu.Unlock()
	if Registry[name] == tool {
		delete(Registry, name)
		delete(registryValidators, name)
		notifyRegistryObservers(name, nil)
	}
}

// ObserveRegistry 监听工具注册表变更，并在注册监听器时按名称顺序发送当前工具快照。
func ObserveRegistry(observer func(string, *Tool)) (stop func()) {
	registryMu.Lock()
	registryObserverID++
	id := registryObserverID
	registryObservers[id] = observer
	names := make([]string, 0, len(Registry))
	for name := range Registry {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		observer(name, Registry[name])
	}
	registryMu.Unlock()

	return func() {
		registryMu.Lock()
		delete(registryObservers, id)
		registryMu.Unlock()
	}
}

func notifyRegistryObservers(name string, tool *Tool) {
	for _, observer := range registryObservers {
		observer(name, tool)
	}
}

func register(t *Tool) {
	if t.Source == "" {
		t.Source = "native"
	}
	attachEncryptedBoxLeaseResolver(t)
	if err := SetTool(t.Name, t); err != nil {
		panic(fmt.Sprintf("register MCP tool [%s]: %v", t.Name, err))
	}
}
