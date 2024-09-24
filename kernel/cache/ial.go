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
	"strings"

	"github.com/88250/lute/editor"
	"github.com/dgraph-io/ristretto"
)

var docIALCache, _ = ristretto.NewCache[string, map[string]string](&ristretto.Config[string, map[string]string]{
	NumCounters: 1024 * 100,
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
	for k, v := range ial {
		ret[k] = strings.ReplaceAll(v, editor.IALValEscNewLine, "\n")
	}
	return
}

func RemoveDocIAL(p string) {
	docIALCache.Del(p)
}

func ClearDocsIAL() {
	docIALCache.Clear()
}

var blockIALCache, _ = ristretto.NewCache[string, map[string]string](&ristretto.Config[string, map[string]string]{
	NumCounters: 1024 * 1000,
	MaxCost:     1024 * 1024 * 200,
	BufferItems: 64,
})

func PutBlockIAL(id string, ial map[string]string) {
	blockIALCache.Set(id, ial, 128)
}

func GetBlockIAL(id string) (ret map[string]string) {
	ial, _ := blockIALCache.Get(id)
	if nil == ial {
		return
	}
	return ial
}

func RemoveBlockIAL(id string) {
	blockIALCache.Del(id)
}

func ClearBlocksIAL() {
	blockIALCache.Clear()
}
