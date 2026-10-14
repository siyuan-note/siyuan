package apicontract

import (
	"reflect"
	"testing"
)

func TestAuthorizationContracts(t *testing.T) {
	for _, invalid := range []Authorization{0, AdminAccess, WritableAccess, PublicAccess | AuthenticatedAccess, 128} {
		if invalid.Valid() {
			t.Fatalf("invalid policy accepted: %d", invalid)
		}
	}
	for _, valid := range []Authorization{PublicAccess, AuthenticatedAccess, AuthenticatedAccess | AdminAccess,
		AuthenticatedAccess | WritableAccess, AuthenticatedAccess | AdminAccess | WritableAccess} {
		if !valid.Valid() {
			t.Fatalf("valid policy rejected: %d", valid)
		}
	}
	expected := map[string]Authorization{
		"/api/system/version":          PublicAccess,
		"/oauth/mcp/token":             PublicAccess,
		"/api/block/getBlockDOM":       AuthenticatedAccess,
		"/api/av/changeAttrViewLayout": AuthenticatedAccess | AdminAccess | WritableAccess,
		"/api/network/forwardProxy":    AuthenticatedAccess | AdminAccess,
	}
	for _, definition := range Definitions() {
		if !definition.Authorization.Valid() {
			t.Errorf("missing authorization: %s", definition.Name)
		}
		if policy, found := expected[definition.Path]; found {
			if definition.Authorization != policy {
				t.Errorf("policy changed for %s: got %d want %d", definition.Path, definition.Authorization, policy)
			}
			delete(expected, definition.Path)
		}
	}
	if len(expected) != 0 {
		t.Fatalf("representative contracts absent: %v", expected)
	}
	if names := (AuthenticatedAccess | AdminAccess | WritableAccess).MiddlewareNames(); !reflect.DeepEqual(names, []string{"model.CheckAuth", "model.CheckAdminRole", "model.CheckReadonly"}) {
		t.Fatalf("middleware order changed: %v", names)
	}
}

func TestRouteAuthorizationCoverage(t *testing.T) {
	routes, bindings, err := ReadRoutes("../api")
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range routes {
		if route.Path != "/api/av/changeAttrViewLayout" {
			continue
		}
		for _, mutation := range []func(*Route){
			func(route *Route) { route.Middleware = []string{"model.CheckAuth", "model.CheckAdminRole"} },
			func(route *Route) {
				route.Middleware = []string{"model.CheckAdminRole", "model.CheckAuth", "model.CheckReadonly"}
			},
			func(route *Route) { route.Contract = "version" },
		} {
			changed := append([]Route(nil), routes...)
			for index := range changed {
				if changed[index].Key() == route.Key() {
					mutation(&changed[index])
				}
			}
			if err := CheckRoutes(changed, bindings, nil); err == nil {
				t.Fatal("missing or mismatched authorization was accepted")
			}
		}
		return
	}
	t.Fatal("write route absent")
}
