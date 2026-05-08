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
	"maps"

	"github.com/dgraph-io/ristretto"
)

var docIALCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 100000,
	MaxCost:     1024 * 1024 * 200,
	BufferItems: 64,
})

func PutDocIAL(p string, ial map[string]string) {
	docIALCache.Set(p, ial, 128)
}

func GetDocIAL(p string) (ret map[string]string) {
	ial, _ := docIALCache.Get(p)
	if nil == ial {
		return
	}

	ret = map[string]string{}
	maps.Copy(ret, ial.(map[string]string))
	return
}

func RemoveDocIAL(p string) {
	docIALCache.Del(p)
}

func ClearDocsIAL() {
	docIALCache.Clear()
}

var blockIALCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 100000,
	MaxCost:     1024 * 1024 * 200,
	BufferItems: 64,
})

func PutBlockIAL(id string, ial map[string]string) {
	// 这里存入的属性值都是反转义过的，用的是 parse.IAL2Map()，而不是 parse.IAL2MapUnEsc()
	blockIALCache.Set(id, ial, 128)
}

func GetBlockIAL(id string) (ret map[string]string) {
	ial, _ := blockIALCache.Get(id)
	if nil == ial {
		return
	}
	return ial.(map[string]string)
}

func RemoveBlockIAL(id string) {
	blockIALCache.Del(id)
}

func ClearBlocksIAL() {
	blockIALCache.Clear()
}
