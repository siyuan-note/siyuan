package apicontract

import (
	"strings"
	"testing"
)

func TestReloadRequestCompatibility(t *testing.T) {
	for _, endpoint := range []Endpoint[EmptyRequest, Null]{ReloadTag, ReloadFiletree, ReloadUI, ReloadIcon, ReloadTheme} {
		for _, body := range []string{"", "{", "null", `{"ignored":true}`} {
			if _, err := endpoint.Decode(strings.NewReader(body)); err != nil {
				t.Errorf("bodyless reload rejected %q: %v", body, err)
			}
		}
	}
	for _, endpoint := range []Endpoint[BlockIDRequest, Null]{ReloadProtyle, ReloadAttributeView} {
		for _, id := range []string{"", "  document  "} {
			request, err := endpoint.Decode(strings.NewReader(`{"id":"` + id + `"}`))
			if err != nil || request.ID != id {
				t.Errorf("reload changed ID %q: %#v, %v", id, request, err)
			}
		}
		for _, body := range []string{"", "{", `{}`, `{"id":null}`, `{"id":42}`} {
			if _, err := endpoint.Decode(strings.NewReader(body)); err == nil {
				t.Errorf("reload accepted invalid ID: %s", body)
			}
		}
	}
}
