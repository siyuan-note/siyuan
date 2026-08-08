// SiYuan - From thought to insight, with agents
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

package model

import (
	"sync"
	"time"
)

const syncRemoteCompletedTTL = time.Minute

type syncRemoteKey struct {
	scope    string
	latestID string
}

type syncRemoteCall struct {
	done    chan struct{}
	success bool
}

type syncRemoteDeduper struct {
	lock      sync.Mutex
	running   map[syncRemoteKey]*syncRemoteCall
	completed map[syncRemoteKey]time.Time
	ttl       time.Duration
	now       func() time.Time
}

func newSyncRemoteDeduper(ttl time.Duration) *syncRemoteDeduper {
	return &syncRemoteDeduper{
		running:   map[syncRemoteKey]*syncRemoteCall{},
		completed: map[syncRemoteKey]time.Time{},
		ttl:       ttl,
		now:       time.Now,
	}
}

// do 将同一同步作用域和云端提交的并发请求合并为一次，失败时允许等待中的请求接替重试。
func (deduper *syncRemoteDeduper) do(scope, latestID string, action func() error) (executed bool, err error) {
	key := syncRemoteKey{scope: scope, latestID: latestID}
	for {
		call, owner, completed := deduper.begin(key)
		if completed {
			return false, nil
		}
		if !owner {
			<-call.done
			if call.success {
				return false, nil
			}
			continue
		}

		success := false
		func() {
			defer func() {
				deduper.finish(key, call, success)
			}()
			err = action()
			success = nil == err
		}()
		return true, err
	}
}

func (deduper *syncRemoteDeduper) begin(key syncRemoteKey) (call *syncRemoteCall, owner, completed bool) {
	deduper.lock.Lock()
	defer deduper.lock.Unlock()

	deduper.pruneCompletedLocked(deduper.now())
	if _, ok := deduper.completed[key]; ok {
		return nil, false, true
	}
	if call = deduper.running[key]; nil != call {
		return call, false, false
	}
	call = &syncRemoteCall{done: make(chan struct{})}
	deduper.running[key] = call
	return call, true, false
}

func (deduper *syncRemoteDeduper) finish(key syncRemoteKey, call *syncRemoteCall, success bool) {
	deduper.lock.Lock()
	delete(deduper.running, key)
	call.success = success
	if success {
		deduper.completed[key] = deduper.now()
	}
	close(call.done)
	deduper.lock.Unlock()
}

func (deduper *syncRemoteDeduper) isCompleted(scope, latestID string) bool {
	deduper.lock.Lock()
	defer deduper.lock.Unlock()

	deduper.pruneCompletedLocked(deduper.now())
	_, ret := deduper.completed[syncRemoteKey{scope: scope, latestID: latestID}]
	return ret
}

func (deduper *syncRemoteDeduper) complete(scope, latestID string) {
	if "" == latestID {
		return
	}
	deduper.lock.Lock()
	deduper.completed[syncRemoteKey{scope: scope, latestID: latestID}] = deduper.now()
	deduper.lock.Unlock()
}

func (deduper *syncRemoteDeduper) pruneCompletedLocked(now time.Time) {
	for completedKey, completedAt := range deduper.completed {
		if now.Sub(completedAt) >= deduper.ttl {
			delete(deduper.completed, completedKey)
		}
	}
}

var syncRemoteRequests = newSyncRemoteDeduper(syncRemoteCompletedTTL)
