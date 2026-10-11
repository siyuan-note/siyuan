package apicontract

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
)

type Route struct {
	Method     string   `json:"method"`
	Path       string   `json:"path"`
	Handler    string   `json:"handler"`
	Middleware []string `json:"-"`
	Contract   string   `json:"-"`
}

func (r Route) Key() string { return r.Method + " " + r.Path }

// ExpandMethods 按路由器的 Any 注册行为展开实际 HTTP 方法。
func ExpandMethods(methods []string) []string {
	var result []string
	for _, method := range methods {
		if method == "ANY" {
			result = append(result, "GET", "POST", "PUT", "PATCH", "HEAD", "OPTIONS", "DELETE", "CONNECT", "TRACE")
		} else {
			result = append(result, method)
		}
	}
	return result
}

// ReadRoutes 读取实际路由及处理函数声明，防止契约与独立登记表各自漂移。
func ReadRoutes(apiDir string) ([]Route, map[string]string, error) {
	var routes []Route
	definitionsByName := map[string]Definition{}
	for _, definition := range Definitions() {
		definitionsByName[definition.Name] = definition
	}
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
				if call, ok := spec.Values[0].(*ast.CallExpr); ok && len(call.Args) >= 2 {
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
			var middleware []string
			contract := ""
			switch value := call.Args[len(call.Args)-1].(type) {
			case *ast.CallExpr:
				function, ok := value.Fun.(*ast.Ident)
				if !ok || function.Name != "contractRouteHandlers" || len(value.Args) != 2 ||
					len(call.Args) != pathIndex+2 || !call.Ellipsis.IsValid() {
					err = fmt.Errorf("unsupported API route handler: %s", pathValue)
					return false
				}
				endpoint, endpointOK := value.Args[0].(*ast.SelectorExpr)
				target, targetOK := value.Args[1].(*ast.Ident)
				if !endpointOK || !targetOK {
					err = fmt.Errorf("invalid contract route binding: %s", pathValue)
					return false
				}
				pkg, packageOK := endpoint.X.(*ast.Ident)
				if !packageOK || pkg.Name != "apicontract" {
					err = fmt.Errorf("route must bind a declared contract: %s", pathValue)
					return false
				}
				contract = endpointNames[endpoint.Sel.Name]
				definition, found := definitionsByName[contract]
				if !found || !definition.Authorization.Valid() {
					err = fmt.Errorf("invalid route authorization: %s", pathValue)
					return false
				}
				handler = target.Name
				middleware = definition.Authorization.MiddlewareNames()
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
			if contract == "" {
				for _, argument := range call.Args[pathIndex+1 : len(call.Args)-1] {
					selector, ok := argument.(*ast.SelectorExpr)
					if !ok {
						err = fmt.Errorf("unsupported route middleware: %s", pathValue)
						return false
					}
					pkg, ok := selector.X.(*ast.Ident)
					if !ok {
						err = fmt.Errorf("unsupported route middleware: %s", pathValue)
						return false
					}
					middleware = append(middleware, pkg.Name+"."+selector.Sel.Name)
				}
			}
			routes = append(routes, Route{Method: methodValue, Path: pathValue, Handler: handler, Middleware: middleware, Contract: contract})
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
		if !definition.Authorization.Valid() {
			return fmt.Errorf("contract needs explicit authorization: %s", definition.Name)
		}
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
			if route.Contract != "" && route.Contract != definition.Name ||
				!slices.Equal(route.Middleware, definition.Authorization.MiddlewareNames()) {
				return fmt.Errorf("route authorization missing or mismatched: %s", route.Key())
			}
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
		if name := endpointName(spec); name != "" {
			names[spec.Names[0].Name] = name
		}
		return true
	})
	return names, nil
}

func endpointName(spec *ast.ValueSpec) string {
	if len(spec.Names) != 1 || len(spec.Values) != 1 {
		return ""
	}
	call, ok := spec.Values[0].(*ast.CallExpr)
	if !ok || len(call.Args) == 0 {
		return ""
	}
	generic, ok := call.Fun.(*ast.IndexListExpr)
	if !ok {
		return ""
	}
	function, ok := generic.X.(*ast.Ident)
	if !ok || function.Name != "define" {
		return ""
	}
	name, ok := call.Args[0].(*ast.BasicLit)
	if !ok || name.Kind != token.STRING {
		return ""
	}
	value, _ := strconv.Unquote(name.Value)
	return value
}

// ReadEndpointDocumentation 读取契约声明的前置注释，按处理函数名称关联到生成的路由类型。
func ReadEndpointDocumentation(path string) (map[string]string, error) {
	file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ParseComments)
	if err != nil {
		return nil, err
	}
	documentation := map[string]string{}
	for _, declaration := range file.Decls {
		group, ok := declaration.(*ast.GenDecl)
		if !ok || group.Tok != token.VAR {
			continue
		}
		for _, item := range group.Specs {
			spec, ok := item.(*ast.ValueSpec)
			if !ok {
				continue
			}
			name := endpointName(spec)
			if name == "" {
				continue
			}
			comment := spec.Doc
			if comment == nil && !group.Lparen.IsValid() {
				comment = group.Doc
			}
			if comment != nil {
				text := strings.TrimSpace(comment.Text())
				documentation[name] = strings.TrimPrefix(text, spec.Names[0].Name+" ")
			}
		}
	}
	return documentation, nil
}
