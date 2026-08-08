// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"testing"

	"github.com/88250/gulu"
)

func TestParseDocVersionRefIncludesSnapshot(t *testing.T) {
	const snapshot = "6b7f54c510e8de12be6e446494987c846f13cd0d"
	ref, ok := parseDocVersionRef(map[string]interface{}{
		"type":     "snapshot",
		"id":       "1c2971f02672edbc0d2ec6160df7c9c9a18d7402",
		"snapshot": snapshot,
	}, gulu.Ret.NewResult())
	if !ok {
		t.Fatal("expected document version reference parsing to succeed")
	}
	if snapshot != ref.Snapshot {
		t.Fatalf("expected snapshot [%s], got [%s]", snapshot, ref.Snapshot)
	}
}
