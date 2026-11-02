// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-vcard"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type davPersistenceFixture struct {
	file      string
	put       func(string) error
	get       func() (string, error)
	remove    func() error
	load      func() error
	loaded    func() bool
	setPath   func(string)
	handler   http.Handler
	urlPath   string
	calendars *Calendars
	contacts  *Contacts
}

func newDAVPersistenceFixture(t *testing.T, kind string) davPersistenceFixture {
	t.Helper()
	previousDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previousDir })
	if kind == "calendar" {
		store := &Calendars{}
		objectPath := CalDavDefaultCalendarPath + "/event.ics"
		if err := store.Load(); err != nil {
			t.Fatal(err)
		}
		return davPersistenceFixture{
			calendars: store, contacts: &Contacts{},
			handler: newCalDAVHandler(store), urlPath: objectPath,
			file: DavPath2DirectoryPath(objectPath), load: store.Load,
			loaded: func() bool { return store.loaded },
			put: func(name string) error {
				data := ical.NewCalendar()
				data.Props.SetText(ical.PropVersion, "2.0")
				data.Props.SetText(ical.PropProductID, "test")
				event := ical.NewComponent(ical.CompEvent)
				event.Props.SetText(ical.PropUID, "test-event")
				event.Props.SetDateTime(ical.PropDateTimeStamp, time.Unix(1700000000, 0).UTC())
				event.Props.SetText(ical.PropSummary, name)
				data.Children = append(data.Children, event)
				_, _, err := store.PutCalendarObject(objectPath, data, nil)
				return err
			},
			get: func() (string, error) {
				data, err := store.GetCalendarObject(objectPath)
				if err != nil {
					return "", err
				}
				return data.Data.Children[0].Props.Text(ical.PropSummary)
			},
			remove:  func() error { return store.DeleteCalendarObject(objectPath, nil) },
			setPath: func(file string) { _, object, _ := store.GetObject(objectPath); object.FilePath = file },
		}
	}
	store := &Contacts{}
	objectPath := CardDavDefaultAddressBookPath + "/person.vcf"
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}
	return davPersistenceFixture{
		calendars: &Calendars{}, contacts: store,
		handler: newCardDAVHandler(store), urlPath: objectPath,
		file: DavPath2DirectoryPath(objectPath), load: store.Load,
		loaded: func() bool { return store.loaded },
		put: func(name string) error {
			card := vcard.Card{}
			card.SetValue(vcard.FieldVersion, "3.0")
			card.SetValue(vcard.FieldFormattedName, name)
			_, _, err := store.PutAddressObject(objectPath, card, nil)
			return err
		},
		get: func() (string, error) {
			data, err := store.GetAddressObject(objectPath)
			if err != nil {
				return "", err
			}
			return data.Card.Value(vcard.FieldFormattedName), nil
		},
		remove:  func() error { return store.DeleteAddressObject(objectPath, nil) },
		setPath: func(file string) { _, object, _ := store.GetAddress(objectPath); object.FilePath = file },
	}
}

func TestDAVFailedPersistence(t *testing.T) {
	for _, kind := range []string{"calendar", "contact"} {
		for _, stage := range []string{"write", "afterWrite", "metadata", "delete"} {
			t.Run(kind+"/"+stage, func(t *testing.T) {
				fixture := newDAVPersistenceFixture(t, kind)
				if err := fixture.put("old"); err != nil {
					t.Fatal(err)
				}
				originalWrite := writeDAVFile
				t.Cleanup(func() { writeDAVFile = originalWrite })
				if stage == "delete" {
					// A nonempty directory reliably fails os.Remove on every platform.
					blocked := filepath.Join(t.TempDir(), "nonempty")
					if err := os.Mkdir(blocked, 0700); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(filepath.Join(blocked, "child"), nil, 0600); err != nil {
						t.Fatal(err)
					}
					fixture.setPath(blocked)
					if err := fixture.remove(); err == nil {
						t.Fatal("delete unexpectedly succeeded")
					}
				} else {
					writeDAVFile = func(file string, data []byte, mode os.FileMode) error {
						if stage == "write" {
							return errors.New("injected write failure")
						}
						if err := originalWrite(file, data, mode); err != nil {
							return err
						}
						if stage == "metadata" {
							return os.Remove(file)
						}
						return errors.New("injected error after persistence")
					}
					if err := fixture.put("new"); err == nil {
						t.Fatal("put unexpectedly succeeded")
					}
				}
				if name, err := fixture.get(); err != nil || name != "old" {
					t.Fatalf("failed operation mutated cached object: %q, %v", name, err)
				}
				if fixture.loaded() {
					t.Fatal("failure must invalidate cache for subsequent requests")
				}
				writeDAVFile = originalWrite
				if err := fixture.load(); err != nil {
					t.Fatal(err)
				}
				name, err := fixture.get()
				if stage == "metadata" {
					if err == nil {
						t.Fatal("missing persisted file remained visible after reload")
					}
					return
				}
				want := "old"
				if stage == "afterWrite" {
					want = "new"
				}
				if err != nil || name != want {
					t.Fatalf("reload = %q, %v; want %q", name, err, want)
				}
				if err := fixture.put("retry"); err != nil {
					t.Fatal(err)
				}
				if name, err = fixture.get(); err != nil || name != "retry" {
					t.Fatalf("retry = %q, %v", name, err)
				}
				if err := fixture.remove(); err != nil {
					t.Fatal(err)
				}
				if _, err := fixture.get(); err == nil {
					t.Fatal("deleted object remains cached")
				}
				if _, err := os.Stat(fixture.file); !os.IsNotExist(err) {
					t.Fatalf("deleted file: %v", err)
				}
			})
		}
	}
}

// TestDAVFailedCollectionPersistence 验证集合的死属性保存失败时，PROPPATCH 与创建集合不会在元数据文件中留下部分更新
// （RFC 4918 §9.2、RFC 4791 §5.3.1、RFC 5689 §3）。
func TestDAVFailedCollectionPersistence(t *testing.T) {
	type davCollectionKind struct {
		name                   string
		handler                func(calDAV, cardDAV http.Handler) http.Handler
		collection, created    string
		metaData, properties   func() string
		createMethod, mkcolXML string
	}
	kinds := []davCollectionKind{
		{"calendar", func(calDAV, _ http.Handler) http.Handler { return calDAV }, CalDavDefaultCalendarPath, CalDavHomeSetPath + "/work",
			CalendarsMetaDataFilePath, CalendarsPropertiesFilePath, "MKCALENDAR",
			`<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/"><D:set><D:prop><D:displayname>Changed</D:displayname><A:calendar-color>#FF0000FF</A:calendar-color></D:prop></D:set></C:mkcalendar>`},
		{"contact", func(_, cardDAV http.Handler) http.Handler { return cardDAV }, CardDavDefaultAddressBookPath, CardDavHomeSetPath + "/team",
			AddressBooksMetaDataFilePath, AddressBooksPropertiesFilePath, "MKCOL",
			`<?xml version="1.0"?><D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:A="http://apple.com/ns/ical/"><D:set><D:prop><D:resourcetype><D:collection/><C:addressbook/></D:resourcetype><D:displayname>Changed</D:displayname><A:calendar-color>#FF0000FF</A:calendar-color></D:prop></D:set></D:mkcol>`},
	}
	for _, kind := range kinds {
		for _, operation := range []string{"PROPPATCH", "create"} {
			for _, stage := range []string{"directory", "write", "afterWrite"} {
				t.Run(kind.name+"/"+operation+"/"+stage, func(t *testing.T) {
					handler := kind.handler(newDAVHandlerFixture(t))
					request := func() int {
						if "PROPPATCH" == operation {
							return davTestRequest(handler, "PROPPATCH", kind.collection, davTestXMLOnly,
								davTestPropPatch(`<D:displayname>Changed</D:displayname><A:calendar-color>#FF0000FF</A:calendar-color>`, "")).Code
						}
						return davTestRequest(handler, kind.createMethod, kind.created, davTestXMLOnly, kind.mkcolXML).Code
					}
					if response := davTestRequest(handler, "PROPPATCH", kind.collection, davTestXMLOnly, davTestPropPatch(`<A:calendar-color>#000000FF</A:calendar-color>`, "")); response.Code != http.StatusMultiStatus {
						t.Fatalf("initial PROPPATCH: status = %d", response.Code)
					}
					metaData, properties := kind.metaData(), kind.properties()
					metaDataBefore, err := os.ReadFile(metaData)
					if err != nil {
						t.Fatal(err)
					}
					propertiesBefore, err := os.ReadFile(properties)
					if err != nil {
						t.Fatal(err)
					}

					originalWrite := writeDAVFile
					t.Cleanup(func() { writeDAVFile = originalWrite })
					if "directory" == stage {
						if err = os.Remove(properties); err != nil {
							t.Fatal(err)
						}
						if err = os.Mkdir(properties, 0755); err != nil {
							t.Fatal(err)
						}
					} else {
						failed := false
						writeDAVFile = func(file string, data []byte, mode os.FileMode) error {
							if filepath.Clean(file) != filepath.Clean(properties) || failed {
								return originalWrite(file, data, mode)
							}
							failed = true
							if "afterWrite" == stage {
								if err := originalWrite(file, data, mode); err != nil {
									return err
								}
							}
							return errors.New("injected properties failure")
						}
					}
					if status := request(); status != http.StatusInternalServerError {
						t.Fatalf("%s: status = %d, want 500", operation, status)
					}
					if after, _ := os.ReadFile(metaData); !bytes.Equal(after, metaDataBefore) {
						t.Fatalf("failed %s changed the metadata:\n%s\nwant:\n%s", operation, after, metaDataBefore)
					}
					writeDAVFile = originalWrite
					if "directory" == stage {
						if err = os.Remove(properties); err != nil {
							t.Fatal(err)
						}
						if err = os.WriteFile(properties, propertiesBefore, 0644); err != nil {
							t.Fatal(err)
						}
					} else if after, _ := os.ReadFile(properties); !bytes.Equal(after, propertiesBefore) {
						t.Fatalf("failed %s changed the properties:\n%s\nwant:\n%s", operation, after, propertiesBefore)
					}

					resetDAVStores()
					propfind := davTestRequest(handler, "PROPFIND", kind.collection, map[string]string{"Depth": "0"}, "").Body.String()
					if strings.Contains(propfind, "Changed") || !strings.Contains(propfind, "#000000FF") {
						t.Fatalf("collection after reload: %s", propfind)
					}
					if created := davTestRequest(handler, "PROPFIND", kind.created, map[string]string{"Depth": "0"}, ""); created.Code != http.StatusNotFound {
						t.Fatalf("failed request left a collection: PROPFIND status = %d", created.Code)
					}
					want := http.StatusMultiStatus
					if "create" == operation {
						want = http.StatusCreated
					}
					if status := request(); status != want {
						t.Fatalf("retry %s: status = %d, want %d", operation, status, want)
					}
				})
			}
		}
	}
}
