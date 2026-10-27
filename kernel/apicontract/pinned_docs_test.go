// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"strings"
	"testing"
)

func TestPinnedDocsContract(t *testing.T) {
	for _, body := range []string{`{}`, `{"ids":null,"action":"pin"}`, `{"ids":[null],"action":"pin"}`, `{"ids":["id"],"action":"pin","after":"true"}`} {
		if _, err := UpdatePinnedDocs.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid request accepted: %s", body)
		}
	}
	if _, err := UpdatePinnedDocs.Decode(strings.NewReader(`{"ids":["id"],"action":"pin"}`)); err != nil {
		t.Fatal(err)
	}
}
