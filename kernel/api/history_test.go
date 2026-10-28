// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

func TestParseDocVersionRefIncludesSnapshot(t *testing.T) {
	const snapshot = "6b7f54c510e8de12be6e446494987c846f13cd0d"
	request, err := apicontract.DiffDocVersions.Decode(strings.NewReader(`{"left":{"type":"snapshot","id":"1c2971f02672edbc0d2ec6160df7c9c9a18d7402","snapshot":"` + snapshot + `"},"right":{"type":"current"}}`))
	if err != nil {
		t.Fatal("expected document version reference parsing to succeed")
	}
	ref := request.Left
	if snapshot != ref.Snapshot {
		t.Fatalf("expected snapshot [%s], got [%s]", snapshot, ref.Snapshot)
	}
}
