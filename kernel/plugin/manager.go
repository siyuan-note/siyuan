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

package plugin

import (
	"sync"
	"sync/atomic"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// PluginManager discovers, loads, starts, and stops kernel plugins.
type PluginManager struct {
	lifecycleMu sync.Mutex // protects the lifecycle state of the manager (starting/stopping), allowing concurrent start/stop of different plugins while preventing concurrent start/stop of the entire manager

	plugins sync.Map // map[string]*KernelPlugin

	pluginMu sync.Map // map[string]*sync.Mutex, one per plugin name, to serialize start/stop of the same plugin while allowing concurrent start/stop of different plugins
}

type PluginInfo struct {
	Name    string           `json:"name"`
	State   string           `json:"state"`
	Methods []*RpcMethodInfo `json:"methods"`
}

var (
	manager     *PluginManager
	managerOnce sync.Once
)

// InitManager initializes the global PluginManager singleton and starts it.
func InitManager() {
	m := GetManager()

	model.OnKernelPluginStart = func(petal *model.Petal) { GetManager().StartPlugin(petal) }
	model.OnKernelPluginStop = func(petal *model.Petal) { GetManager().StopPlugin(petal) }
	model.OnKernelPluginShutdown = func() { GetManager().Stop() }

	m.Start()
}

// GetManager returns the singleton PluginManager.
func GetManager() *PluginManager {
	managerOnce.Do(func() {
		manager = &PluginManager{}
	})
	return manager
}

// Start loads and starts all kernel-eligible plugins.
// Called from main.go after model initialization.
func (m *PluginManager) Start() {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("kernel plugin manager failed to start: %v", r)
		}
	}()

	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()

	logging.LogInfof("kernel plugin manager starting")

	petals := model.LoadKernelPetals()

	all := len(petals)
	counter := int64(0)

	wg := sync.WaitGroup{}
	for _, petal := range petals {
		wg.Go(func() {
			if ok := m.StartPlugin(petal); ok {
				atomic.AddInt64(&counter, 1)
			}
		})
	}
	wg.Wait()

	logging.LogInfof("kernel plugin manager started, %d/%d plugin(s) loaded", counter, all)
}

// Stop shuts down all running kernel plugins.
// Called from model.Close() before process exit.
func (m *PluginManager) Stop() {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("kernel plugin manager failed to stop: %v", r)
		}
	}()

	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()

	logging.LogInfof("kernel plugin manager stopping")

	all := int64(0)
	counter := int64(0)

	wg := sync.WaitGroup{}
	m.plugins.Range(func(key, value any) bool {
		atomic.AddInt64(&all, 1)
		p := value.(*KernelPlugin)
		wg.Go(func() {
			ok, err := p.stop()
			if err != nil {
				logging.LogErrorf("[plugin:%s] stop failed: %s", p.Name, err)
			}
			if ok {
				atomic.AddInt64(&counter, 1)
			}
		})
		return true
	})
	wg.Wait()

	logging.LogInfof("kernel plugin manager stopped, %d/%d plugin(s) unloaded", counter, all)
}

// StartPlugin starts a single kernel plugin.
// Called when a petal is enabled via SetPetalEnabled.
func (m *PluginManager) StartPlugin(petal *model.Petal) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("[plugin:%s] panic during start: %v", petal.Name, r)
			ok = false
		}
	}()

	pluginMu := m.getPluginMu(petal.Name)
	pluginMu.Lock()
	defer pluginMu.Unlock()

	m.stopPlugin(petal)

	p := NewKernelPlugin(petal)

	m.plugins.Store(p.Name, p)

	if err := p.start(); err != nil {
		logging.LogErrorf("[plugin:%s] start failed: %s", p.Name, err)
		ok = false
		return
	}

	ok = true
	return
}

// StopPlugin stops a single kernel plugin.
// Called when a petal is disabled via SetPetalEnabled.
func (m *PluginManager) StopPlugin(petal *model.Petal) {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("[plugin:%s] panic during stop: %v", petal.Name, r)
		}
	}()

	pluginMu := m.getPluginMu(petal.Name)
	pluginMu.Lock()
	defer pluginMu.Unlock()

	m.stopPlugin(petal)
}

// stopPlugin removes and stops the plugin without acquiring the per-plugin mutex.
// Callers must hold the per-plugin mutex returned by getPluginMu.
func (m *PluginManager) stopPlugin(petal *model.Petal) {
	value, loaded := m.plugins.LoadAndDelete(petal.Name)

	if loaded {
		p := value.(*KernelPlugin)
		if _, err := p.stop(); err != nil {
			logging.LogErrorf("[plugin:%s] stop failed: %s", p.Name, err)
		}
	}
}

// getPluginMu returns the per-plugin mutex for the given name, creating it if needed.
func (m *PluginManager) getPluginMu(name string) *sync.Mutex {
	v, _ := m.pluginMu.LoadOrStore(name, &sync.Mutex{})
	return v.(*sync.Mutex)
}

// GetPlugin returns a loaded KernelPlugin by name, or nil.
func (m *PluginManager) GetPlugin(name string) *KernelPlugin {
	value, loaded := m.plugins.Load(name)
	if loaded {
		return value.(*KernelPlugin)
	}
	return nil
}

// GetLoadedPlugin returns the plugin info for a loaded KernelPlugin by name, or nil.
func (m *PluginManager) GetLoadedPlugin(name string) (plugin *PluginInfo, found bool) {
	value, loaded := m.plugins.Load(name)
	if loaded {
		p := value.(*KernelPlugin)
		return &PluginInfo{
			Name:    p.Name,
			Methods: p.GetRpcMethodsInfo(),
		}, true
	}
	return nil, false
}

// GetLoadedPluginInfo returns a list of all loaded plugins with their RPC method info.
func (m *PluginManager) GetLoadedPluginsInfo() (plugins []*PluginInfo) {
	m.plugins.Range(func(key, value any) bool {
		p := value.(*KernelPlugin)
		plugins = append(plugins, &PluginInfo{
			Name:    p.Name,
			State:   p.State().String(),
			Methods: p.GetRpcMethodsInfo(),
		})
		return true
	})
	return plugins
}
