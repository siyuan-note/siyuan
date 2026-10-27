// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-vcard"
	"github.com/emersion/go-webdav/caldav"
	"github.com/emersion/go-webdav/carddav"
)

type caldavPutTestBackend struct {
	caldav.Backend
	store *Calendars
}

func (b *caldavPutTestBackend) PutCalendarObject(_ context.Context, p string, data *ical.Calendar, opts *caldav.PutCalendarObjectOptions) (*caldav.CalendarObject, error) {
	return b.store.PutCalendarObject(PathCleanWithSlash(p), data, opts)
}

type carddavPutTestBackend struct {
	carddav.Backend
	store *Contacts
}

func (b *carddavPutTestBackend) PutAddressObject(_ context.Context, p string, data vcard.Card, opts *carddav.PutAddressObjectOptions) (*carddav.AddressObject, error) {
	return b.store.PutAddressObject(PathCleanWithSlash(p), data, opts)
}

func davConditionalRequest(f davPersistenceFixture, kind, header, value string) *httptest.ResponseRecorder {
	body, contentType := "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:replacement\r\nEND:VCARD\r\n", vcard.MIMEType
	if kind == "calendar" {
		body, contentType = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\nBEGIN:VEVENT\r\nUID:test-event\r\nDTSTAMP:20231114T221320Z\r\nSUMMARY:replacement\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n", ical.MIMEType
	}
	request := httptest.NewRequest(http.MethodPut, f.urlPath, bytes.NewBufferString(body))
	request.Header.Set("Content-Type", contentType)
	request.Header.Set(header, value)
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, request)
	return response
}

func TestDAVConditionalWrites(t *testing.T) {
	for _, kind := range []string{"calendar", "contact"} {
		for _, test := range []struct {
			name, header, value string
			missing             bool
			status              int
		}{
			{"current", "If-Match", "current", false, 201},
			{"stale", "If-Match", "stale", false, 412},
			{"matchAny", "If-Match", "*", false, 201},
			{"matchMissing", "If-Match", "*", true, 412},
			{"createExisting", "If-None-Match", "*", false, 412},
			{"createMissing", "If-None-Match", "*", true, 201},
			{"noneCurrent", "If-None-Match", "current", false, 412},
			{"noneOther", "If-None-Match", "stale", false, 201},
			{"malformed", "If-Match", "unquoted", false, 400},
			{"unconditional", "", "", false, 201},
		} {
			t.Run(kind+"/"+test.name, func(t *testing.T) {
				f := newDAVPersistenceFixture(t, kind)
				if err := f.put("old"); err != nil {
					t.Fatal(err)
				}
				etag, err := FileETag(f.file)
				if err != nil {
					t.Fatal(err)
				}
				if err = f.put("latest"); err != nil {
					t.Fatal(err)
				}
				if test.value == "current" {
					etag, err = FileETag(f.file)
					if err != nil {
						t.Fatal(err)
					}
				}
				value := test.value
				if value == "current" || value == "stale" {
					value = fmt.Sprintf("%q", etag)
				}
				if test.missing {
					if err = f.remove(); err != nil {
						t.Fatal(err)
					}
				}
				before, _ := os.ReadFile(f.file)
				response := davConditionalRequest(f, kind, test.header, value)
				if response.Code != test.status {
					t.Fatalf("status=%d want=%d: %s", response.Code, test.status, response.Body.String())
				}
				if test.status != 201 {
					after, _ := os.ReadFile(f.file)
					if !bytes.Equal(before, after) {
						t.Fatal("rejected request changed disk")
					}
					name, err := f.get()
					if test.missing {
						if err == nil {
							t.Fatal("rejected request created cached object")
						}
					} else if err != nil || name != "latest" {
						t.Fatalf("rejected request changed cache: %q, %v", name, err)
					}
				}
			})
		}
		t.Run(kind+"/concurrent", func(t *testing.T) {
			f := newDAVPersistenceFixture(t, kind)
			if err := f.put("old"); err != nil {
				t.Fatal(err)
			}
			etag, err := FileETag(f.file)
			if err != nil {
				t.Fatal(err)
			}
			results := make(chan int, 2)
			var wg sync.WaitGroup
			for range 2 {
				wg.Go(func() { results <- davConditionalRequest(f, kind, "If-Match", fmt.Sprintf("%q", etag)).Code })
			}
			wg.Wait()
			first, second := <-results, <-results
			if first+second != 201+412 {
				t.Fatalf("concurrent writes returned %d, %d", first, second)
			}
		})
	}
}
