// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/emersion/go-webdav/caldav"
	"github.com/emersion/go-webdav/carddav"
)

func TestDAVETagTracksContent(t *testing.T) {
	file := filepath.Join(t.TempDir(), "object")
	stamp := time.Unix(1700000000, 123000000)
	calendar := &CalendarObject{FilePath: file, Data: &caldav.CalendarObject{}}
	address := &AddressObject{FilePath: file, Data: &carddav.AddressObject{}}
	var previous string
	for _, content := range []string{"first", "other", "other"} {
		if err := os.WriteFile(file, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(file, stamp, stamp); err != nil {
			t.Fatal(err)
		}
		if err := calendar.update(); err != nil {
			t.Fatal(err)
		}
		if err := address.update(); err != nil {
			t.Fatal(err)
		}
		if calendar.Data.ETag == "" || calendar.Data.ETag != address.Data.ETag {
			t.Fatal("calendar and contact must identify the same persisted bytes")
		}
		if content == "first" {
			previous = calendar.Data.ETag
		} else if previous == calendar.Data.ETag {
			t.Fatal("equal-size content change with identical timestamp retained its ETag")
		}
	}
	stable, err := FileETag(file)
	if err != nil || stable != calendar.Data.ETag {
		t.Fatalf("unchanged content ETag = %q, %v", stable, err)
	}
	if err = os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if _, err = FileETag(file); err == nil {
		t.Fatal("missing file must return an error")
	}
}
