package apicontract

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type Route struct {
	Method  string `json:"method"`
	Path    string `json:"path"`
	Handler string `json:"handler"`
}

func (r Route) Key() string { return r.Method + " " + r.Path }

// ReadRoutes 读取实际路由及处理函数声明，防止契约与独立登记表各自漂移。
func ReadRoutes(apiDir string) ([]Route, map[string]string, error) {
	var routes []Route
	bindings := map[string]string{}
	endpointNames, err := readEndpointNames(filepath.Join(apiDir, "..", "apicontract", "contracts.go"))
	if err != nil {
		return nil, nil, err
	}
	entries, err := os.ReadDir(apiDir)
	if err != nil {
		return nil, nil, err
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".go" || len(entry.Name()) > 8 && entry.Name()[len(entry.Name())-8:] == "_test.go" {
			continue
		}
		file, parseErr := parser.ParseFile(token.NewFileSet(), filepath.Join(apiDir, entry.Name()), nil, 0)
		if parseErr != nil {
			return nil, nil, parseErr
		}
		ast.Inspect(file, func(node ast.Node) bool {
			if spec, ok := node.(*ast.ValueSpec); ok && len(spec.Names) == 1 && len(spec.Values) == 1 {
				if call, ok := spec.Values[0].(*ast.CallExpr); ok && len(call.Args) == 2 {
					if fun, ok := call.Fun.(*ast.Ident); ok && fun.Name == "contractHandler" {
						if endpoint, ok := call.Args[0].(*ast.SelectorExpr); ok {
							bindings[spec.Names[0].Name] = endpointNames[endpoint.Sel.Name]
						}
					}
				}
			}
			if entry.Name() != "router.go" {
				return true
			}
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			fun, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			server, ok := fun.X.(*ast.Ident)
			if !ok || server.Name != "ginServer" || fun.Sel.Name == "Use" {
				return true
			}
			methodValue := strings.ToUpper(fun.Sel.Name)
			pathIndex := 0
			if fun.Sel.Name == "Handle" {
				if len(call.Args) < 3 {
					err = fmt.Errorf("invalid Handle registration")
					return false
				}
				method, ok := call.Args[0].(*ast.BasicLit)
				if !ok {
					err = fmt.Errorf("API method must be literal")
					return false
				}
				methodValue, _ = strconv.Unquote(method.Value)
				pathIndex = 1
			} else if !strings.Contains("|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE|ANY|", "|"+methodValue+"|") {
				err = fmt.Errorf("unsupported router declaration: %s", fun.Sel.Name)
				return false
			}
			if len(call.Args) < pathIndex+2 {
				err = fmt.Errorf("invalid route registration")
				return false
			}
			path, pathOK := call.Args[pathIndex].(*ast.BasicLit)
			if !pathOK {
				err = fmt.Errorf("API route must use literal method and path")
				return false
			}
			pathValue, _ := strconv.Unquote(path.Value)
			handler := ""
			switch value := call.Args[len(call.Args)-1].(type) {
			case *ast.Ident:
				handler = value.Name
			case *ast.SelectorExpr:
				if pkg, ok := value.X.(*ast.Ident); ok {
					handler = pkg.Name + "." + value.Sel.Name
				}
			case *ast.FuncLit:
				handler = "inline"
			default:
				err = fmt.Errorf("unsupported API route handler: %s", pathValue)
			}
			routes = append(routes, Route{methodValue, pathValue, handler})
			return true
		})
	}
	sort.Slice(routes, func(i, j int) bool {
		if routes[i].Key() == routes[j].Key() {
			return routes[i].Handler < routes[j].Handler
		}
		return routes[i].Key() < routes[j].Key()
	})
	return routes, bindings, err
}

// CheckRoutes 要求每个实际路由都有契约或存量记录，已迁移路由必须绑定对应的类型适配器。
func CheckRoutes(routes []Route, bindings map[string]string, legacy []Route) error {
	typed := map[string]Definition{}
	for _, definition := range Definitions() {
		for _, method := range definition.Methods {
			typed[method+" "+definition.Path] = definition
		}
	}
	legacySet := map[string]Route{}
	for _, route := range legacy {
		if _, exists := legacySet[route.Key()]; exists {
			return fmt.Errorf("duplicate legacy route: %s", route.Key())
		}
		legacySet[route.Key()] = route
	}
	seen := map[string]bool{}
	for _, route := range routes {
		if definition, exists := typed[route.Key()]; exists {
			if seen[route.Key()] {
				return fmt.Errorf("duplicate typed route: %s", route.Key())
			}
			seen[route.Key()] = true
			if route.Handler != definition.Name || bindings[route.Handler] != definition.Name {
				return fmt.Errorf("typed handler missing or mismatched: %s", route.Key())
			}
			if _, exists := legacySet[route.Key()]; exists {
				return fmt.Errorf("migrated route remains in legacy list: %s", route.Key())
			}
		} else {
			previous, exists := legacySet[route.Key()]
			if !exists || previous.Handler != route.Handler {
				return fmt.Errorf("route needs a typed contract: %s (%s)", route.Key(), route.Handler)
			}
			seen[route.Key()] = true
		}
	}
	for key := range typed {
		if !seen[key] {
			return fmt.Errorf("contract has no route: %s", key)
		}
	}
	for key := range legacySet {
		if !seen[key] {
			return fmt.Errorf("removed route remains in legacy list: %s", key)
		}
	}
	return nil
}

func readEndpointNames(path string) (map[string]string, error) {
	file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	if err != nil {
		return nil, err
	}
	names := map[string]string{}
	ast.Inspect(file, func(node ast.Node) bool {
		spec, ok := node.(*ast.ValueSpec)
		if !ok || len(spec.Names) != 1 || len(spec.Values) != 1 {
			return true
		}
		call, ok := spec.Values[0].(*ast.CallExpr)
		if !ok || len(call.Args) == 0 {
			return true
		}
		generic, ok := call.Fun.(*ast.IndexListExpr)
		if !ok {
			return true
		}
		function, ok := generic.X.(*ast.Ident)
		if !ok || function.Name != "define" {
			return true
		}
		if name, ok := call.Args[0].(*ast.BasicLit); ok {
			names[spec.Names[0].Name], _ = strconv.Unquote(name.Value)
		}
		return true
	})
	return names, nil
}
