// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/emersion/go-webdav/caldav"
	"github.com/emersion/go-webdav/carddav"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// newDAVHandlerFixture 让全局日历与通讯录存储从空的临时数据目录重新加载，并返回生产环境使用的处理器。
func newDAVHandlerFixture(t *testing.T) (calDAV, cardDAV http.Handler) {
	t.Helper()
	previous := util.DataDir
	util.DataDir = t.TempDir()
	resetDAVStores()
	t.Cleanup(func() {
		util.DataDir = previous
		resetDAVStores()
	})
	return NewCalDAVHandler(), NewCardDAVHandler()
}

func resetDAVStores() {
	calendars.lock.Lock()
	calendars.loaded = false
	calendars.calendars.Clear()
	calendars.calendarsMetaData = nil
	calendars.lock.Unlock()
	contacts.lock.Lock()
	contacts.loaded = false
	contacts.books.Clear()
	contacts.booksMetaData = nil
	contacts.lock.Unlock()
}

func davTestRequest(h http.Handler, method, target string, header map[string]string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	for k, v := range header {
		request.Header.Set(k, v)
	}
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	return response
}

// davCRLF 把测试里按行书写的 iCalendar / vCard 文本转换为 CRLF 换行。
func davCRLF(lines ...string) string {
	return strings.Join(lines, "\r\n") + "\r\n"
}

func davTestEvent(uid, summary string) string {
	return davCRLF("BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SiYuan test//EN",
		"BEGIN:VEVENT", "UID:"+uid, "SUMMARY:"+summary, "DTSTAMP:20261101T000000Z",
		"DTSTART:20261102T090000Z", "DTEND:20261102T100000Z", "END:VEVENT", "END:VCALENDAR")
}

func davTestCard(uid, name string) string {
	return davCRLF("BEGIN:VCARD", "VERSION:3.0", "UID:"+uid, "FN:"+name, "EMAIL:"+uid+"@example.com", "END:VCARD")
}

var (
	davICalendarHeader = map[string]string{"Content-Type": "text/calendar"}
	davVCardHeader     = map[string]string{"Content-Type": "text/vcard"}
	davXMLHeader       = map[string]string{"Content-Type": "application/xml", "Depth": "1"}
)

// rawDAVRequest 通过真实的 net/http 服务端发送原始请求行；httptest.NewRequest 无法证明服务端不会清理路径。
func rawDAVRequest(t *testing.T, server *httptest.Server, method, target string) int {
	t.Helper()
	conn, err := net.Dial("tcp", strings.TrimPrefix(server.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err = fmt.Fprintf(conn, "%s %s HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", method, target); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	return response.StatusCode
}

// TestDAVRejectsNonCanonicalPaths 验证含点段或反斜杠的请求路径被拒绝，
// 不能借后端清理路径跳到另一个 DAV 命名空间删除数据。
func TestDAVRejectsNonCanonicalPaths(t *testing.T) {
	calDAV, cardDAV := newDAVHandlerFixture(t)
	event := CalDavDefaultCalendarPath + "/keep.ics"
	if response := davTestRequest(calDAV, http.MethodPut, event, davICalendarHeader, davTestEvent("keep", "Keep")); response.Code != http.StatusCreated {
		t.Fatalf("setup PUT: status = %d", response.Code)
	}

	server := httptest.NewServer(cardDAV)
	defer server.Close()
	for _, request := range []struct{ method, target string }{
		{"MKCOL", "/carddav/../caldav/principals/main"},
		{http.MethodDelete, "/carddav/../caldav/principals/main"},
		{http.MethodDelete, "/carddav/principals/main/contacts/./default"},
		{"MKCOL", "/carddav/principals/main/contacts/x%5C..%5C..%5C..%5Ccaldav"},
		{http.MethodGet, "/carddav/principals/main/contacts/default/a%00.vcf"},
	} {
		if status := rawDAVRequest(t, server, request.method, request.target); status != http.StatusBadRequest {
			t.Errorf("%s %s: status = %d, want 400", request.method, request.target, status)
		}
	}
	if response := davTestRequest(calDAV, http.MethodGet, event, nil, ""); response.Code != http.StatusOK {
		t.Fatalf("calendar object after rejected requests: status = %d", response.Code)
	}
}

// TestDAVBackendConfinesCollectionPaths 验证后端只在各自的 home set 下创建集合，
// 即使请求绕过了前置路径检查也不能在 data/storage 的其他位置建目录或注册集合。
func TestDAVBackendConfinesCollectionPaths(t *testing.T) {
	newDAVHandlerFixture(t)
	ctx := context.Background()
	for _, p := range []string{"/caldav/principals/main", "/petal/plugin/x", CardDavHomeSetPath + "/a/b"} {
		if err := (&CardDavBackend{}).CreateAddressBook(ctx, &carddav.AddressBook{Path: p}); err == nil {
			t.Errorf("CreateAddressBook(%s) succeeded", p)
		}
		books, err := (&CardDavBackend{}).ListAddressBooks(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, book := range books {
			if book.Path == p {
				t.Errorf("address book registered at %s", p)
			}
		}
	}
	for _, p := range []string{"/carddav/principals/main", "/petal/plugin/y", CalDavHomeSetPath + "/a/b"} {
		if err := (&CalDavBackend{}).CreateCalendar(ctx, &caldav.Calendar{Path: p}); err == nil {
			t.Errorf("CreateCalendar(%s) succeeded", p)
		}
	}
	for _, dir := range []string{"petal", filepath.Join("caldav", "principals", "main", "calendars", "a")} {
		if _, err := os.Stat(filepath.Join(util.DataDir, "storage", dir)); err == nil {
			t.Errorf("collection directory created at storage/%s", dir)
		}
	}
}

// TestDAVDiscoveryPaths 验证用户手动输入服务根地址或带尾斜杠的集合地址时也能发现服务。
func TestDAVDiscoveryPaths(t *testing.T) {
	calDAV, cardDAV := newDAVHandlerFixture(t)
	for _, test := range []struct {
		handler     http.Handler
		target      string
		depth, want string
	}{
		{calDAV, "/caldav", "0", ">" + CalDavUserPrincipalPath + "<"},
		{calDAV, "/caldav/", "0", ">" + CalDavUserPrincipalPath + "<"},
		{calDAV, CalDavUserPrincipalPath + "/", "0", ">" + CalDavHomeSetPath + "<"},
		{calDAV, CalDavHomeSetPath + "/", "1", ">" + CalDavDefaultCalendarPath + "<"},
		{cardDAV, "/carddav/", "0", ">" + CardDavUserPrincipalPath + "<"},
		{cardDAV, CardDavHomeSetPath + "/", "1", ">" + CardDavDefaultAddressBookPath + "<"},
	} {
		response := davTestRequest(test.handler, "PROPFIND", test.target, map[string]string{"Depth": test.depth}, "")
		if response.Code != http.StatusMultiStatus || !strings.Contains(response.Body.String(), test.want) {
			t.Errorf("PROPFIND %s: status = %d, missing %q in %s", test.target, response.Code, test.want, response.Body.String())
		}
	}
}
