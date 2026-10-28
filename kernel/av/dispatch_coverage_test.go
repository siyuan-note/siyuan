// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// 字段类型分派都是全枚举 switch：漏掉一种类型既不会编译失败，也不会被现有用例发现，
// 只会静默返回零值。本文件把「必须显式处理每种类型」写成断言，让遗漏变成失败。
//
// 期望集合全部从字段能力表推导，不在此处抄一份类型清单，避免新增类型时两处都要改。

// nonStoredKeyTypes 声明不落在 Value 上的字段类型。
// 行号是渲染期按段落序号生成的计算列，不参与取值、置值、判空和默认值分派。
var nonStoredKeyTypes = []KeyType{KeyTypeLineNumber}

// typeDispatch 描述一个必须逐类型分支的函数，以及它应覆盖的类型集合。
type typeDispatch struct {
	file     string
	function string
	expect   []KeyType
	reason   string
}

func TestTypeDispatchCoversDeclaredCases(t *testing.T) {
	stored := keyTypesWithout(nonStoredKeyTypes...)
	sortable := keyTypesWhere(func(capability KeyCapability) bool { return capability.Sortable })
	filterable := keyTypesWhere(func(capability KeyCapability) bool { return capability.Filterable })
	// 汇总值在 Value.Filter 中先解包成目标类型的值再比较，不会以 Rollup 身份进入 filter。
	filterableValues := keyTypesExcept(filterable, KeyTypeRollup)
	// 生成字段与行号在 GetAffectValue 开头按能力分组提前返回，不参与默认值构造。
	filterDefaults := keyTypesWhere(func(capability KeyCapability) bool {
		return capability.Filterable && capability.Groups&KeyGroupNoFilterDefault == 0
	})

	dispatches := []typeDispatch{
		{"value.go", "String", stored, "每种存储值都必须有文本表示"},
		{"value.go", "isEmpty", stored, "每种存储值都必须能判断空值与空白"},
		{"value.go", "SetValByType", stored, "每种存储值都必须能按类型写入"},
		{"value.go", "GetValByType", stored, "每种存储值都必须能按类型读取"},
		{"value.go", "GetAttributeViewDefaultValue", stored, "每种存储值都必须有默认值构造"},
		{"calc.go", "calcField", sortable, "不可排序的字段不参与汇总"},
		{"sort.go", "compare", sortable, "每种可排序字段都必须能比较"},
		{"filter.go", "filter", filterableValues, "每种可筛选字段都必须能比较取值"},
		{"filter.go", "GetAffectValue", filterDefaults, "可筛选且非生成字段才构造筛选默认值"},
	}

	files := avPackageFiles(t)
	values := keyTypeConstantValues(t, files)
	for _, dispatch := range dispatches {
		t.Run(dispatch.file+":"+dispatch.function, func(t *testing.T) {
			actual := keyTypeCaseValues(t, files, values, dispatch.file, dispatch.function)
			expect := make([]string, 0, len(dispatch.expect))
			for _, typ := range dispatch.expect {
				expect = append(expect, string(typ))
			}
			sort.Strings(expect)
			if missing := difference(expect, actual); 0 < len(missing) {
				t.Fatalf("%s 未处理 %s：%s", dispatch.reason, dispatch.function, strings.Join(missing, ", "))
			}
			if extra := difference(actual, expect); 0 < len(extra) {
				t.Fatalf("%s 不应处理 %s：%s", dispatch.reason, dispatch.function, strings.Join(extra, ", "))
			}
		})
	}
}

// keyTypesWithout 返回除排除项外的全部声明类型，保持声明顺序。
func keyTypesWithout(excluded ...KeyType) []KeyType {
	return keyTypesExcept(KeyTypes(), excluded...)
}

func keyTypesExcept(all []KeyType, excluded ...KeyType) []KeyType {
	skip := map[KeyType]bool{}
	for _, typ := range excluded {
		skip[typ] = true
	}
	ret := make([]KeyType, 0, len(all))
	for _, typ := range all {
		if !skip[typ] {
			ret = append(ret, typ)
		}
	}
	return ret
}

func keyTypesWhere(match func(capability KeyCapability) bool) []KeyType {
	var ret []KeyType
	for _, typ := range KeyTypes() {
		if match(GetKeyCapability(typ)) {
			ret = append(ret, typ)
		}
	}
	return ret
}

// avPackageFiles 解析 av 包的非测试源码，供分派断言复用。
func avPackageFiles(t *testing.T) map[string]*ast.File {
	t.Helper()
	packages, err := parser.ParseDir(token.NewFileSet(), ".", func(file os.FileInfo) bool {
		return !strings.HasSuffix(file.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]*ast.File{}
	for name, file := range packages["av"].Files {
		files[filepath.Base(name)] = file
	}
	return files
}

// keyTypeConstantValues 建立字段类型常量标识符到协议值的映射，用于把 AST 分支换算成能力表取值。
func keyTypeConstantValues(t *testing.T, files map[string]*ast.File) map[string]string {
	t.Helper()
	values := map[string]string{}
	for _, file := range files {
		for _, declaration := range file.Decls {
			group, ok := declaration.(*ast.GenDecl)
			if !ok || token.CONST != group.Tok {
				continue
			}
			for _, spec := range group.Specs {
				value := spec.(*ast.ValueSpec)
				if 1 != len(value.Names) || 1 != len(value.Values) {
					continue
				}
				if !strings.HasPrefix(value.Names[0].Name, "KeyType") {
					continue
				}
				literal, ok := value.Values[0].(*ast.BasicLit)
				if !ok || token.STRING != literal.Kind {
					t.Fatalf("字段类型常量 %s 必须声明字面量协议值", value.Names[0].Name)
				}
				text, err := strconv.Unquote(literal.Value)
				if err != nil {
					t.Fatal(err)
				}
				values[value.Names[0].Name] = text
			}
		}
	}
	if len(values) != len(KeyTypes()) {
		t.Fatalf("字段类型常量数量 %d 与能力表 %d 不一致", len(values), len(KeyTypes()))
	}
	return values
}

// keyTypeCaseValues 返回函数体内所有 case 分支出现的字段类型协议值，去重后排序。
func keyTypeCaseValues(t *testing.T, files map[string]*ast.File, values map[string]string, fileName, funcName string) []string {
	t.Helper()
	file, found := files[fileName]
	if !found {
		t.Fatalf("源文件 %s 不存在", fileName)
	}
	var body *ast.BlockStmt
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Name.Name != funcName || nil == function.Body {
			continue
		}
		body = function.Body
		break
	}
	if nil == body {
		t.Fatalf("函数 %s 不在 %s 中", funcName, fileName)
	}

	names := map[string]bool{}
	ast.Inspect(body, func(node ast.Node) bool {
		clause, ok := node.(*ast.CaseClause)
		if !ok {
			return true
		}
		for _, expression := range clause.List {
			if name := keyTypeConstantName(expression); "" != name {
				names[name] = true
			}
		}
		return true
	})
	ret := make([]string, 0, len(names))
	for name := range names {
		value, found := values[name]
		if !found {
			t.Fatalf("%s 使用了未声明协议值的常量 %s", funcName, name)
		}
		ret = append(ret, value)
	}
	sort.Strings(ret)
	return ret
}

// keyTypeConstantName 只接受本包的字段类型常量标识符，忽略其他分支条件。
func keyTypeConstantName(expression ast.Expr) string {
	switch value := expression.(type) {
	case *ast.Ident:
		if strings.HasPrefix(value.Name, "KeyType") {
			return value.Name
		}
	case *ast.SelectorExpr:
		if strings.HasPrefix(value.Sel.Name, "KeyType") {
			return value.Sel.Name
		}
	}
	return ""
}

// difference 返回 left 中不在 right 里的元素，两者均需已排序。
func difference(left, right []string) []string {
	present := map[string]bool{}
	for _, item := range right {
		present[item] = true
	}
	var ret []string
	for _, item := range left {
		if !present[item] {
			ret = append(ret, item)
		}
	}
	return ret
}
