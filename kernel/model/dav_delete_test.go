// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/emersion/go-webdav"
	"github.com/emersion/go-webdav/caldav"
	"github.com/emersion/go-webdav/carddav"
)

type deleteAddressBookTestBackend struct {
	carddav.Backend
	contacts *Contacts
}

func (b *deleteAddressBookTestBackend) DeleteAddressBook(ctx context.Context, path string) error {
	return b.contacts.DeleteAddressBook(PathCleanWithSlash(path), nil)
}

func TestDAVDeleteMissingCollection(t *testing.T) {
	bookPath := CardDavHomeSetPath + "/missing"
	bookMeta := &carddav.AddressBook{Path: bookPath}
	books := &Contacts{booksMetaData: []*carddav.AddressBook{bookMeta}}
	calendarPath := CalDavHomeSetPath + "/missing"
	calendarMeta := &caldav.Calendar{Path: calendarPath}
	calendarStore := &Calendars{calendarsMetaData: []*caldav.Calendar{calendarMeta}}

	for _, test := range []struct {
		name    string
		path    string
		handler http.Handler
	}{
		{"CardDAV", bookPath, &carddav.Handler{
			Prefix:  CardDavPrincipalsPath,
			Backend: &deleteAddressBookTestBackend{contacts: books},
		}},
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
		if want := webdav.NewHTTPError(http.StatusNotFound, ErrorCalDavCalendarNotFound); err == nil || err.Error() != want.Error() {
			t.Fatalf("DeleteCalendar error = %v, want %v", err, want)
		}
	}
	if len(books.booksMetaData) != 1 || books.booksMetaData[0] != bookMeta {
		t.Fatal("missing address book deletion changed metadata")
	}
	if len(calendarStore.calendarsMetaData) != 1 || calendarStore.calendarsMetaData[0] != calendarMeta {
		t.Fatal("missing calendar deletion changed metadata")
	}
}
