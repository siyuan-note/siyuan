// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	if t.CapabilityID == "" {
		t.CapabilityID = BuildCapabilityID("native", "backend", t.Name)
	}
	if t.Runtime == "" {
		t.Runtime = "kernel"
	}
	attachEncryptedBoxLeaseResolver(t)
	if err := SetTool(t.Name, t); err != nil {
		panic(fmt.Sprintf("register MCP tool [%s]: %v", t.Name, err))
	}
}
