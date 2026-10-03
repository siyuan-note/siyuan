package api

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

// 已分类的操作提示不得改回全局广播；网络安装、上传的结果仍由各自功能测试覆盖。
func TestOperationNotificationScopeCallsites(t *testing.T) {
	for file, names := range map[string][]string{
		"asset.go": {"getUnusedAssets", "uploadCloud", "uploadCloudByAssetsPaths"},
		"av.go":    {"getUnusedAttributeViews"},
		"bazaar.go": {"updateBazaarPackage", "installBazaarPlugin", "installBazaarWidget",
			"installBazaarIcon", "installBazaarTemplate", "installBazaarTheme"},
	} {
		parsed, err := parser.ParseFile(token.NewFileSet(), file, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, name := range names {
			t.Run(name, func(t *testing.T) {
				var handler ast.Node
				ast.Inspect(parsed, func(node ast.Node) bool {
					value, ok := node.(*ast.ValueSpec)
					if ok && len(value.Names) == 1 && value.Names[0].Name == name && len(value.Values) == 1 {
						handler = value.Values[0]
						return false
					}
					return true
				})
				if handler == nil {
					t.Fatal("notification handler was not found")
				}
				scoped := false
				ast.Inspect(handler, func(node ast.Node) bool {
					call, ok := node.(*ast.CallExpr)
					if !ok {
						return true
					}
					selector, ok := call.Fun.(*ast.SelectorExpr)
					if !ok {
						return true
					}
					pkg, ok := selector.X.(*ast.Ident)
					if !ok || pkg.Name != "util" {
						return true
					}
					switch selector.Sel.Name {
					case "PushMsg", "PushErrMsg", "PushUpdateMsg", "PushClearMsg":
						t.Errorf("operation notification uses global %s", selector.Sel.Name)
					case "PushMsgWithApp":
						scoped = true
					}
					return true
				})
				if !scoped {
					t.Fatal("operation completion must use scoped notification")
				}
			})
		}
	}
}
