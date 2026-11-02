// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"strings"
	"testing"
)

const davTestPropfindPrivileges = `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-privilege-set/><D:supported-report-set/><D:current-user-principal/></D:prop></D:propfind>`

// TestDAVDiscovery 验证 well-known 重定向、OPTIONS 能力声明，以及所有资源都返回
// current-user-privilege-set 与 supported-report-set（RFC 6764 §5、RFC 3744 §5.4、RFC 4791 §2、RFC 6352 §3）。
func TestDAVDiscovery(t *testing.T) {
	calDAV, cardDAV := newDAVHandlerFixture(t)
	if response := davTestRequest(calDAV, http.MethodPut, CalDavDefaultCalendarPath+"/a.ics", davICalendarHeader, davTestEvent("a", "A")); response.Code != http.StatusCreated {
		t.Fatalf("PUT: status = %d", response.Code)
	}
	for _, test := range []struct {
		handler            http.Handler
		wellKnown, target  string
		capability, report string
		resources          []string
	}{
		{calDAV, "/.well-known/caldav", CalDavUserPrincipalPath, "calendar-access", "calendar-query",
			[]string{CalDavPrefixPath, CalDavUserPrincipalPath, CalDavHomeSetPath, CalDavDefaultCalendarPath, CalDavDefaultCalendarPath + "/a.ics"}},
		{cardDAV, "/.well-known/carddav", CardDavUserPrincipalPath, "addressbook", "addressbook-query",
			[]string{CardDavPrefixPath, CardDavUserPrincipalPath, CardDavHomeSetPath, CardDavDefaultAddressBookPath}},
	} {
		for _, method := range []string{http.MethodGet, "PROPFIND"} {
			if response := davTestRequest(test.handler, method, test.wellKnown, nil, ""); response.Code != http.StatusPermanentRedirect || response.Header().Get("Location") != test.target {
				t.Errorf("%s %s: status = %d, Location = %q", method, test.wellKnown, response.Code, response.Header().Get("Location"))
			}
		}
		options := davTestRequest(test.handler, http.MethodOptions, test.resources[3], nil, "")
		if dav := options.Header().Get("DAV"); !strings.Contains(dav, test.capability) || !strings.Contains(dav, "extended-mkcol") || !strings.Contains(options.Header().Get("Allow"), "PROPPATCH") {
			t.Errorf("OPTIONS %s: DAV = %q, Allow = %q", test.resources[3], dav, options.Header().Get("Allow"))
		}
		for _, resource := range test.resources {
			response := davTestRequest(test.handler, "PROPFIND", resource, map[string]string{"Depth": "0"}, davTestPropfindPrivileges)
			body := response.Body.String()
			if response.Code != http.StatusMultiStatus || strings.Contains(body, "404 Not Found") || !strings.Contains(body, "<write ") ||
				!strings.Contains(body, test.report) || !strings.Contains(body, ">"+test.target+"<") {
				t.Errorf("PROPFIND %s: status = %d; body = %s", resource, response.Code, body)
			}
		}
	}
	collection := davTestRequest(calDAV, "PROPFIND", CalDavDefaultCalendarPath, map[string]string{"Depth": "0"}, davTestPropfindPrivileges).Body.String()
	object := davTestRequest(calDAV, "PROPFIND", CalDavDefaultCalendarPath+"/a.ics", map[string]string{"Depth": "0"}, davTestPropfindPrivileges).Body.String()
	if !strings.Contains(collection, "free-busy-query") || strings.Contains(object, "free-busy-query") {
		t.Errorf("free-busy-query must be reported on collections only:\n%s\n%s", collection, object)
	}
}

// TestDAVReports 验证 expand-property（RFC 3253 §3.8）和不支持的报告返回 DAV:supported-report（RFC 3253 §3.6）。
func TestDAVReports(t *testing.T) {
	calDAV, _ := newDAVHandlerFixture(t)
	expand := davTestRequest(calDAV, "REPORT", CalDavUserPrincipalPath, davTestXMLOnly,
		`<?xml version="1.0"?><D:expand-property xmlns:D="DAV:"><D:property name="current-user-principal"><D:property name="calendar-home-set" namespace="urn:ietf:params:xml:ns:caldav"/></D:property></D:expand-property>`)
	body := expand.Body.String()
	if expand.Code != http.StatusMultiStatus || strings.Count(body, "<response") != 2 || !strings.Contains(body, ">"+CalDavHomeSetPath+"<") {
		t.Fatalf("expand-property: status = %d; body = %s", expand.Code, body)
	}
	unsupported := davTestRequest(calDAV, "REPORT", CalDavDefaultCalendarPath, davXMLHeader,
		`<?xml version="1.0"?><D:sync-collection xmlns:D="DAV:"><D:sync-token/><D:sync-level>1</D:sync-level><D:prop><D:getetag/></D:prop></D:sync-collection>`)
	if unsupported.Code != http.StatusForbidden || !strings.Contains(unsupported.Body.String(), "supported-report") {
		t.Fatalf("unsupported report: status = %d; body = %s", unsupported.Code, unsupported.Body.String())
	}
}

func davTestPropPatch(set, remove string) string {
	body := `<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:R="urn:ietf:params:xml:ns:carddav" xmlns:A="http://apple.com/ns/ical/">`
	if "" != set {
		body += `<D:set><D:prop>` + set + `</D:prop></D:set>`
	}
	if "" != remove {
		body += `<D:remove><D:prop>` + remove + `</D:prop></D:remove>`
	}
	return body + `</D:propertyupdate>`
}

// davTestMetadataKeys 返回元数据文件中每个集合的字段名，用于确认旧版本能读取改写后的文件。
func davTestMetadataKeys(t *testing.T, file string) (entries []map[string]any, keys []string) {
	t.Helper()
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &entries); err != nil {
		t.Fatal(err)
	}
	for key := range entries[0] {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return
}

// TestDAVPropPatchCollections 验证 PROPPATCH 修改集合名称、描述和死属性，按 RFC 4918 §9.2 原子执行；
// 元数据文件保持早期版本的结构，死属性另存并在重新载入后仍然存在。
func TestDAVPropPatchCollections(t *testing.T) {
	calDAV, cardDAV := newDAVHandlerFixture(t)
	// 早期版本写出的元数据：组件集为 null
	legacy := `[{"Path":"` + CalDavDefaultCalendarPath + `","Name":"default","Description":"Default calendar","MaxResourceSize":0,"SupportedComponentSet":null}]`
	if err := os.MkdirAll(DavPath2DirectoryPath(CalDavHomeSetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(CalendarsMetaDataFilePath(), []byte(legacy), 0644); err != nil {
		t.Fatal(err)
	}
	patch := davTestRequest(calDAV, "PROPPATCH", CalDavDefaultCalendarPath, davTestXMLOnly,
		davTestPropPatch(`<D:displayname>Work</D:displayname><C:calendar-description>Office</C:calendar-description><A:calendar-color>#FF0000FF</A:calendar-color>`, ""))
	if patch.Code != http.StatusMultiStatus || strings.Contains(patch.Body.String(), "403") || !strings.Contains(patch.Body.String(), "200 OK") {
		t.Fatalf("PROPPATCH: status = %d; body = %s", patch.Code, patch.Body.String())
	}
	entries, keys := davTestMetadataKeys(t, CalendarsMetaDataFilePath())
	if strings.Join(keys, ",") != "Description,MaxResourceSize,Name,Path,SupportedComponentSet" || "Work" != entries[0]["Name"] || "Office" != entries[0]["Description"] || nil != entries[0]["SupportedComponentSet"] {
		t.Fatalf("calendars.json = %v", entries)
	}
	if properties, err := os.ReadFile(CalendarsPropertiesFilePath()); err != nil || !strings.Contains(string(properties), "calendar-color") {
		t.Fatalf("properties.json = %s, %v", properties, err)
	}

	resetDAVStores()
	propfind := davTestRequest(calDAV, "PROPFIND", CalDavDefaultCalendarPath, map[string]string{"Depth": "0"}, "").Body.String()
	for _, want := range []string{">Work<", ">Office<", `<calendar-color xmlns="http://apple.com/ns/ical/">#FF0000FF<`} {
		if !strings.Contains(propfind, want) {
			t.Fatalf("allprop after reload lacks %s: %s", want, propfind)
		}
	}

	failed := davTestRequest(calDAV, "PROPPATCH", CalDavDefaultCalendarPath, davTestXMLOnly, davTestPropPatch(`<D:displayname>Other</D:displayname><D:getetag>"x"</D:getetag>`, ""))
	body := failed.Body.String()
	if failed.Code != http.StatusMultiStatus || !strings.Contains(body, "403 Forbidden") || !strings.Contains(body, "424 Failed Dependency") || !strings.Contains(body, "cannot-modify-protected-property") {
		t.Fatalf("PROPPATCH with a protected property: status = %d; body = %s", failed.Code, body)
	}
	if entries, _ = davTestMetadataKeys(t, CalendarsMetaDataFilePath()); "Work" != entries[0]["Name"] {
		t.Fatalf("failed PROPPATCH changed the name: %v", entries)
	}

	davTestRequest(calDAV, "PROPPATCH", CalDavDefaultCalendarPath, davTestXMLOnly, davTestPropPatch("", `<A:calendar-color/>`))
	if propfind = davTestRequest(calDAV, "PROPFIND", CalDavDefaultCalendarPath, map[string]string{"Depth": "0"}, "").Body.String(); strings.Contains(propfind, "calendar-color") {
		t.Fatalf("removed property is still returned: %s", propfind)
	}

	if response := davTestRequest(calDAV, http.MethodPut, CalDavDefaultCalendarPath+"/a.ics", davICalendarHeader, davTestEvent("a", "A")); response.Code != http.StatusCreated {
		t.Fatalf("PUT: status = %d", response.Code)
	}
	if object := davTestRequest(calDAV, "PROPPATCH", CalDavDefaultCalendarPath+"/a.ics", davTestXMLOnly, davTestPropPatch(`<D:displayname>A</D:displayname>`, "")); !strings.Contains(object.Body.String(), "403 Forbidden") {
		t.Fatalf("PROPPATCH on an object: %s", object.Body.String())
	}

	book := davTestRequest(cardDAV, "PROPPATCH", CardDavDefaultAddressBookPath, davTestXMLOnly, davTestPropPatch(`<D:displayname>People</D:displayname><R:addressbook-description>Friends</R:addressbook-description>`, ""))
	if book.Code != http.StatusMultiStatus || strings.Contains(book.Body.String(), "403") {
		t.Fatalf("CardDAV PROPPATCH: status = %d; body = %s", book.Code, book.Body.String())
	}
	if entries, keys = davTestMetadataKeys(t, AddressBooksMetaDataFilePath()); strings.Join(keys, ",") != "Description,MaxResourceSize,Name,Path,SupportedAddressData" || "People" != entries[0]["Name"] {
		t.Fatalf("address-books.json = %v", entries)
	}
	if data, ok := entries[0]["SupportedAddressData"].([]any); !ok || 2 != len(data) || "text/vcard" != data[0].(map[string]any)["ContentType"] {
		t.Fatalf("address-books.json SupportedAddressData = %v", entries[0]["SupportedAddressData"])
	}
}

// TestDAVCreateCollections 验证 MKCALENDAR 与扩展 MKCOL 设置初始属性，任一属性失败时不创建集合（RFC 4791 §5.3.1、RFC 5689 §3）。
func TestDAVCreateCollections(t *testing.T) {
	calDAV, cardDAV := newDAVHandlerFixture(t)
	tasks := CalDavHomeSetPath + "/tasks"
	mkcalendar := davTestRequest(calDAV, "MKCALENDAR", tasks, davTestXMLOnly,
		`<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/"><D:set><D:prop><D:displayname>Tasks</D:displayname>`+
			`<C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set><A:calendar-color>#00FF00FF</A:calendar-color></D:prop></D:set></C:mkcalendar>`)
	if mkcalendar.Code != http.StatusCreated || mkcalendar.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("MKCALENDAR: status = %d, Cache-Control = %q; body = %s", mkcalendar.Code, mkcalendar.Header().Get("Cache-Control"), mkcalendar.Body.String())
	}
	propfind := davTestRequest(calDAV, "PROPFIND", tasks, map[string]string{"Depth": "0"},
		`<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/"><D:prop><D:displayname/><C:supported-calendar-component-set/><A:calendar-color/></D:prop></D:propfind>`).Body.String()
	if !strings.Contains(propfind, ">Tasks<") || !strings.Contains(propfind, `name="VTODO"`) || strings.Contains(propfind, `name="VEVENT"`) || !strings.Contains(propfind, "#00FF00FF") {
		t.Fatalf("PROPFIND new calendar: %s", propfind)
	}
	if put := davTestRequest(calDAV, http.MethodPut, tasks+"/event.ics", davICalendarHeader, davTestEvent("e", "E")); put.Code != http.StatusConflict || !strings.Contains(put.Body.String(), "supported-calendar-component") {
		t.Fatalf("PUT VEVENT into a VTODO calendar: status = %d; body = %s", put.Code, put.Body.String())
	}
	if again := davTestRequest(calDAV, "MKCALENDAR", tasks, nil, ""); again.Code != http.StatusMethodNotAllowed || "" == again.Header().Get("Allow") {
		t.Fatalf("MKCALENDAR on an existing calendar: status = %d, Allow = %q", again.Code, again.Header().Get("Allow"))
	}

	for _, test := range []struct {
		name, method, target, body string
		handler                    http.Handler
		status                     int
		want                       string
	}{
		{"MKCALENDAR with a protected property", "MKCALENDAR", CalDavHomeSetPath + "/protected", `<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:displayname>P</D:displayname><D:getetag>"x"</D:getetag></D:prop></D:set></C:mkcalendar>`,
			calDAV, http.StatusMultiStatus, "424 Failed Dependency"},
		{"MKCOL of a plain collection", "MKCOL", CalDavHomeSetPath + "/plain", `<?xml version="1.0"?><D:mkcol xmlns:D="DAV:"><D:set><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:set></D:mkcol>`,
			calDAV, http.StatusForbidden, "valid-resourcetype"},
		{"MKCOL with an invalid time zone", "MKCOL", CalDavHomeSetPath + "/zone", `<?xml version="1.0"?><D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype><C:calendar-timezone>invalid</C:calendar-timezone></D:prop></D:set></D:mkcol>`,
			calDAV, http.StatusForbidden, "valid-calendar-data"},
		{"MKCOL of a calendar in CardDAV", "MKCOL", CardDavHomeSetPath + "/wrong", `<?xml version="1.0"?><D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype></D:prop></D:set></D:mkcol>`,
			cardDAV, http.StatusForbidden, "valid-resourcetype"},
		{"MKCOL outside the home set", "MKCOL", CalDavDefaultCalendarPath + "/nested", "", calDAV, http.StatusForbidden, "calendar-collection-location-ok"},
		{"MKCOL with an unknown body", "MKCOL", CalDavHomeSetPath + "/unknown", `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"/>`, calDAV, http.StatusUnsupportedMediaType, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := davTestRequest(test.handler, test.method, test.target, davTestXMLOnly, test.body)
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.want) {
				t.Fatalf("status = %d, want %d with %q; body = %s", response.Code, test.status, test.want, response.Body.String())
			}
			if propfind := davTestRequest(test.handler, "PROPFIND", test.target, map[string]string{"Depth": "0"}, ""); propfind.Code != http.StatusNotFound {
				t.Fatalf("failed request created the collection: PROPFIND status = %d", propfind.Code)
			}
		})
	}

	book := CardDavHomeSetPath + "/team"
	if response := davTestRequest(cardDAV, "MKCOL", book, davTestXMLOnly, davTestMkcolAddressBook); response.Code != http.StatusCreated {
		t.Fatalf("extended MKCOL: status = %d; body = %s", response.Code, response.Body.String())
	}
	if propfind := davTestRequest(cardDAV, "PROPFIND", book, map[string]string{"Depth": "0"}, "").Body.String(); !strings.Contains(propfind, ">Renamed<") || !strings.Contains(propfind, "<addressbook ") {
		t.Fatalf("PROPFIND new address book: %s", propfind)
	}
}
