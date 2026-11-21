// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"testing"
)

func TestSyncConfiguredEvidence(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*Sync)
		want   bool
	}{
		{"fresh", func(s *Sync) {}, false},
		{"active", func(s *Sync) { s.Enabled = true }, true},
		{"paused", func(s *Sync) { s.Synced = 1 }, true},
		{"failed", func(s *Sync) { s.LastResult = 2 }, true},
		{"named", func(s *Sync) { s.CloudName = "remote" }, true},
		{"provider-only", func(s *Sync) { s.Provider = ProviderS3 }, false},
		{"s3", func(s *Sync) { s.S3 = &S3{Endpoint: "https://example.invalid", Bucket: "bucket"} }, true},
		{"webdav", func(s *Sync) { s.WebDAV = &WebDAV{Endpoint: "https://example.invalid"} }, true},
		{"local", func(s *Sync) { s.Local = &Local{Endpoint: "/synthetic-sync"} }, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := NewSync()
			c.mutate(s)
			s = NormalizeSync(s)
			if s.Configured != c.want {
				t.Fatalf("configured=%v want=%v", s.Configured, c.want)
			}
			s.Enabled = false
			s.Synced = 0
			s.LastResult = 0
			s.CloudName = "main"
			s.S3 = nil
			s.WebDAV = nil
			s.Local = nil
			data, err := json.Marshal(s)
			if err != nil {
				t.Fatal(err)
			}
			restored := NewSync()
			if err = json.Unmarshal(data, restored); err != nil {
				t.Fatal(err)
			}
			if NormalizeSync(restored).Configured != c.want {
				t.Fatal("association lost after pause/clear/reload")
			}
		})
	}
}
