// 本文件移植自 https://github.com/grafana/sobek-webapi-encoding 的 encoding/test_setup_test.go（提交 5785852a34），
// 按 Apache License 2.0 使用，许可证全文见同目录 LICENSE。
// 修改：以 github.com/dop251/goja 替换 github.com/grafana/sobek，去掉加载 WPT 测试框架与夹具的部分。

package encoding

import (
	"testing"

	"github.com/dop251/goja"
)

// testSetup wraps a goja runtime configured with the encoding Web API.
type testSetup struct {
	rt *goja.Runtime
}

func newTestSetup(t testing.TB) *testSetup {
	t.Helper()

	rt := goja.New()
	rt.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))

	mustNoError(t, RegisterRuntime(rt))

	return &testSetup{rt: rt}
}

func mustNoError(t testing.TB, err error) {
	t.Helper()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func mustError(t testing.TB, err error) {
	t.Helper()

	if err == nil {
		t.Fatal("expected error")
	}
}

func mustEqual[T comparable](t testing.TB, expected, actual T) {
	t.Helper()

	if expected != actual {
		t.Fatalf("expected %#v, got %#v", expected, actual)
	}
}
