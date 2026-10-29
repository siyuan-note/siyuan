// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func preserveIndexFixTestState(t *testing.T) {
	t.Helper()
	previousFixed, previousDirty := lastFixedAt, util.IsIndexFixDirty()
	t.Cleanup(func() {
		lastFixedAt = previousFixed
		if previousDirty {
			util.MarkIndexFixDirty()
		} else {
			util.MarkIndexClean(util.IndexFixVersion())
		}
	})
	lastFixedAt = time.Time{}
	util.MarkIndexFixDirty()
}

func TestIndexFixCompletionRetainsFailedAndNewerWork(t *testing.T) {
	for _, outcome := range []string{"error", "clean-error", "panic", "new-edit", "success"} {
		t.Run(outcome, func(t *testing.T) {
			preserveIndexFixTestState(t)
			injected := errors.New("injected repair failure")
			if outcome == "clean-error" {
				util.MarkIndexClean(util.IndexFixVersion())
			}
			err := completeIndexRepair(func() error {
				switch outcome {
				case "error", "clean-error":
					return injected
				case "panic":
					panic("injected repair panic")
				case "new-edit":
					util.RefreshActivity()
				}
				return nil
			})
			if (outcome == "error" || outcome == "clean-error") && !errors.Is(err, injected) || outcome == "panic" && err == nil {
				t.Fatalf("repair failure was hidden: %v", err)
			}
			if outcome == "success" {
				if err != nil || util.IsIndexFixDirty() || lastFixedAt.IsZero() {
					t.Fatalf("successful repair did not finish: %v", err)
				}
			} else if !util.IsIndexFixDirty() || !lastFixedAt.IsZero() {
				t.Fatal("incomplete repair cleared pending work or started a cooldown")
			}
		})
	}
}

func TestIndexFixUnreadableDocumentKeepsPendingState(t *testing.T) {
	fixture := setupFileOperationTest(t)
	preserveIndexFixTestState(t)
	p := filepath.Join(util.DataDir, fixture.box.ID, "20261026000000-invalid.sy")
	original := []byte(`{"Type":"NodeDocument","Spec":"99"}`)
	if err := os.WriteFile(p, original, 0600); err != nil {
		t.Fatal(err)
	}
	if err := completeIndexRepair(resetDuplicateBlocksOnFileSys); err == nil {
		t.Fatal("unreadable source was reported as repaired")
	}
	if !util.IsIndexFixDirty() || !lastFixedAt.IsZero() {
		t.Fatal("failed source repair cleared pending state")
	}
	if data, err := os.ReadFile(p); err != nil || string(data) != string(original) {
		t.Fatalf("unreadable source was modified: %q %v", data, err)
	}
}
