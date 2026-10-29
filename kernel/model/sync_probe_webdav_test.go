// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/net/webdav"
)

func prepareProviderProbe(t *testing.T) {
	t.Helper()
	previous, langs, workspace := Conf, util.Langs, util.WorkspaceDir
	t.Cleanup(func() { Conf = previous; util.Langs = langs; util.WorkspaceDir = workspace })
	Conf = &AppConf{Lang: "en"}
	util.Langs = map[string]map[int]string{"en": {}}
	for _, number := range []int{33, 77, 123, 142, 249, 409, 425, 426, 427, 428, 429, 430} {
		util.Langs["en"][number] = fmt.Sprint(number)
	}
	util.Langs["en"][77] = "Invalid directory [%s]"
	util.WorkspaceDir = t.TempDir()
}

func TestSyncProviderWebDAVProbe(t *testing.T) {
	prepareProviderProbe(t)
	for _, mode := range []string{"normal", "no cloud name", "html", "empty XML", "read only", "bad request", "unauthorized", "conflict", "method denied", "read failure", "read HTML", "server failure"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			handler := &webdav.Handler{FileSystem: webdav.Dir(root), LockSystem: webdav.NewMemLS()}
			writes, deletes := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "PROPFIND" && r.URL.Path == "/" {
					switch mode {
					case "html":
						w.WriteHeader(200)
						fmt.Fprint(w, "<html>secret</html>")
						return
					case "empty XML":
						w.WriteHeader(207)
						fmt.Fprint(w, `<d:multistatus xmlns:d="DAV:"/>`)
						return
					case "read only":
						w.WriteHeader(403)
						return
					case "bad request":
						w.WriteHeader(400)
						return
					case "unauthorized":
						w.WriteHeader(401)
						return
					case "server failure":
						w.WriteHeader(503)
						return
					}
				}
				if r.Method == "MKCOL" && strings.Contains(r.URL.Path, "/siyuan/") {
					if mode == "conflict" {
						w.WriteHeader(409)
						return
					}
					if mode == "method denied" {
						w.WriteHeader(405)
						return
					}
				}
				if r.Method == "PUT" {
					writes++
				}
				if r.Method == "DELETE" {
					deletes++
				}
				if r.Method == "GET" && mode == "read failure" {
					w.WriteHeader(403)
					return
				}
				if r.Method == "GET" && mode == "read HTML" {
					fmt.Fprint(w, "<html>secret</html>")
					return
				}
				handler.ServeHTTP(w, r)
			}))
			defer server.Close()
			draft := &conf.WebDAV{Endpoint: server.URL, Username: "user", Password: "secret", Timeout: 7}
			before, _ := json.Marshal(draft)
			cloudName := "main"
			if mode == "no cloud name" {
				cloudName = ""
			}
			kind, msg := TestSyncProviderWebDAV(draft, cloudName)
			want := SyncProbeConfig
			if mode == "normal" || mode == "no cloud name" {
				want = SyncProbeOK
			}
			if mode == "server failure" {
				want = SyncProbeNetwork
			}
			if kind != want || (kind != SyncProbeOK && msg == "") {
				t.Fatalf("got %s %q want %s", kind, msg, want)
			}
			if strings.Contains(msg, server.URL) || strings.Contains(msg, "secret") {
				t.Fatalf("private diagnostic: %q", msg)
			}
			if mode == "normal" || mode == "no cloud name" || mode == "read failure" || mode == "read HTML" {
				if writes != 1 || deletes != 1 {
					t.Fatalf("probe operations: writes %d deletes %d", writes, deletes)
				}
			}
			filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
				if err != nil {
					return err
				}
				if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".siyuan-probe-") {
					t.Errorf("left probe: %s", path)
				}
				return nil
			})
			after, _ := json.Marshal(draft)
			if string(before) != string(after) {
				t.Fatal("draft mutated")
			}
		})
	}
}

func TestSyncProviderLocalProbe(t *testing.T) {
	prepareProviderProbe(t)
	root := t.TempDir()
	file := filepath.Join(root, "existing")
	if err := os.WriteFile(file, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		endpoint string
		want     string
	}{{root, SyncProbeOK}, {file, SyncProbeConfig}, {filepath.Join(root, "missing"), SyncProbeConfig}, {util.WorkspaceDir, SyncProbeConfig}} {
		draft := &conf.Local{Endpoint: tc.endpoint}
		kind, msg := TestSyncProviderLocal(draft)
		if kind != tc.want || (kind != SyncProbeOK && msg == "") {
			t.Fatalf("got %s %q want %s", kind, msg, tc.want)
		}
		if draft.Endpoint != tc.endpoint {
			t.Fatal("draft mutated")
		}
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 1 || entries[0].Name() != "existing" {
		t.Fatalf("probe was not cleaned: %v %v", entries, err)
	}
	if data, err := os.ReadFile(file); err != nil || string(data) != "keep" {
		t.Fatal("existing data changed")
	}
}
