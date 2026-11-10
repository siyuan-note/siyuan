// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	gosql "database/sql"
	"reflect"
	"testing"
)

func TestDocTreeReferenceCounts(t *testing.T) {
	fixture, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	fixture.SetMaxOpenConns(1)
	defer fixture.Close()
	if _, err = fixture.Exec("CREATE TABLE refs (def_block_root_id TEXT, block_id TEXT, box TEXT, path TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err = fixture.Exec("INSERT INTO refs VALUES ('target','a','normal','/visible.sy'), ('target','a','normal','/visible.sy'), ('target','b','normal','/visible.sy'), ('target','c','normal','/hidden.sy'), ('other','d','normal','/visible.sy')"); err != nil {
		t.Fatal(err)
	}
	previous := db
	db = fixture
	defer func() { db = previous }()
	counts, err := QueryDocTreeRefCounts([]string{"target"}, []string{""}, nil)
	if err != nil || !reflect.DeepEqual(counts, map[string]int{"target": 3}) {
		t.Fatalf("targeted distinct count: %v, %v", counts, err)
	}
	counts, err = QueryDocTreeRefCounts(nil, []string{""}, func(box, path string) bool { return path != "/hidden.sy" })
	if err != nil || !reflect.DeepEqual(counts, map[string]int{"target": 2, "other": 1}) {
		t.Fatalf("publish filtered counts: %v, %v", counts, err)
	}
	counts, err = QueryDocTreeRefCounts([]string{`target'); DROP TABLE refs; --`}, []string{""}, nil)
	if err != nil || len(counts) != 0 {
		t.Fatalf("parameterized count: %v, %v", counts, err)
	}
	if _, err = fixture.Exec("DROP TABLE refs"); err != nil {
		t.Fatal(err)
	}
	if _, err = QueryDocTreeRefCounts(nil, []string{""}, nil); err == nil {
		t.Fatal("database failure silently converted to zero reference counts")
	}
}

func TestDocTreeReferenceCountChanges(t *testing.T) {
	fixture, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer fixture.Close()
	if _, err = fixture.Exec("CREATE TABLE refs (def_block_root_id TEXT, block_id TEXT, box TEXT, path TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err = fixture.Exec("INSERT INTO refs VALUES ('target','a','normal','/source.sy'), ('target','a','normal','/source.sy'), ('target','b','normal','/elsewhere.sy')"); err != nil {
		t.Fatal(err)
	}
	tx, err := fixture.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for _, test := range []struct {
		name    string
		next    []*Ref
		changed bool
	}{
		{"anchor text", []*Ref{{DefBlockRootID: "target", BlockID: "a", Content: "changed"}}, false},
		{"duplicate reference", []*Ref{{DefBlockRootID: "target", BlockID: "a"}, {DefBlockRootID: "target", BlockID: "a"}}, false},
		{"different block same count", []*Ref{{DefBlockRootID: "target", BlockID: "new"}}, false},
		{"target changed", []*Ref{{DefBlockRootID: "other", BlockID: "a"}}, true},
		{"added block", []*Ref{{DefBlockRootID: "target", BlockID: "a"}, {DefBlockRootID: "target", BlockID: "c"}}, true},
		{"removed", nil, true},
	} {
		changed, err := docTreeRefCountsChanged(tx, "normal", "/source.sy", test.next)
		if err != nil || changed != test.changed {
			t.Fatalf("%s: changed=%v err=%v", test.name, changed, err)
		}
	}
}
