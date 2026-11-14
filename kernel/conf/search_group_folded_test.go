// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"testing"
)

func TestSearchGroupFoldedPersistence(t *testing.T) {
	if NewSearch().GroupFolded || NormalizeSearch(nil).GroupFolded {
		t.Fatal("grouped search must remain expanded by default")
	}
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{}`, false}, {`{"groupFolded":false}`, false}, {`{"groupFolded":true}`, true},
	} {
		var search Search
		if err := json.Unmarshal([]byte(entry.body), &search); err != nil {
			t.Fatal(err)
		}
		normalized := NormalizeSearch(&search)
		encoded, err := json.Marshal(normalized)
		if err != nil {
			t.Fatal(err)
		}
		restored := NewSearch()
		if err = json.Unmarshal(encoded, restored); err != nil {
			t.Fatal(err)
		}
		if normalized.GroupFolded != entry.want || restored.GroupFolded != entry.want {
			t.Fatalf("preference changed through normalization and persistence: %s => %s", entry.body, encoded)
		}
	}
}
