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
	"crypto/sha256"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const pluginSourceReloadDelay = 300 * time.Millisecond

var errPluginFileWatchUnsupported = errors.New("plugin file watcher is not supported on mobile")

type pluginSourceWatchEntry struct {
	path       string
	signature  [sha256.Size]byte
	generation uint64
	timer      *time.Timer
}

type pluginSourceWatchState struct {
	mu      sync.Mutex
	entries map[string]*pluginSourceWatchEntry
	delay   time.Duration
	reload  func(name string)
}

func newPluginSourceWatchState(reload func(name string)) pluginSourceWatchState {
	return pluginSourceWatchState{
		entries: map[string]*pluginSourceWatchEntry{},
		delay:   pluginSourceReloadDelay,
		reload:  reload,
	}
}

func isPluginFileWatchSupported() bool {
	return !util.IsMobileContainer()
}

func (s *pluginSourceWatchState) register(name, path, source string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if old := s.entries[name]; old != nil && old.timer != nil {
		old.timer.Stop()
	}
	s.entries[name] = &pluginSourceWatchEntry{
		path:      path,
		signature: sha256.Sum256([]byte(source)),
	}
}

func (s *pluginSourceWatchState) unregister(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if entry := s.entries[name]; entry != nil && entry.timer != nil {
		entry.timer.Stop()
	}
	delete(s.entries, name)
}

func (s *pluginSourceWatchState) schedule(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry := s.entries[name]
	if entry == nil {
		return
	}
	entry.generation++
	generation := entry.generation
	if entry.timer != nil {
		entry.timer.Stop()
	}
	entry.timer = time.AfterFunc(s.delay, func() {
		s.reloadIfChanged(name, generation)
	})
}

func (s *pluginSourceWatchState) reloadIfChanged(name string, generation uint64) {
	s.mu.Lock()
	entry := s.entries[name]
	if entry == nil || entry.generation != generation {
		s.mu.Unlock()
		return
	}
	path := entry.path
	previous := entry.signature
	s.mu.Unlock()

	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			logging.LogWarnf("read kernel plugin source file [%s] failed: %s", path, err)
		}
		return
	}
	signature := sha256.Sum256(data)
	if signature == previous {
		return
	}

	s.mu.Lock()
	entry = s.entries[name]
	if entry == nil || entry.generation != generation {
		s.mu.Unlock()
		return
	}
	entry.signature = signature
	entry.timer = nil
	reload := s.reload
	s.mu.Unlock()

	if reload != nil {
		reload(name)
	}
}

func (m *PluginManager) handlePluginSourceEvent(event fsnotify.Event) {
	if filepath.Base(event.Name) != "kernel.js" {
		return
	}
	if !event.Has(fsnotify.Create) && !event.Has(fsnotify.Write) &&
		!event.Has(fsnotify.Rename) && !event.Has(fsnotify.Remove) {
		return
	}

	m.sourceWatch.schedule(filepath.Base(filepath.Dir(event.Name)))
}
