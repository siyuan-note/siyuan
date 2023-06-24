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

package sql

import (
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/dgraph-io/ristretto"
	"github.com/jinzhu/copier"
	gcache "github.com/patrickmn/go-cache"
	"github.com/siyuan-note/logging"
)

var cacheDisabled = true

func enableCache() {
	cacheDisabled = false
}

func disableCache() {
	cacheDisabled = true
}

var blockCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 10240,
	MaxCost:     1024,
	BufferItems: 64,
})

func ClearCache() {
	blockCache.Clear()
}

func putBlockCache(block *Block) {
	if cacheDisabled {
		return
	}

	cloned := &Block{}
	if err := copier.Copy(cloned, block); nil != err {
		logging.LogErrorf("clone block failed: %v", err)
		return
	}
	blockCache.Set(cloned.ID, cloned, 1)
}

func getBlockCache(id string) (ret *Block) {
	if cacheDisabled {
		return
	}

	b, _ := blockCache.Get(id)
	if nil != b {
		ret = b.(*Block)
	}
	return
}

func removeBlockCache(id string) {
	blockCache.Del(id)
	removeRefCacheByDefID(id)
}

var defIDRefsCache = gcache.New(30*time.Minute, 5*time.Minute) // [defBlockID]map[refBlockID]*Ref

func GetRefsCacheByDefID(defID string) (ret []*Ref) {
	for defBlockID, refs := range defIDRefsCache.Items() {
		if defBlockID == defID {
			for _, ref := range refs.Object.(map[string]*Ref) {
				ret = append(ret, ref)
			}
		}
	}
	if 1 > len(ret) {
		ret = QueryRefsByDefID(defID, false)
		for _, ref := range ret {
			putRefCache(ref)
		}
	}
	return
}

func CacheRef(tree *parse.Tree, refNode *ast.Node) {
	ref := buildRef(tree, refNode)
	putRefCache(ref)
}

func putRefCache(ref *Ref) {
	defBlockRefs, ok := defIDRefsCache.Get(ref.DefBlockID)
	if !ok {
		defBlockRefs = map[string]*Ref{}
	}
	defBlockRefs.(map[string]*Ref)[ref.BlockID] = ref
	defIDRefsCache.SetDefault(ref.DefBlockID, defBlockRefs)
}

func removeRefCacheByDefID(defID string) {
	defIDRefsCache.Delete(defID)
}
