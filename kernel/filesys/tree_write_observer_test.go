// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"errors"
	"reflect"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestObserveTreeWritesPreservesOuterJournal(t *testing.T) {
	tree := &parse.Tree{}
	var calls []string
	err := RecordTreeWrites(tree, []byte("before"), func(data []byte) error { calls = append(calls, "journal:"+string(data)); return nil }, func() error {
		outer := treeRecorder(tree)
		err := ObserveTreeWrites(tree, []byte("before"), func(data []byte) error { calls = append(calls, "observer:"+string(data)); return nil }, func() error {
			return treeRecorder(tree).record([]byte("after"))
		})
		if treeRecorder(tree) != outer {
			t.Fatal("outer recorder was not restored")
		}
		if mismatch := ObserveTreeWrites(tree, []byte("different"), nil, func() error { t.Fatal("mismatched source was written"); return nil }); !errors.Is(mismatch, util.ErrFileChanged) {
			t.Fatal(mismatch)
		}
		return err
	})
	if err != nil || !reflect.DeepEqual(calls, []string{"journal:after", "observer:after"}) {
		t.Fatalf("lost outer journal: %v, %v", calls, err)
	}
	if treeRecorder(tree) != nil {
		t.Fatal("recorder leaked")
	}
}

func TestObserveTreeWritesPropagatesJournalFailure(t *testing.T) {
	tree := &parse.Tree{}
	want := errors.New("journal failed")
	err := RecordTreeWrites(tree, nil, func([]byte) error { return want }, func() error {
		return ObserveTreeWrites(tree, nil, func([]byte) error { t.Fatal("observed unrecorded write"); return nil }, func() error { return treeRecorder(tree).record([]byte("after")) })
	})
	if !errors.Is(err, want) {
		t.Fatal(err)
	}
}

func TestObserveTreeWritesSurvivesInnerRecorders(t *testing.T) {
	tree, other := &parse.Tree{}, &parse.Tree{}
	var calls []string
	callback := func(label string) func([]byte) error {
		return func([]byte) error { calls = append(calls, label); return nil }
	}
	wantErr := errors.New("write failed")
	err := ObserveTreeWrites(tree, []byte("original"), callback("outer observer"), func() error {
		if treeRecorder(other) != nil {
			t.Fatal("observer leaked to another tree")
		}
		return RecordTreeWrites(tree, []byte("original"), callback("outer journal"), func() error {
			return ObserveTreeWrites(tree, []byte("original"), callback("inner observer"), func() error {
				return RecordTreeWrites(tree, []byte("original"), callback("inner journal"), func() error {
					if string(treeRecorder(tree).before) != "original" {
						t.Fatal("original comparison source lost")
					}
					if err := treeRecorder(tree).record([]byte("after")); err != nil {
						return err
					}
					return wantErr
				})
			})
		})
	})
	if !errors.Is(err, wantErr) || !reflect.DeepEqual(calls, []string{"outer journal", "inner journal", "outer observer", "inner observer"}) {
		t.Fatalf("nested hooks lost: %v, %v", calls, err)
	}
	if treeRecorder(tree) != nil || treeRecorder(other) != nil {
		t.Fatal("failed scope leaked hooks")
	}
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("panic was swallowed")
			}
		}()
		_ = ObserveTreeWrites(tree, nil, callback("panic"), func() error { panic("expected") })
	}()
	if treeRecorder(tree) != nil {
		t.Fatal("panic scope leaked observer")
	}
}
