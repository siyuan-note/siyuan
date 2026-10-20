package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func main() {
	check := flag.Bool("check", false, "check generated artifacts without writing")
	root := flag.String("root", "..", "repository root")
	petal := flag.String("petal", "", "optional petal repository to synchronize or check")
	flag.Parse()
	if err := run(*root, *petal, *check); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(root, petal string, check bool) error {
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		return err
	}
	documentation, err := apicontract.ReadEndpointDocumentation(filepath.Join(root, "kernel", "apicontract", "contracts.go"))
	if err != nil {
		return err
	}
	routes, bindings, err := apicontract.ReadRoutes(filepath.Join(root, "kernel", "api"))
	if err != nil {
		return err
	}
	if err = apicontract.CheckRoutes(routes, bindings); err != nil {
		return err
	}
	jsonData, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return err
	}
	artifacts := map[string][]byte{
		filepath.Join(root, "app", "src", "types", "api", "index.d.ts"): bundle.TypeScript(documentation),
		filepath.Join(root, "kernel", "apicontract", "schema.json"):     append(jsonData, '\n'),
	}
	capabilityRuntime, capabilityTypes := av.CapabilityTypeScript()
	artifacts[filepath.Join(root, "app", "src", "protyle", "render", "av", "capabilities.generated.ts")] = capabilityRuntime
	artifacts[filepath.Join(root, "app", "src", "types", "av", "index.d.ts")] = capabilityTypes
	if petal != "" {
		artifacts[filepath.Join(petal, "types", "api", "index.d.ts")] = bundle.TypeScript(documentation)
		artifacts[filepath.Join(petal, "types", "av", "index.d.ts")] = capabilityTypes
	}
	var paths []string
	for path := range artifacts {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		if check {
			current, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if !bytes.Equal(bytes.ReplaceAll(current, []byte("\r\n"), []byte("\n")), artifacts[path]) {
				return fmt.Errorf("generated API contract is out of date: %s", path)
			}
		} else {
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				return err
			}
			if err := os.WriteFile(path, artifacts[path], 0644); err != nil {
				return err
			}
		}
	}
	fmt.Printf("API contracts: %d typed method/path pairs checked\n", len(bundle.Endpoints))
	return nil
}
