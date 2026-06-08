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

var avCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 1000,
	MaxCost:     1024 * 1024 * 200,
	BufferItems: 64,
})

func GetAVData(avID string) (raw []byte, ok bool) {
	v, _ := avCache.Get(avID)
	if nil == v {
		return nil, false
	}
	return v.([]byte), true
}

func SetAVData(avID string, raw []byte) {
	if raw == nil {
		return
	}
	avCache.Set(avID, raw, int64(len(raw)))
}

func RemoveAVData(avID string) {
	avCache.Del(avID)
}

func ClearAVCache() {
	avCache.Clear()
}
