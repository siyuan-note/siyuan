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

package cache

import (
	"github.com/dgraph-io/ristretto"
)

type treeCacheEntry struct {
	raw []byte
}

var (
	treeCache, _ = ristretto.NewCache(&ristretto.Config{
		NumCounters: 8,
		MaxCost:     1024 * 1024 * 200,
		BufferItems: 64,
	})
)

func GetTreeData(rootID string) (raw []byte, ok bool) {
	v, _ := treeCache.Get(rootID)
	if nil == v {
		return nil, false
	}
	e := v.(*treeCacheEntry)
	return e.raw, true
}

func SetTreeData(rootID string, raw []byte) {
	if raw == nil {
		return
	}
	entry := &treeCacheEntry{raw: raw}
	treeCache.Set(rootID, entry, int64(len(raw)))
}

func RemoveTreeData(rootID string) {
	treeCache.Del(rootID)
}

func ClearTreeCache() {
	treeCache.Clear()
}
