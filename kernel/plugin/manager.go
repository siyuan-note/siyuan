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
	"context"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/fsnotify/fsnotify"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type PluginManagerState int64

const (
	PluginManagerStateStopped PluginManagerState = iota
	PluginManagerStateRunning
)

// PluginManager discovers, loads, starts, and stops kernel plugins.
type PluginManager struct {
	state       PluginManagerState // protected by lifecycleMu
	lifecycleMu sync.RWMutex       // protects the lifecycle state of the manager (starting/stopping), allowing concurrent start/stop of different plugins while preventing concurrent start/stop of the entire manager

	pluginsDir string // base directory for plugins (e.g. /path/to/workspace/data/plugins)

	context context.Context   // Context for managing plugin manager lifecycle
	watcher *fsnotify.Watcher // watcher for kernel plugin source file changes, to trigger hot reload

	plugins   sync.Map // map[string]*KernelPlugin
	pluginsMu sync.Map // map[string]*sync.Mutex, one per plugin name, to serialize start/stop of the same plugin while allowing concurrent start/stop of different plugins

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

	model.OnKernelPluginsStart = func() { GetManager().Start() }
	model.OnKernelPluginsStop = func() { GetManager().Stop() }

	m.Start()
}

// GetManager returns the singleton PluginManager.
func GetManager() *PluginManager {
	managerOnce.Do(func() {
		context := context.Background()

		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			logging.LogErrorf("failed to create kernel plugin source file watcher: %s", err)
		} else if watcher != nil {
			go func() {
				defer watcher.Close()

				for {
					select {
					case <-context.Done():
						return
					case event, ok := <-watcher.Events:
						if !ok {
							return
						}

						pluginDir, fileName := filepath.Split(event.Name)
						pluginName := filepath.Base(pluginDir)
						if fileName == "kernel.js" {
							switch event.Op {
							case fsnotify.Create, fsnotify.Write:
								petal := model.GetPetalByName(pluginName)
								if petal != nil && petal.Enabled {
									logging.LogInfof("[plugin:%s] source file kernel.js changed, reloading plugin", petal.Name)
									go model.SetPetalEnabled(petal.Name, petal.Enabled)
								}
							}
						}
					case err, ok := <-watcher.Errors:
						if !ok {
							return
						}
						logging.LogErrorf("kernel plugin source file watcher error: %s", err)
					}
				}
			}()
		}

		manager = &PluginManager{
			state: PluginManagerStateStopped,

			pluginsDir: filepath.Join(util.DataDir, "plugins"),

			context: context,
			watcher: watcher,
		}
	})
	return manager
}

func (m *PluginManager) State() PluginManagerState {
	m.lifecycleMu.RLock()
	defer m.lifecycleMu.RUnlock()
	return m.state
}

// Start loads and starts all kernel-eligible plugins.
// Called from main.go after model initialization.
func (m *PluginManager) Start() {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("kernel plugin manager failed to start: %v", r)
		}
	}()

	if m.State() == PluginManagerStateRunning {
		logging.LogInfof("kernel plugin manager is already running, skipping start")
		return
	}

	if model.Conf.Bazaar.PetalDisabled || !model.Conf.Bazaar.Trust {
		logging.LogInfof("kernel plugins are disabled by configuration, skipping start")
		return
	}

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

	m.state = PluginManagerStateRunning
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

	if m.State() == PluginManagerStateStopped {
		logging.LogInfof("kernel plugin manager is already stopped, skipping stop")
		return
	}

	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()

	logging.LogInfof("kernel plugin manager stopping")

	all := int64(0)
	counter := int64(0)

	wg := sync.WaitGroup{}
	m.plugins.Range(func(key, value any) bool {
		atomic.AddInt64(&all, 1)
		if p, ok := value.(*KernelPlugin); ok {
			wg.Go(func() {
				if ok := m.StopPlugin(p.Petal); ok {
					atomic.AddInt64(&counter, 1)
				}
			})
		}
		return true
	})
	wg.Wait()

	m.state = PluginManagerStateStopped
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

	if model.Conf.Bazaar.PetalDisabled || !model.Conf.Bazaar.Trust {
		ok = false
		return
	}

	if petal.Kernel.Incompatible || !petal.Kernel.Existed {
		ok = false
		return
	}

	m.StopPlugin(petal) // stop first in case it's already running, to allow hot reload

	pluginMu := m.getPluginMu(petal.Name)
	pluginMu.Lock()
	defer pluginMu.Unlock()

	m.addPluginSourceWatch(petal.Name)

	p := NewKernelPlugin(m.context, petal)

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
func (m *PluginManager) StopPlugin(petal *model.Petal) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("[plugin:%s] panic during stop: %v", petal.Name, r)
			ok = false
		}
	}()

	pluginMu := m.getPluginMu(petal.Name)
	pluginMu.Lock()
	defer pluginMu.Unlock()

	m.removePluginSourceWatch(petal.Name)

	value, loaded := m.plugins.LoadAndDelete(petal.Name)

	if loaded {
		p := value.(*KernelPlugin)
		if success, err := p.stop(); err != nil {
			logging.LogErrorf("[plugin:%s] stop failed: %s", p.Name, err)
			ok = false
		} else {
			ok = success
		}
	} else {
		ok = false
	}
	return
}

// getPluginMu returns the per-plugin mutex for the given name, creating it if needed.
func (m *PluginManager) getPluginMu(name string) *sync.Mutex {
	v, _ := m.pluginsMu.LoadOrStore(name, &sync.Mutex{})
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
	p := m.GetPlugin(name)
	if p != nil {
		return &PluginInfo{
			Name:    p.Name,
			State:   p.State().String(),
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

// addPluginSourceWatch adds the plugin's base directory to the fsnotify watcher to watch for source file changes for hot reload.
func (m *PluginManager) addPluginSourceWatch(name string) {
	if m.watcher == nil {
		return
	}
	path := filepath.Join(m.pluginsDir, name)
	if err := m.watcher.Add(path); err != nil {
		logging.LogErrorf("failed to add kernel plugin source path [%s] to watcher: %s", path, err)
	}
}

// removePluginSourceWatch removes the plugin's base directory from the fsnotify watcher when the plugin is stopped.
func (m *PluginManager) removePluginSourceWatch(name string) {
	if m.watcher == nil {
		return
	}
	path := filepath.Join(m.pluginsDir, name)
	if err := m.watcher.Remove(path); err != nil {
		logging.LogErrorf("failed to remove kernel plugin source path [%s] from watcher: %s", path, err)
	}
}
