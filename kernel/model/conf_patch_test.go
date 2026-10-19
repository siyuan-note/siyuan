package model

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestMergeConfSectionJSONFieldAndMapKeys(t *testing.T) {
	current := conf.NewAI()
	current.Decision.Profiles["typesafe"].APIKey = "keep-key"
	merged, err := MergeConfSectionJSON(current, []byte(`{"Decision":{"Profiles":{"typesafe":{"Timeout":45},"Typesafe":{"APIKey":"separate-key"}}}}`))
	if err != nil {
		t.Fatal(err)
	}
	var next conf.AI
	if err = json.Unmarshal(merged, &next); err != nil {
		t.Fatal(err)
	}
	profiles := next.Decision.Profiles
	if profiles["typesafe"].Timeout != 45 || profiles["typesafe"].APIKey != "keep-key" ||
		profiles["Typesafe"] == nil || profiles["Typesafe"].APIKey != "separate-key" {
		t.Fatalf("struct fields and dictionary keys did not retain their matching rules: %s", merged)
	}
}

func TestMergeConfSectionJSONFieldCaseDeterministic(t *testing.T) {
	for range 20 {
		merged, err := MergeConfSectionJSON(conf.NewEditor(), []byte(`{"BlockGutterMode":false,"blockGutterMode":true}`))
		if err != nil {
			t.Fatal(err)
		}
		var next conf.Editor
		if err = json.Unmarshal(merged, &next); err != nil || !next.BlockGutterMode {
			t.Fatalf("canonical field did not win consistently: %s (%v)", merged, err)
		}
	}
}

func TestMergeConfJSONKeepsExactKeys(t *testing.T) {
	// 没有结构体类型的通用合并只按精确键名匹配，由调用方决定是否需要大小写兼容。
	merged, err := MergeConfJSON([]byte(`{"openFile":"F1"}`), []byte(`{"openfile":"F2"}`))
	if err != nil {
		t.Fatal(err)
	}
	if string(merged) != `{"openFile":"F1","openfile":"F2"}` {
		t.Fatalf("untyped merge conflated independently named keys: %s", merged)
	}
}
