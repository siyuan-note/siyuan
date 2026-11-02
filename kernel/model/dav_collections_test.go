// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"net/http"
	"os"
	"strings"
	"testing"
)

const (
	davTestMkcolCalendar    = `<?xml version="1.0"?><D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>Renamed</D:displayname></D:prop></D:set></D:mkcol>`
	davTestMkcolAddressBook = `<?xml version="1.0"?><D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:set><D:prop><D:resourcetype><D:collection/><C:addressbook/></D:resourcetype><D:displayname>Renamed</D:displayname></D:prop></D:set></D:mkcol>`
)

// TestCalDAVDeleteCalendarCollection 验证 DELETE 日历集合会删除日历及其中的对象。
func TestCalDAVDeleteCalendarCollection(t *testing.T) {
	calDAV, _ := newDAVHandlerFixture(t)
	work := CalDavHomeSetPath + "/work"
	if response := davTestRequest(calDAV, "MKCOL", work, map[string]string{"Content-Type": "application/xml"}, davTestMkcolCalendar); response.Code != http.StatusCreated {
		t.Fatalf("MKCOL: status = %d; body = %s", response.Code, response.Body.String())
	}
	if response := davTestRequest(calDAV, http.MethodPut, work+"/a.ics", davICalendarHeader, davTestEvent("a", "A")); response.Code != http.StatusCreated {
		t.Fatalf("PUT: status = %d", response.Code)
	}
	if response := davTestRequest(calDAV, http.MethodDelete, work, nil, ""); response.Code != http.StatusNoContent {
		t.Fatalf("DELETE calendar: status = %d; body = %s", response.Code, response.Body.String())
	}
	if response := davTestRequest(calDAV, "PROPFIND", work, map[string]string{"Depth": "0"}, ""); response.Code != http.StatusNotFound {
		t.Fatalf("PROPFIND deleted calendar: status = %d", response.Code)
	}
	if _, err := os.Stat(DavPath2DirectoryPath(work)); !os.IsNotExist(err) {
		t.Fatalf("calendar directory remains: %v", err)
	}
	if meta, _ := os.ReadFile(CalendarsMetaDataFilePath()); strings.Contains(string(meta), work) {
		t.Fatalf("calendar metadata still lists the deleted calendar: %s", meta)
	}
}

// TestDAVMkcolOnExistingCollection 验证 MKCOL 不能覆盖已有集合的元数据。
func TestDAVMkcolOnExistingCollection(t *testing.T) {
	calDAV, cardDAV := newDAVHandlerFixture(t)
	for _, test := range []struct {
		handler      http.Handler
		target, body string
		metadata     func() string
	}{
		{calDAV, CalDavDefaultCalendarPath, davTestMkcolCalendar, CalendarsMetaDataFilePath},
		{cardDAV, CardDavDefaultAddressBookPath, davTestMkcolAddressBook, AddressBooksMetaDataFilePath},
	} {
		// 先访问一次以生成默认集合与元数据
		davTestRequest(test.handler, "PROPFIND", test.target, map[string]string{"Depth": "0"}, "")
		before, err := os.ReadFile(test.metadata())
		if err != nil {
			t.Fatal(err)
		}
		response := davTestRequest(test.handler, "MKCOL", test.target, map[string]string{"Content-Type": "application/xml"}, test.body)
		if response.Code != http.StatusMethodNotAllowed {
			t.Errorf("MKCOL %s: status = %d, want 405", test.target, response.Code)
		}
		if after, _ := os.ReadFile(test.metadata()); string(after) != string(before) {
			t.Errorf("MKCOL %s changed metadata:\n%s\n->\n%s", test.target, before, after)
		}
	}
}

// TestCalDAVNewCalendarSupportsTasks 验证未声明组件集的新日历默认同时支持事件和待办。
func TestCalDAVNewCalendarSupportsTasks(t *testing.T) {
	calDAV, _ := newDAVHandlerFixture(t)
	tasks := CalDavHomeSetPath + "/tasks"
	if response := davTestRequest(calDAV, "MKCOL", tasks, map[string]string{"Content-Type": "application/xml"}, davTestMkcolCalendar); response.Code != http.StatusCreated {
		t.Fatalf("MKCOL: status = %d", response.Code)
	}
	propfind := davTestRequest(calDAV, "PROPFIND", tasks, map[string]string{"Depth": "0", "Content-Type": "application/xml"},
		`<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:supported-calendar-component-set/></D:prop></D:propfind>`)
	if !strings.Contains(propfind.Body.String(), `name="VTODO"`) {
		t.Fatalf("supported-calendar-component-set lacks VTODO: %s", propfind.Body.String())
	}
	todo := davCRLF("BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SiYuan test//EN", "BEGIN:VTODO", "UID:task",
		"DTSTAMP:20261101T000000Z", "SUMMARY:Task", "END:VTODO", "END:VCALENDAR")
	if response := davTestRequest(calDAV, http.MethodPut, tasks+"/task.ics", davICalendarHeader, todo); response.Code != http.StatusCreated {
		t.Fatalf("PUT VTODO: status = %d; body = %s", response.Code, response.Body.String())
	}
}
