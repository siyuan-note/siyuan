package plugin

import (
	"encoding/json"
	"testing"

	"github.com/dop251/goja"
)

func TestGoValueToJsValue_String(t *testing.T) {
	rt := goja.New()
	v, err := goValueToJsValue(rt, "hello")
	if err != nil {
		t.Fatal(err)
	}
	if v.String() != "hello" {
		t.Fatalf("expected 'hello', got %q", v.String())
	}
}

func TestGoValueToJsValue_Int(t *testing.T) {
	rt := goja.New()
	v, err := goValueToJsValue(rt, 42)
	if err != nil {
		t.Fatal(err)
	}
	if v.ToInteger() != 42 {
		t.Fatalf("expected 42, got %d", v.ToInteger())
	}
	// Must be a JS number, not a JS object
	if _, ok := v.(*goja.Object); ok {
		t.Fatal("expected number value, got object")
	}
}

func TestGoValueToJsValue_LargeInt64(t *testing.T) {
	rt := goja.New()
	// SiYuan block ID style value — fits in int64, must round-trip correctly
	const id = int64(20060102150405)
	v, err := goValueToJsValue(rt, map[string]any{"id": id})
	if err != nil {
		t.Fatal(err)
	}
	obj, ok := v.(*goja.Object)
	if !ok {
		t.Fatalf("expected *goja.Object, got %T", v)
	}
	idVal := obj.Get("id")
	if idVal.ToInteger() != id {
		t.Fatalf("expected %d, got %d", id, idVal.ToInteger())
	}
}

func TestGoValueToJsValue_Null(t *testing.T) {
	rt := goja.New()
	v, err := goValueToJsValue(rt, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !goja.IsNull(v) {
		t.Fatalf("expected null, got %v", v)
	}
}

func TestGoValueToJsValue_Array(t *testing.T) {
	rt := goja.New()
	v, err := goValueToJsValue(rt, []string{"a", "b"})
	if err != nil {
		t.Fatal(err)
	}
	obj, ok := v.(*goja.Object)
	if !ok {
		t.Fatal("expected object")
	}
	if obj.ClassName() != "Array" {
		t.Fatalf("expected Array, got %q", obj.ClassName())
	}
}

func TestConvertJsonNumbers_Int64(t *testing.T) {
	n := json.Number("12345")
	result := convertJsonNumbers(n)
	if v, ok := result.(int64); !ok || v != 12345 {
		t.Fatalf("expected int64(12345), got %T(%v)", result, result)
	}
}

func TestConvertJsonNumbers_Float64(t *testing.T) {
	n := json.Number("3.14")
	result := convertJsonNumbers(n)
	if v, ok := result.(float64); !ok || v != 3.14 {
		t.Fatalf("expected float64(3.14), got %T(%v)", result, result)
	}
}

func TestConvertJsonNumbers_Nested(t *testing.T) {
	input := map[string]any{
		"count": json.Number("7"),
		"items": []any{json.Number("1"), json.Number("2")},
	}
	result, ok := convertJsonNumbers(input).(map[string]any)
	if !ok {
		t.Fatalf("expected map[string]any, got %T", convertJsonNumbers(input))
	}
	if result["count"] != int64(7) {
		t.Fatalf("expected int64(7), got %T(%v)", result["count"], result["count"])
	}
	items, ok := result["items"].([]any)
	if !ok {
		t.Fatalf("expected []any, got %T", result["items"])
	}
	if items[0] != int64(1) || items[1] != int64(2) {
		t.Fatalf("unexpected items: %v", items)
	}
}
