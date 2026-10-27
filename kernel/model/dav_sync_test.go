// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"os"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
)

func TestDAVSyncedCacheReload(t *testing.T) {
	for _, kind := range []string{"calendar", "contact"} {
		for _, change := range []string{"update", "delete", "metadata", "corrupt"} {
			t.Run(kind+"/"+change, func(t *testing.T) {
				f := newDAVPersistenceFixture(t, kind)
				if err := f.put("old"); err != nil {
					t.Fatal(err)
				}
				oldData, err := os.ReadFile(f.file)
				if err != nil {
					t.Fatal(err)
				}
				changedPath := "/storage" + f.urlPath
				result := &dejavu.MergeResult{}
				switch change {
				case "update":
					if err = os.WriteFile(f.file, bytes.ReplaceAll(oldData, []byte("old"), []byte("new")), 0600); err != nil {
						t.Fatal(err)
					}
					result.Upserts = []*entity.File{{Path: changedPath}}
				case "delete":
					if err = os.Remove(f.file); err != nil {
						t.Fatal(err)
					}
					result.Removes = []*entity.File{{Path: changedPath}}
				case "metadata":
					metaPath := CalendarsMetaDataFilePath()
					changedPath = "/storage" + CalDavCalendarsMetaDataFilePath
					if kind == "contact" {
						metaPath = AddressBooksMetaDataFilePath()
						changedPath = "/storage" + CardDavAddressBooksMetaDataFilePath
					}
					if err = os.WriteFile(metaPath, []byte("[]"), 0600); err != nil {
						t.Fatal(err)
					}
					result.Upserts = []*entity.File{{Path: changedPath}}
				case "corrupt":
					if err = os.WriteFile(f.file, []byte("invalid data"), 0600); err != nil {
						t.Fatal(err)
					}
					result.Upserts = []*entity.File{{Path: changedPath}}
				}
				if name, err := f.get(); err != nil || name != "old" {
					t.Fatalf("setup did not retain old cached state: %q, %v", name, err)
				}
				reloadSyncedDAV(result, f.calendars, f.contacts)
				if change == "corrupt" {
					if f.loaded() {
						t.Fatal("corrupt source must not be marked loaded")
					}
					if err := f.load(); err == nil {
						t.Fatal("corrupt source must return load error")
					}
					actual, err := os.ReadFile(f.file)
					if err != nil || string(actual) != "invalid data" {
						t.Fatal("reload altered corrupt source")
					}
					return
				}
				if err := f.load(); err != nil {
					t.Fatal(err)
				}
				name, err := f.get()
				if change == "update" {
					if err != nil || name != "new" {
						t.Fatalf("reload = %q, %v", name, err)
					}
				} else if err == nil {
					t.Fatal("deleted object or collection remained cached")
				}
				if change == "delete" {
					if _, err := os.Stat(f.file); !os.IsNotExist(err) {
						t.Fatalf("reload recreated deleted object: %v", err)
					}
				}
			})
		}
	}
}

func TestDAVSyncKeepsUnusedServicesLazy(t *testing.T) {
	f := newDAVPersistenceFixture(t, "calendar")
	if err := f.put("old"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(f.file)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(f.file, bytes.ReplaceAll(data, []byte("old"), []byte("new")), 0600); err != nil {
		t.Fatal(err)
	}
	reloadSyncedDAV(&dejavu.MergeResult{Upserts: []*entity.File{{Path: "/storage/caldav-other/file"}, {Path: "/storage/carddav/unused.vcf"}}}, f.calendars, f.contacts)
	if name, _ := f.get(); name != "old" {
		t.Fatal("unrelated path reloaded calendar cache")
	}
	if _, err := os.Stat(AddressBooksMetaDataFilePath()); !os.IsNotExist(err) {
		t.Fatalf("unused contact service created metadata: %v", err)
	}
}
