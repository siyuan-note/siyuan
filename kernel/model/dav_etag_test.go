// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestDAVETagTracksContent(t *testing.T) {
	file := filepath.Join(t.TempDir(), "object")
	stamp := time.Unix(1700000000, 123000000)
	calendar := &CalendarObject{FilePath: file, Data: &CalendarObjectData{}}
	address := &AddressObject{FilePath: file, Data: &AddressObjectData{}}
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

// TestDAVPutETagRequiresOctetEquality 验证存储内容与提交内容不是同一字节序列时 PUT 响应不带强 ETag
// （RFC 4791 §5.3.4、RFC 6352 §6.3.2.3），与存储形式一致的提交仍然返回 ETag。
func TestDAVPutETagRequiresOctetEquality(t *testing.T) {
	calDAV, cardDAV := newDAVHandlerFixture(t)
	for _, test := range []struct {
		name, target, body string
		handler            http.Handler
		header             map[string]string
	}{
		{"calendar", CalDavDefaultCalendarPath + "/a.ics", davTestEvent("a", "A"), calDAV, davICalendarHeader},
		{"contact", CardDavDefaultAddressBookPath + "/a.vcf", davTestCard("a", "A"), cardDAV, davVCardHeader},
	} {
		t.Run(test.name, func(t *testing.T) {
			put := davTestRequest(test.handler, http.MethodPut, test.target, test.header, test.body)
			if put.Code != http.StatusCreated {
				t.Fatalf("PUT: status = %d", put.Code)
			}
			stored := davTestRequest(test.handler, http.MethodGet, test.target, nil, "")
			if stored.Body.String() == test.body {
				t.Fatal("fixture body is already in stored form; the test would not exercise re-encoding")
			}
			if etag := put.Header().Get("ETag"); etag != "" {
				t.Fatalf("PUT of re-encoded content returned strong ETag %s", etag)
			}
			again := davTestRequest(test.handler, http.MethodPut, test.target, test.header, stored.Body.String())
			if etag := again.Header().Get("ETag"); again.Code != http.StatusNoContent || etag == "" || etag != davTestRequest(test.handler, http.MethodGet, test.target, nil, "").Header().Get("ETag") {
				t.Fatalf("PUT of stored form: status = %d, ETag = %q", again.Code, etag)
			}
		})
	}
}

// TestDAVContentLengthMatchesBody 验证磁盘文件不是规范编码时 Content-Length 仍等于实际响应长度。
func TestDAVContentLengthMatchesBody(t *testing.T) {
	calDAV, cardDAV := newDAVHandlerFixture(t)
	for _, test := range []struct {
		handler      http.Handler
		target, file string
		content      string
	}{
		{calDAV, CalDavDefaultCalendarPath + "/lf.ics", "lf.ics", "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//SiYuan test//EN\nBEGIN:VEVENT\nUID:lf\nDTSTAMP:20261101T000000Z\nSUMMARY:LF\nEND:VEVENT\nEND:VCALENDAR\n"},
		{cardDAV, CardDavDefaultAddressBookPath + "/lf.vcf", "lf.vcf", "BEGIN:VCARD\nVERSION:3.0\nUID:lf\nFN:Line Feed\nEND:VCARD\n"},
	} {
		dir := DavPath2DirectoryPath(path.Dir(test.target))
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, test.file), []byte(test.content), 0644); err != nil {
			t.Fatal(err)
		}
		response := davTestRequest(test.handler, http.MethodGet, test.target, nil, "")
		if length := response.Header().Get("Content-Length"); response.Code != http.StatusOK || length != strconv.Itoa(response.Body.Len()) {
			t.Errorf("GET %s: status = %d, Content-Length = %s, body length = %d", test.target, response.Code, length, response.Body.Len())
		}
	}
}
