// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/klauspost/compress/zstd"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/dejavu/entity"
)

func TestCloudRepoSnapshotCacheTimeRange(t *testing.T) {
	encoder, err := zstd.NewWriter(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer encoder.Close()
	manifest := &cloud.Indexes{}
	objects := map[string][]byte{}
	type entry struct {
		Key          string
		ETag         string
		Size         int
		LastModified string
	}
	listing := struct {
		XMLName     xml.Name `xml:"ListBucketResult"`
		Xmlns       string   `xml:"xmlns,attr"`
		IsTruncated bool
		Contents    []entry
	}{Xmlns: "http://s3.amazonaws.com/doc/2006-03-01/"}
	for i := 1; i <= 65; i++ {
		id := fmt.Sprintf("%040x", i)
		manifest.Indexes = append(manifest.Indexes, &cloud.Index{ID: id})
		data, _ := json.Marshal(&entity.Index{ID: id, Created: 1000 + int64(i), Memo: "memo", Count: 1, Size: 1024})
		objects["indexes/"+id] = encoder.EncodeAll(data, nil)
		listing.Contents = append(listing.Contents, entry{"repo/indexes/" + id, `"index-` + id + `"`, len(objects["indexes/"+id]), "2026-10-27T00:00:00Z"})
	}
	data, _ := json.Marshal(manifest)
	objects["indexes-v2.json"] = encoder.EncodeAll(data, nil)
	listData, _ := xml.Marshal(listing)
	var mu sync.Mutex
	gets, lists, heads := 0, 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method == http.MethodHead {
			heads++
			w.WriteHeader(500)
			return
		}
		if r.URL.Query().Get("prefix") == "repo/indexes/" {
			lists++
			_, _ = w.Write(listData)
			return
		}
		gets++
		key := strings.TrimPrefix(r.URL.Path, "/bucket/repo/")
		body, exists := objects[key]
		if !exists {
			w.WriteHeader(404)
			return
		}
		etag := `"manifest"`
		if key != "indexes-v2.json" {
			etag = `"index-` + strings.TrimPrefix(key, "indexes/") + `"`
		}
		w.Header().Set("ETag", etag)
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(304)
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		_, _ = w.Write(body)
	}))
	defer server.Close()
	base := t.TempDir()
	s3 := cloud.NewS3(&cloud.BaseCloud{Conf: &cloud.Conf{S3: &cloud.ConfS3{
		Endpoint: server.URL, Bucket: "bucket", Region: "us-east-1", AccessKey: "access", SecretKey: "secret", PathStyle: true, Timeout: 10,
	}}}, server.Client())
	repo, err := dejavu.NewRepo(filepath.Join(base, "data"), filepath.Join(base, "repo"), filepath.Join(base, "history"),
		filepath.Join(base, "temp"), "device", "Device", "test", []byte("01234567890123456789012345678901"), nil, s3)
	if err != nil {
		t.Fatal(err)
	}
	cache := &dejavu.CloudSnapshotCache{}
	for attempt := range 2 {
		load, loadErr := repo.NewCloudRepoLogLoader(cache)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		logs, pages, total, loadErr := cloudRepoSnapshotsByTime(2, 1010, 1050, load)
		if loadErr != nil || pages != 2 || total != 40 || len(logs) != 8 || logs[0].Created != 1017 {
			t.Fatalf("range: %+v %d %d %v", logs, pages, total, loadErr)
		}
		mu.Lock()
		if attempt == 0 && (gets != 66 || lists != 1 || heads != 0) {
			t.Errorf("cold requests: GET=%d LIST=%d HEAD=%d", gets, lists, heads)
		}
		if attempt == 1 && (gets != 1 || lists != 1 || heads != 0) {
			t.Errorf("warm requests: GET=%d LIST=%d HEAD=%d", gets, lists, heads)
		}
		gets, lists, heads = 0, 0, 0
		mu.Unlock()
	}
}
