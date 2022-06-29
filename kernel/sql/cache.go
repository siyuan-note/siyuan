// SiYuan - Build Your Eternal Digital Garden
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
	"runtime/debug"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/dgraph-io/ristretto"
	gcache "github.com/patrickmn/go-cache"
)

var memCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 800000,
	MaxCost:     1000 * 1000 * 100,
	BufferItems: 64,
})
var disabled = true

func EnableCache() {
	disabled = false
}

func DisableCache() {
	disabled = true
}

func ClearBlockCache() {
	memCache.Clear()
	debug.FreeOSMemory()
}

func putBlockCache(block *Block) {
	if disabled {
		return
	}
	memCache.Set(block.ID, block, 1)
}

func getBlockCache(id string) (ret *Block) {
	if disabled {
		return
	}

	b, _ := memCache.Get(id)
	if nil != b {
		ret = b.(*Block)
	}
	return
}

func removeBlockCache(id string) {
	memCache.Del(id)
	removeRefCacheByDefID(id)
}

func getVirtualRefKeywordsCache() ([]string, bool) {
	if disabled {
		return nil, false
	}

	if val, ok := memCache.Get("virtual_ref"); ok {
		return val.([]string), true
	}
	return nil, false
}

func setVirtualRefKeywords(keywords []string) {
	if disabled {
		return
	}

	memCache.Set("virtual_ref", keywords, 1)
}

func ClearVirtualRefKeywords() {
	memCache.Del("virtual_ref")
}

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

var defIDRefsCache = gcache.New(30*time.Minute, 5*time.Minute) // [defBlockID]map[refBlockID]*Ref

func CacheRef(tree *parse.Tree, refIDNode *ast.Node) {
	ref := buildRef(tree, refIDNode)
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
