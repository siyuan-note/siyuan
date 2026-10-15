package apicontract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestContractEndpointDocumentation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "contracts.go")
	source := `package apicontract

// 独立接口说明。
//
// 第二段包含字面量 */。
var Single = define[EmptyRequest, Null]("singleHandler", "/single")

// 分组说明不属于任何一个接口。
var (
    // 分组内第一个接口。
    First = define[EmptyRequest, Null]("firstHandler", "/first")
    Second = define[EmptyRequest, Null]("secondHandler", "/second")
    // 普通变量不属于契约。
    Other = unrelated("other")
)

// Third 第三个接口说明。
var Third = define[EmptyRequest, Null]("thirdHandler", "/third")

func local() {
    // 局部声明不属于公开契约。
    var Local = define[EmptyRequest, Null]("localHandler", "/local")
}
`
	if err := os.WriteFile(path, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	documentation, err := ReadEndpointDocumentation(path)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"singleHandler": "独立接口说明。\n\n第二段包含字面量 */。",
		"firstHandler":  "分组内第一个接口。",
		"thirdHandler":  "第三个接口说明。",
	}
	if len(documentation) != len(want) {
		t.Fatalf("unexpected documentation: %#v", documentation)
	}
	for name, text := range want {
		if documentation[name] != text {
			t.Fatalf("%s documentation: got %q, want %q", name, documentation[name], text)
		}
	}

	request := &Schema{Type: "object"}
	response := &Schema{Type: "null"}
	bundle := &Bundle{Endpoints: []EndpointSchema{
		{Method: "GET", Path: "/single", Handler: "singleHandler", Request: request, Response: response},
		{Method: "POST", Path: "/single", Handler: "singleHandler", Request: request, Response: response},
		{Method: "POST", Path: "/first", Handler: "firstHandler", Request: request, Response: response},
		{Method: "POST", Path: "/second", Handler: "secondHandler", Request: request, Response: response},
	}}
	generated := string(bundle.TypeScript(nil, documentation))
	single := "    /**\n     * 独立接口说明。\n     *\n     * 第二段包含字面量 *\\/。\n     */\n"
	first := "    /**\n     * 分组内第一个接口。\n     */\n"
	if strings.Count(generated, single+`    "/single": {`) != 2 ||
		!strings.Contains(generated, first+`    "/first": {`) {
		t.Fatal("endpoint documentation missing or attached to the wrong route")
	}
	withoutDocumentation := strings.ReplaceAll(strings.ReplaceAll(generated, single, ""), first, "")
	if withoutDocumentation != string(bundle.TypeScript(nil, nil)) {
		t.Fatal("documentation changed the generated type declarations")
	}
}
