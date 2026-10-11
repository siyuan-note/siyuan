package api

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

// settingWriteExemptions 登记命名约定上像写配置、但不写入应用配置或按事务单独处理的端点，必须注明原因。
var settingWriteExemptions = map[string]string{
	"/api/setting/getBootAppearances":          "只读",
	"/api/setting/getCloudUser":                "读取账号信息，缓存的用户数据由账号流程维护",
	"/api/setting/getPandocBin":                "只读",
	"/api/setting/getPublish":                  "只读",
	"/api/setting/logoutCloudUser":             "账号登出，用户数据不属于设置项",
	"/api/setting/login2faCloudUser":           "账号登录，用户数据不属于设置项",
	"/api/setting/refreshVirtualBlockRef":      "仅刷新运行时缓存",
	"/api/system/setWorkspaceDir":              "写入全局工作空间列表，不属于工作空间配置",
	"/api/system/importCustomFont":             "写入字体资源文件，不修改配置",
	"/api/system/importTLSCABundle":            "写入证书文件，不修改配置",
	"/api/system/addCustomEmoji":               "写入表情资源文件，不修改配置",
	"/api/system/removeWorkspaceDir":           "写入全局工作空间列表，不属于工作空间配置",
	"/api/system/removeWorkspaceDirPhysically": "删除工作空间目录，不修改当前配置",
	"/api/repo/setSnapshotMemo":                "写入快照备注，不修改配置",
	"/api/repo/importRepoKey":                  "数据仓库密钥事务，由密钥流程自行持久化和广播",
	"/api/repo/initRepoKey":                    "数据仓库密钥事务，由密钥流程自行持久化和广播",
	"/api/repo/initRepoKeyFromPassphrase":      "数据仓库密钥事务，由密钥流程自行持久化和广播",
	"/api/repo/resetRepo":                      "数据仓库重置事务，由仓库流程自行持久化和广播",
	"/api/repo/removeRepoTagSnapshot":          "删除快照标签，不修改配置",
	"/api/repo/removeCloudRepoTagSnapshot":     "删除云端快照标签，不修改配置",
	"/api/system/clearTempFiles":               "清理临时文件，不修改配置",
}

// 写配置端点的命名约定：这些前缀下以写入动词开头的端点默认视为写配置。
var settingWritePathPattern = regexp.MustCompile(`^/api/(setting|system|sync|repo|graph|storage)/(set|reset|import|clear|patch|add|remove|init|confirm)[A-Z0-9]`)

// 处理器中直接写配置的语句。
var directSettingWritePattern = regexp.MustCompile(`model\.Conf\.Save\(\)|model\.Update[A-Za-z]+Conf\(|model\.Conf\.(SetAI|SetOIDC|SetMCPOAuth|CompareAndSetOIDC|SaveGraphQueryConf|SetUILayout)\(|model\.Conf\.[A-Z][A-Za-z.]*\s*=[^=]`)

// I5：每个写配置端点都在契约中声明命名空间，由 contractHandler 统一持锁和通知。
func TestSettingWriteEndpointsAreDeclared(t *testing.T) {
	definitions := map[string]apicontract.Definition{}
	for _, definition := range apicontract.Definitions() {
		definitions[definition.Path] = definition
	}
	for path, definition := range definitions {
		if !settingWritePathPattern.MatchString(path) {
			continue
		}
		if _, exempt := settingWriteExemptions[path]; exempt {
			if definition.Setting.Declared() {
				t.Errorf("%s is both exempted and declared", path)
			}
			continue
		}
		if !definition.Setting.Declared() {
			t.Errorf("%s writes settings by naming convention but declares no setting namespace", path)
		}
	}
	for path := range settingWriteExemptions {
		if _, ok := definitions[path]; !ok {
			t.Errorf("exempted endpoint %s no longer exists", path)
		}
	}

	paths := contractVarPaths(t)
	fset := token.NewFileSet()
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		source, _ := os.ReadFile(name)
		funcs := map[string]string{}
		for _, decl := range file.Decls {
			if fn, ok := decl.(*ast.FuncDecl); ok && fn.Recv == nil {
				funcs[fn.Name.Name] = string(source[fset.Position(fn.Pos()).Offset:fset.Position(fn.End()).Offset])
			}
		}
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || len(call.Args) < 2 {
				return true
			}
			if ident, ok := call.Fun.(*ast.Ident); !ok || ident.Name != "contractHandler" {
				return true
			}
			selector, ok := call.Args[0].(*ast.SelectorExpr)
			if !ok {
				return true
			}
			body := string(source[fset.Position(call.Args[1].Pos()).Offset:fset.Position(call.Args[1].End()).Offset])
			if ident, ok := call.Args[1].(*ast.Ident); ok {
				body = funcs[ident.Name]
			}
			// 展开同文件中被直接调用的辅助函数一层
			expanded := body
			for fn, fnBody := range funcs {
				if strings.Contains(body, fn+"(") {
					expanded += fnBody
				}
			}
			path := paths[selector.Sel.Name]
			definition := definitions[path]
			if directSettingWritePattern.MatchString(expanded) && !definition.Setting.Declared() {
				t.Errorf("%s (%s) writes configuration directly but declares no setting namespace", path, name)
			}
			if definition.Setting.Declared() && definition.Setting.Mode != apicontract.SettingSelfManaged &&
				strings.Contains(expanded, "settingMutationMu.Lock()") {
				t.Errorf("%s locks the setting mutex itself; declare SettingSelfManaged instead", path)
			}
			return true
		})
	}
}

// contractVarPaths 从契约源码中解析变量名与路径的对应关系。
func contractVarPaths(t *testing.T) map[string]string {
	t.Helper()
	ret := map[string]string{}
	files, err := filepath.Glob(filepath.Join("..", "apicontract", "*.go"))
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`(?m)^\s*(?:var\s+)?([A-Z][A-Za-z0-9]*)\s*=\s*define\[[^\n]*?\("[^"]+",\s*"([^"]+)"`)
	for _, name := range files {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range pattern.FindAllStringSubmatch(string(data), -1) {
			ret[match[1]] = match[2]
		}
	}
	return ret
}
