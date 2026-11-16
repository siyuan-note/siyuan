// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncedNotebookConfIndexChanges(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldDataDir })
	const boxID = "20261111090000-syncbox"
	path := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { forgetRuntimeNormalBox(boxID) })
	const open = `{"closed":false,"name":"First","icon":"1f4c4","sort":3,"future":999}`
	const closed = `{"closed":true,"name":"First"}`
	for _, test := range []struct {
		name, before, after string
		unindex, index      bool
	}{
		{"presentation and creation settings", open, `{"closed":false,"name":"Second","icon":"1f680","sort":7,"docCreateSavePath":"/New","future":999}`, false, false},
		{"unknown fields", open, `{"futureOther":{"list":[1,true]},"sort":3,"icon":"1f4c4","name":"First","closed":false}`, false, false},
		{"closed settings", closed, `{"closed":true,"name":"Second"}`, false, false},
		{"close notebook", open, closed, true, false},
		{"open notebook", closed, open, true, true},
		{"new notebook", "", open, true, true},
		{"encrypted transition", open, `{"closed":false,"encrypted":true}`, true, true},
		{"changed key envelope", `{"encrypted":true,"boxCrypt":{"spec":1}}`, `{"encrypted":true,"boxCrypt":{"spec":2}}`, true, true},
		{"malformed previous config", `{"closed":`, open, true, true},
		{"malformed downloaded config", open, `{"closed":"false"}`, true, true},
		{"non-object config", closed, `null`, true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			forgetRuntimeNormalBox(boxID)
			if err := os.WriteFile(path, []byte(test.before), 0644); err != nil {
				t.Fatal(err)
			}
			previous := map[string][]byte{}
			snapshotSyncNotebookConfs([]*entity.File{{Path: "/" + boxID + notebookConfSyncSuffix}}, previous)
			if err := os.WriteFile(path, []byte(test.after), 0644); err != nil {
				t.Fatal(err)
			}
			change := classifySyncedNotebookConf(boxID, previous[boxID])
			if change.unindex != test.unindex || change.index != test.index {
				t.Fatalf("got unindex=%t and index=%t, want %t and %t", change.unindex, change.index, test.unindex, test.index)
			}
		})
	}
}

func TestSaveNotebookConfPreservesUnknownFields(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldDataDir })
	box := &Box{ID: "20261111090100-syncbox"}
	t.Cleanup(func() { forgetRuntimeNormalBox(box.ID) })
	path := filepath.Join(util.DataDir, box.ID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"NAME":"Before","future":9007199254740993,"futureObject":{"x":[true,null]},"futureNull":null}`), 0644); err != nil {
		t.Fatal(err)
	}
	settings := box.GetConf()
	if settings.Name != "Before" || !settings.Closed || len(settings.Extra) != 3 {
		t.Fatalf("unexpected decoded notebook settings: %+v", settings)
	}
	settings.Name = "After"
	settings.Extra["nAmE"] = json.RawMessage(`"Do not override"`)
	settings.Extra["DocCreateTarget"] = json.RawMessage(`true`)
	if err := box.SaveConf(settings); err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(saved, &fields); err != nil {
		t.Fatal(err)
	}
	if string(fields["name"]) != `"After"` || string(fields["future"]) != `9007199254740993` ||
		string(fields["futureNull"]) != `null` || !bytes.Contains(fields["futureObject"], []byte(`"x"`)) ||
		fields["nAmE"] != nil || fields["DocCreateTarget"] != nil {
		t.Fatalf("unexpected saved notebook settings: %s", saved)
	}
	stamp := time.Unix(1700000000, 0)
	if err = os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	if err = box.SaveConf(box.GetConf()); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || !info.ModTime().Equal(stamp) {
		t.Fatalf("unchanged configuration was rewritten: %v, %v", info, err)
	}
	if data, err := os.ReadFile(path); err != nil || !bytes.Equal(data, saved) {
		t.Fatalf("unchanged configuration bytes differ: %v", err)
	}
	persisted, err := prepareBoxConfForSave(box.ID, settings)
	if err != nil {
		t.Fatal(err)
	}
	persisted.Extra["future"][0] = '8'
	delete(persisted.Extra, "futureNull")
	if string(settings.Extra["future"]) != `9007199254740993` || settings.Extra["futureNull"] == nil {
		t.Fatal("persisted configuration shares unknown fields with its source")
	}
}

func TestSyncedEncryptedNotebookConfChecksMetadata(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldDataDir })
	const boxID = "20261111090200-syncbox"
	path := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	kek := bytes.Repeat([]byte{2}, 32)
	envelope, dek, err := WrapNewDEK(boxID, kek)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(dek)
	settings := &conf.BoxConf{Name: "Before", Encrypted: true, BoxCrypt: envelope}
	if err = encryptBoxMetadata(boxID, settings, dek); err != nil {
		t.Fatal(err)
	}
	check := func(name string, rebuild bool) {
		t.Helper()
		settings.Name = "Before"
		previous, err := json.Marshal(settings)
		if err != nil {
			t.Fatal(err)
		}
		settings.Name = name
		current, err := json.Marshal(settings)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, current, 0644); err != nil {
			t.Fatal(err)
		}
		if change := classifySyncedNotebookConf(boxID, previous); change.unindex != rebuild || change.index != rebuild {
			t.Fatalf("got unindex=%t and index=%t, want %t for both", change.unindex, change.index, rebuild)
		}
	}
	check("Renamed while locked", false)
	cachedDEKsLock.Lock()
	cachedDEKs[boxID] = bytes.Clone(dek)
	cachedDEKsLock.Unlock()
	t.Cleanup(func() {
		cachedDEKsLock.Lock()
		zeroAndClear(cachedDEKs[boxID])
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
	})
	check("Renamed while unlocked", false)
	envelope.Metadata[len(envelope.Metadata)-1] ^= 1
	check("Unauthenticated metadata", true)
}
