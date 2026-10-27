// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRelationConfigurationTransactionRollback(t *testing.T) {
	testRelationConfigurationTransactionRollback(t, func(t *testing.T) string {
		setupAttributeViewValidationTest(t)
		queue := util.QueueDir
		util.QueueDir = t.TempDir()
		t.Cleanup(func() { util.QueueDir = queue })
		return ""
	})
}

func testRelationConfigurationTransactionRollback(t *testing.T, prepare func(*testing.T) string) {
	for _, mode := range []string{"source-save", "target-save", "later-operation", "interrupted", "success", "key-config-source-save", "key-config-target-save", "key-config-success"} {
		t.Run(mode, func(t *testing.T) {
			failure := strings.TrimPrefix(mode, "key-config-")
			boundary := prepare(t)
			source, oldTarget, target := av.NewAttributeView(ast.NewNodeID()), av.NewAttributeView(ast.NewNodeID()), av.NewAttributeView(ast.NewNodeID())
			key, oldBack, newBack := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
			source.KeyValues = append(source.KeyValues, &av.KeyValues{Key: &av.Key{ID: key, Name: "Relation", Type: av.KeyTypeRelation,
				Relation: &av.Relation{AvID: oldTarget.ID, IsTwoWay: true, BackKeyID: oldBack}}})
			oldTarget.KeyValues = append(oldTarget.KeyValues, &av.KeyValues{Key: &av.Key{ID: oldBack, Name: "Back", Type: av.KeyTypeRelation,
				Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: key}}})
			before := map[string][]byte{}
			for _, view := range []*av.AttributeView{source, oldTarget, target} {
				av.SetAVBoxID(view.ID, boundary)
				if err := av.SaveAttributeView(view); err != nil {
					t.Fatal(err)
				}
				filename, _ := av.FindAttributeViewPath(view.ID)
				data, err := os.ReadFile(filename)
				if err != nil {
					t.Fatal(err)
				}
				before[filename] = data
			}
			av.UpsertAvBackRel(source.ID, oldTarget.ID)
			av.UpsertAvBackRel(oldTarget.ID, source.ID)
			peer := ast.NewNodeID()
			if boundary != "" {
				av.SetAVBoxID(peer, boundary)
				if err := av.SaveAttributeView(av.NewAttributeView(peer)); err != nil {
					t.Fatal(err)
				}
			}
			av.UpsertAvBackRel(peer, oldTarget.ID)
			relations := filepath.Join(util.DataDir, boundary, "storage", "av", "relations.msgpack")
			data, readErr := os.ReadFile(relations)
			if readErr != nil {
				t.Fatal(readErr)
			}
			before[relations] = data
			injected := errors.New("injected relation configuration save failure")
			originalSaved := av.AttributeViewSaved
			var release func()
			av.AttributeViewSaved = func(id, box string) {
				var fail *av.AttributeView
				if failure == "source-save" && id == oldTarget.ID {
					fail = source
				}
				if failure == "target-save" && id == source.ID {
					fail = target
				}
				if fail != nil {
					release = av.RecordSourceWrites(fail, func() bool { return true }, func(string, []byte, []byte) error { release(); return injected })
				}
			}
			t.Cleanup(func() {
				av.AttributeViewSaved = originalSaved
				if release != nil {
					release()
				}
			})
			op := &Operation{Action: "updateAttrViewColRelation", AvID: source.ID, ID: target.ID, KeyID: key,
				Format: "Changed", IsTwoWay: true, BackRelationKeyID: newBack, Name: "New back"}
			tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, m: &sync.Mutex{}}
			defer func() {
				av.AttributeViewSaved = originalSaved
				if tx.state.Load() == 1 {
					tx.rollback()
				}
			}()
			managed := strings.HasPrefix(mode, "key-config-") || failure == "later-operation"
			var executeErr error
			if strings.HasPrefix(mode, "key-config-") {
				executeErr = UpdateAttributeViewKeyConfig(source.ID, key, map[string]any{"relation": map[string]any{"avID": target.ID, "isTwoWay": true, "backKeyName": "New back"}})
			} else if failure == "later-operation" {
				tx.DoOperations = append(tx.DoOperations, &Operation{Action: "sortAttrViewView", AvID: source.ID, ID: ast.NewNodeID()})
				executeErr = PerformTxSync(tx)
			} else {
				if err := tx.begin(); err != nil {
					t.Fatal(err)
				}
				if err := tx.doUpdateAttrViewColRelation(op); err != nil {
					executeErr = err
				}
			}
			if (failure == "source-save" || failure == "target-save" || failure == "later-operation") && executeErr == nil {
				t.Fatal("expected injected save error")
			}
			if (failure == "success" || failure == "interrupted") && executeErr != nil {
				t.Fatal(executeErr)
			}
			av.AttributeViewSaved = originalSaved
			if failure == "success" {
				if !managed {
					if err := tx.commit(); err != nil {
						tx.rollback()
						t.Fatal(err)
					}
				}
				updated, err := av.ParseAttributeView(source.ID)
				if err != nil {
					t.Fatal(err)
				}
				field, _ := updated.GetKey(key)
				if field.Relation.AvID != target.ID || !slices.Contains(av.GetSrcAvIDs(target.ID), source.ID) {
					t.Fatal("successful relation configuration was not committed")
				}
				return
			}
			if failure == "interrupted" {
				journals, err := readDocumentSourceJournals()
				if err != nil || len(journals) != 1 || journals[0].Forward {
					t.Fatal("missing durable relation recovery", err)
				}
				if boundary != "" {
					for _, file := range journals[0].Files {
						if !util.IsCiphertext(file.Before) || !util.IsCiphertext(file.After) {
							t.Fatal("private recovery record contains plaintext")
						}
					}
				}
				// Drop all volatile transaction state, retaining only its durable record.
				tx.finishAttributeViewMutation(false)
				tx.releaseDocumentSources(false)
				tx.state.Store(3)
				tx.m.Unlock()
				if err = recoverDocumentSources(); err != nil {
					t.Fatal(err)
				}
			} else if !managed {
				tx.rollback()
			}
			if tx.sourceRollbackErr != nil {
				t.Fatal(tx.sourceRollbackErr)
			}
			for filename, original := range before {
				current, err := os.ReadFile(filename)
				if err != nil || !bytes.Equal(current, original) {
					t.Errorf("partial relation configuration persisted in %s: %v", filepath.Base(filename), err)
				}
			}
			if !slices.Contains(av.GetSrcAvIDs(oldTarget.ID), source.ID) || !slices.Contains(av.GetSrcAvIDs(oldTarget.ID), peer) || slices.Contains(av.GetSrcAvIDs(target.ID), source.ID) {
				t.Error("relation dependencies were not restored")
			}
			if journals, err := readDocumentSourceJournals(); err != nil || len(journals) != 0 {
				t.Fatal("completed relation recovery retained its record", err)
			}
			if boundary != "" {
				if _, err := os.Stat(filepath.Join(util.DataDir, "storage", "av", "relations.msgpack")); !os.IsNotExist(err) {
					t.Fatal("private dependencies leaked to the global index", err)
				}
			}
		})
	}
}
