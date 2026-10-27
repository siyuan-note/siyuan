// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"errors"
	"os"
	"testing"

	"github.com/88250/lute/ast"
)

func TestRelationSourceRecorderRejectsIncompleteDependencyWrites(t *testing.T) {
	setupCollectionIndexTest(t)
	source, target, peer := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	if err := UpsertAvBackRelWithErr(source, target); err != nil {
		t.Fatal(err)
	}
	filename := relationsPath("")
	original, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	injected := errors.New("injected relation journal failure")
	calls := 0
	release := RecordRelationWrites("", func(box string, before, after []byte) error {
		calls++
		if box != "" || !bytes.Equal(before, original) || bytes.Equal(before, after) {
			t.Fatal("missing exact dependency-index write bytes")
		}
		return injected
	})
	defer release()
	if err = UpsertAvBackRelWithErr(peer, target); !errors.Is(err, injected) {
		t.Fatal("dependency insertion ignored recovery failure", err)
	}
	if err = RemoveAvRelWithErr(source, target); !errors.Is(err, injected) {
		t.Fatal("dependency removal ignored recovery failure", err)
	}
	current, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(current, original) || calls != 2 {
		t.Fatal("rejected dependency write changed its source", err, calls)
	}
	release()
	if err = UpsertAvBackRelWithErr(peer, target); err != nil {
		t.Fatal("released dependency recorder remained active", err)
	}
}
