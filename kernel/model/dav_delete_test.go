// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/dav"
)

// TestDAVDeleteMissingCollection 验证元数据中有记录、但没有载入的集合删除时返回 404，且不改动元数据。
func TestDAVDeleteMissingCollection(t *testing.T) {
	bookPath := CardDavHomeSetPath + "/missing"
	bookMeta := &AddressBookMetaData{Path: bookPath}
	books := &Contacts{loaded: true, booksMetaData: []*AddressBookMetaData{bookMeta}}
	calendarPath := CalDavHomeSetPath + "/missing"
	calendarMeta := &CalendarMetaData{Path: calendarPath}
	calendarStore := &Calendars{loaded: true, calendarsMetaData: []*CalendarMetaData{calendarMeta}}

	for _, test := range []struct {
		name    string
		path    string
		handler http.Handler
	}{
		{"CardDAV", bookPath, newCardDAVHandler(books)},
		{"CalDAV", calendarPath, newCalDAVHandler(calendarStore)},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, suffix := range []string{"", "/", ""} {
				response := httptest.NewRecorder()
				request := httptest.NewRequest(http.MethodDelete, test.path+suffix, nil)
				test.handler.ServeHTTP(response, request)
				if response.Code != http.StatusNotFound {
					t.Fatalf("DELETE %s: status = %d, want 404; body = %s", request.URL.Path, response.Code, response.Body.String())
				}
			}
		})
	}
	for range 3 {
		err := calendarStore.DeleteCalendar(calendarPath, nil)
		var davErr *dav.Error
		if !errors.As(err, &davErr) || http.StatusNotFound != davErr.Status || !errors.Is(err, ErrorCalDavCalendarNotFound) {
			t.Fatalf("DeleteCalendar error = %v, want 404 %v", err, ErrorCalDavCalendarNotFound)
		}
	}
	if len(books.booksMetaData) != 1 || books.booksMetaData[0] != bookMeta {
		t.Fatal("missing address book deletion changed metadata")
	}
	if len(calendarStore.calendarsMetaData) != 1 || calendarStore.calendarsMetaData[0] != calendarMeta {
		t.Fatal("missing calendar deletion changed metadata")
	}
}
