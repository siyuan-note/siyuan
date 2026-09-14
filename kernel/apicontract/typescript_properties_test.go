package apicontract

import "testing"

func TestTypeScriptKeepsPropertiesWithJSONExtensions(t *testing.T) {
	bundle := &Bundle{}
	schema := &Schema{
		Type: "object",
		Properties: map[string]*Schema{
			"code":  {Type: "number"},
			"msg":   {Type: "string"},
			"token": {Type: "string"},
		},
		Required:             []string{"code", "msg"},
		AdditionalProperties: &Schema{Ref: "#/$defs/JSONValue"},
	}
	want := `({ "code": number; "msg": string; "token"?: string; } & { [key: string]: JSONValue })`
	if got := bundle.typeScript(schema); got != want {
		t.Fatalf("fixed fields or extension values changed: %s", got)
	}
	schema.Properties = nil
	if got := bundle.typeScript(schema); got != "{ [key: string]: JSONValue }" {
		t.Fatalf("plain JSON map changed: %s", got)
	}
}
