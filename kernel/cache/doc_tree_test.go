// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cache

import (
	"fmt"
	"reflect"
	"strconv"
	"testing"
)

func TestDocTreeCacheMutationAndIsolation(t *testing.T) {
	InvalidateDocTree("")
	t.Cleanup(func() { InvalidateDocTree("") })
	version, stable := DocTreeSourceVersion("box-a", false)
	if !stable {
		t.Fatal("unexpected pending source write")
	}
	ids := []string{"first", "second"}
	order, ok := PutDocTreeOrder("a", "box-a", false, version, ids)
	if !ok {
		t.Fatal("initial admission failed")
	}
	ids[0] = "changed"
	batch := order.IDs(0, 1)
	batch[0] = "changed"
	if !reflect.DeepEqual(order.IDs(0, 2), []string{"first", "second"}) || order.Index("second") != 1 {
		t.Fatal("a caller changed the cached ordering")
	}
	finishOther := BeginDocTreeMutation("box-b")
	if GetDocTreeOrder("a", "box-a", false) != order {
		t.Fatal("unrelated notebook invalidated")
	}
	finishOther()
	finish := BeginDocTreeMutation("box-a")
	if _, stable := DocTreeSourceVersion("box-a", false); stable || GetDocTreeOrder("a", "box-a", false) != nil {
		t.Fatal("in-progress source write exposed a cached order")
	}
	if _, ok := PutDocTreeOrder("a", "box-a", false, version, ids); ok {
		t.Fatal("old builder was admitted during write")
	}
	finish()
	if DocTreeOrderCurrent(order) {
		t.Fatal("in-flight old order survived completed mutation")
	}
	if _, ok := PutDocTreeOrder("a", "box-a", false, version, ids); ok {
		t.Fatal("old builder was admitted after write")
	}
}

func TestDocTreeCacheReferencesAndBounds(t *testing.T) {
	InvalidateDocTree("")
	t.Cleanup(func() { InvalidateDocTree("") })
	source, _ := DocTreeSourceVersion("box", false)
	refs, _ := DocTreeSourceVersion("box", true)
	plain, _ := PutDocTreeOrder("plain", "box", false, source, []string{"a"})
	ordered, _ := PutDocTreeOrder("refs", "box", true, refs, []string{"a"})
	InvalidateDocTreeRefs()
	if GetDocTreeOrder("plain", "box", false) != plain || DocTreeOrderCurrent(ordered) {
		t.Fatal("reference invalidation did not preserve independent sorting")
	}
	finishRefs := BeginDocTreeRefMutation()
	if _, stable := DocTreeSourceVersion("box", true); stable {
		t.Fatal("reference readers admitted during index commit")
	}
	if GetDocTreeOrder("plain", "box", false) != plain {
		t.Fatal("independent ordering invalidated by an index commit")
	}
	finishRefs()
	for i := 0; i < docTreeOrderMaxEntries+1; i++ {
		PutDocTreeOrder(fmt.Sprint(i), "box", false, source, []string{"a", "b"})
	}
	docTreeOrders.Lock()
	if len(docTreeOrders.entries) > docTreeOrderMaxEntries || docTreeOrders.bytes > docTreeOrderMaxBytes {
		t.Error("cache exceeded its bounds")
	}
	docTreeOrders.Unlock()
	if GetDocTreeOrder("plain", "box", false) != nil {
		t.Fatal("least recently used entry not evicted")
	}
	rebuilt, _ := PutDocTreeOrder("plain", "box", false, source, []string{"a"})
	if rebuilt.Revision() != plain.Revision() {
		t.Fatal("unchanged cache eviction forced a new revision")
	}
	finish := BeginDocTreeMutation("")
	if DocTreeOrderCurrent(rebuilt) {
		t.Fatal("bulk replacement retained old orders")
	}
	finish()
}

func TestDocTreeCacheDocumentDependencies(t *testing.T) {
	InvalidateDocTree("")
	t.Cleanup(func() { InvalidateDocTree("") })
	version, _ := DocTreeSourceVersion("box", false)
	orders := map[string]*DocTreeOrder{}
	for key, scope := range map[string]DocTreeOrderScope{
		"custom": {Directory: "/", Sorts: []int{1}}, "name": {Directory: "/", Title: true},
		"updated": {Directory: "/", Updated: true}, "size": {Directory: "/", Size: true},
		"elsewhere": {Directory: "/parent", Updated: true, Size: true},
	} {
		orders[key], _ = PutDocTreeOrder(key, "box", false, version, []string{"a"}, scope)
		if orders[key].bytes != 256+len(key)+len("box")+40+len("a")+len(scope.Directory)+(len(scope.Sorts)+1)*(strconv.IntSize/8) {
			t.Fatalf("cache cost omits scope metadata for %s", key)
		}
	}
	finish := BeginDocTreeDocumentMutation("box", "/a.sy", DocTreeDocumentChange{Updated: true, Size: true})
	if DocTreeOrderCurrent(orders["custom"]) {
		t.Fatal("in-flight document write admitted readers")
	}
	if _, ok := PutDocTreeOrder("late", "box", false, version, []string{"a"}, DocTreeOrderScope{Directory: "/"}); ok {
		t.Fatal("old in-flight builder wrote back during mutation")
	}
	finish()
	for key, order := range orders {
		preserved := key == "custom" || key == "name" || key == "elsewhere"
		if (GetDocTreeOrder(key, "box", false) == order) != preserved || DocTreeOrderCurrent(order) != preserved {
			t.Fatalf("incorrect dependency invalidation for %s", key)
		}
	}
	if _, ok := PutDocTreeOrder("late", "box", false, version, []string{"a"}, DocTreeOrderScope{Directory: "/"}); ok {
		t.Fatal("old in-flight builder wrote back after mutation")
	}
	finish = BeginDocTreeDocumentMutation("box", "/a.sy", DocTreeDocumentChange{Structure: true})
	finish()
	for key, order := range orders {
		if GetDocTreeOrder(key, "box", false) != nil || DocTreeOrderCurrent(order) {
			t.Fatalf("visibility or inherited sorting change retained %s", key)
		}
	}
}

func TestDocTreeCacheChildCounts(t *testing.T) {
	InvalidateDocTree("")
	t.Cleanup(func() { InvalidateDocTree("") })
	version, _ := DocTreeSourceVersion("box", false)
	counts := []int{3, -1}
	order, _ := PutDocTreeOrder("counts", "box", false, version, []string{"a", "b"},
		DocTreeOrderScope{Directory: "/", ChildCounts: counts})
	counts[0] = 9
	if count, ok := order.ChildCount(0); !ok || count != 3 {
		t.Fatalf("precomputed count was not copied: %d, %v", count, ok)
	}
	if _, ok := order.ChildCount(1); ok {
		t.Fatal("unloaded count treated as an empty directory")
	}
	order.SetChildCount(1, 0)
	finish := BeginDocTreeDocumentMutation("box", "/a/child.sy", DocTreeDocumentChange{Updated: true, Size: true})
	if _, ok := order.ChildCount(0); ok {
		t.Fatal("pending source write exposed a count")
	}
	finish()
	if count, ok := order.ChildCount(1); !ok || count != 0 {
		t.Fatal("body edit discarded an unchanged child count")
	}
	finish = BeginDocTreeDocumentMutation("box", "/a/child.sy", DocTreeDocumentChange{Structure: true})
	finish()
	order.SetChildCount(0, 7)
	if _, ok := order.ChildCount(0); ok {
		t.Fatal("visibility mutation retained an old count or admitted a late result")
	}
}

func TestDocTreeChildCountCreationAndSortInvalidation(t *testing.T) {
	InvalidateDocTree("")
	t.Cleanup(func() { InvalidateDocTree("") })
	version, _ := DocTreeSourceVersion("box", true)
	for _, directory := range []string{"/", "/large", "/new", "/new/nested"} {
		PutDocTreeChildCount("policy", "box", directory, version, 10000)
	}
	PutDocTreeChildCount("other-policy", "box", "/large", version, 4)
	finish := BeginDocTreeCreation("box", "/new.sy")
	if _, ok := GetDocTreeChildCount("policy", "box", "/large"); ok {
		t.Fatal("pending creation exposed cached counts")
	}
	finish()
	for _, directory := range []string{"/", "/new", "/new/nested"} {
		if _, ok := GetDocTreeChildCount("policy", "box", directory); ok {
			t.Fatalf("creation retained affected count %s", directory)
		}
	}
	for key, want := range map[string]int{"policy": 10000, "other-policy": 4} {
		if count, ok := GetDocTreeChildCount(key, "box", "/large"); !ok || count != want {
			t.Fatalf("unrelated directory or access policy count lost: %s %d %v", key, count, ok)
		}
	}
	PutDocTreeChildCount("late", "box", "/large", version, 1)
	if _, ok := GetDocTreeChildCount("late", "box", "/large"); ok {
		t.Fatal("old builder published after creation")
	}
	finish = BeginDocTreeSortMutation()
	if _, ok := GetDocTreeChildCount("policy", "box", "/large"); ok {
		t.Fatal("pending sort write exposed counts")
	}
	finish()
	if count, ok := GetDocTreeChildCount("policy", "box", "/large"); !ok || count != 10000 {
		t.Fatal("sort-only write discarded authenticated counts")
	}
	finish = BeginDocTreeCreation("box", "/large/child.sy")
	finish()
	if _, ok := GetDocTreeChildCount("policy", "box", "/large"); ok {
		t.Fatal("new child retained its parent's old count")
	}
	version, _ = DocTreeSourceVersion("box", true)
	PutDocTreeChildCount("policy", "box", "/large", version, 10001)
	finish = BeginDocTreeDocumentMutation("box", "/large/child.sy", DocTreeDocumentChange{Structure: true})
	finish()
	if _, ok := GetDocTreeChildCount("policy", "box", "/large"); ok {
		t.Fatal("visibility mutation retained an old count")
	}
	version, _ = DocTreeSourceVersion("box", true)
	PutDocTreeChildCount("policy", "box", "/large", version, 10000)
	finish = BeginDocTreeMutation("box")
	finish()
	if _, ok := GetDocTreeChildCount("policy", "box", "/large"); ok {
		t.Fatal("bulk mutation retained a count")
	}
}

func TestDocTreeChildCountBounds(t *testing.T) {
	InvalidateDocTree("")
	t.Cleanup(func() { InvalidateDocTree("") })
	version, _ := DocTreeSourceVersion("box", true)
	for index := 0; index <= docTreeCountMaxEntries; index++ {
		PutDocTreeChildCount("policy", "box", fmt.Sprintf("/%d", index), version, index)
	}
	if _, ok := GetDocTreeChildCount("policy", "box", "/0"); ok {
		t.Fatal("oldest count was not evicted")
	}
	if count, ok := GetDocTreeChildCount("policy", "box", fmt.Sprintf("/%d", docTreeCountMaxEntries)); !ok || count != docTreeCountMaxEntries {
		t.Fatal("newest count was not retained")
	}
	docTreeOrders.Lock()
	defer docTreeOrders.Unlock()
	if len(docTreeOrders.counts) > docTreeCountMaxEntries {
		t.Fatal("count cache exceeded its bound")
	}
}
