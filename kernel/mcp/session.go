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

package mcp

import (
	"sync"

	"github.com/88250/gulu"
)

type Session struct {
	ID          string
	initialized bool
	ready       bool
}

var (
	sessionsMu sync.RWMutex
	sessions   = map[string]*Session{}
)

func newSession() *Session {
	s := &Session{
		ID: gulu.Rand.String(16),
	}
	sessionsMu.Lock()
	sessions[s.ID] = s
	sessionsMu.Unlock()
	return s
}

func getSession(id string) *Session {
	sessionsMu.RLock()
	s := sessions[id]
	sessionsMu.RUnlock()
	return s
}

func removeSession(id string) {
	sessionsMu.Lock()
	delete(sessions, id)
	sessionsMu.Unlock()
}
