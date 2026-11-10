// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memory

import (
	"crypto/sha256"
	"fmt"
	"strings"
	"testing"
)

func TestCodecEncodingSnapshot(t *testing.T) {
	r := Record{Schema: 1, ID: "20260101000000-abcdefg", Kind: "fact", Subject: strings.Repeat("long English subject ", 8), Scope: "global", State: "active", Sources: []Source{{Kind: "user", ID: "source", Revision: "rev", Evidence: "evidence"}}, Created: "2026-01-01T00:00:00Z", Updated: "2026-01-01T00:00:00Z", Operations: []string{"remember"}}
	data, err := encode(r, "Body\n")
	if err != nil {
		t.Fatal(err)
	}
	got := fmt.Sprintf("%x", sha256.Sum256(data))
	const want = "f651d4d3e6ada0c2bafc5f401d62d077ef5c3502ce0d19c7b7903f72e7c3d212"
	if got != want {
		t.Fatalf("encoding snapshot = %s\n%s", got, data)
	}
	var decoded Record
	body, err := decode(data, &decoded)
	if err != nil || body != "Body\n" || decoded.Subject != r.Subject {
		t.Fatalf("round trip: %+v %q %v", decoded, body, err)
	}
}

func TestCodecMergeLikeString(t *testing.T) {
	r := Record{Schema: 1, Subject: "<<"}
	data, err := encode(r, "Body")
	if err != nil {
		t.Fatal(err)
	}
	var decoded Record
	body, err := decode(data, &decoded)
	if err != nil || body != "Body" || decoded.Subject != "<<" {
		t.Fatalf("round trip: %+v %q %v", decoded, body, err)
	}
}
