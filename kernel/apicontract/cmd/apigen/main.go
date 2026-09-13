package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

func main() {
	check := flag.Bool("check", false, "check generated artifacts without writing")
	root := flag.String("root", "..", "repository root")
	petal := flag.String("petal", "", "optional petal repository to synchronize or check")
	base := flag.String("base", "", "base git revision for the legacy coverage ratchet")
	flag.Parse()
	if err := run(*root, *petal, *base, *check); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(root, petal, base string, check bool) error {
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		return err
	}
	routes, bindings, err := apicontract.ReadRoutes(filepath.Join(root, "kernel", "api"))
	if err != nil {
		return err
	}
	legacyPath := filepath.Join(root, "kernel", "apicontract", "legacy_routes.json")
	data, err := os.ReadFile(legacyPath)
	if err != nil {
		return err
	}
	var legacy []apicontract.Route
	if err = json.Unmarshal(data, &legacy); err != nil {
		return err
	}
	if err = apicontract.CheckRoutes(routes, bindings, legacy); err != nil {
		return err
	}
	if base != "" {
		command := exec.Command("git", "show", base+":kernel/apicontract/legacy_routes.json")
		command.Dir = root
		previous, readErr := command.Output()
		if readErr != nil {
			// 首次建立契约时基线文件尚不存在；其他 git 错误仍然中止校验。
			probe := exec.Command("git", "ls-tree", base, "kernel/apicontract/legacy_routes.json")
			probe.Dir = root
			listing, probeErr := probe.Output()
			if probeErr != nil || len(listing) != 0 {
				return fmt.Errorf("cannot read legacy coverage baseline: %w", readErr)
			}
		} else {
			var baseline []apicontract.Route
			if err = json.Unmarshal(previous, &baseline); err != nil {
				return err
			}
			allowed := map[string]bool{}
			for _, route := range baseline {
				allowed[route.Key()] = true
			}
			for _, route := range legacy {
				if !allowed[route.Key()] {
					return fmt.Errorf("legacy coverage may not grow: %s", route.Key())
				}
			}
		}
	}
	jsonData, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return err
	}
	artifacts := map[string][]byte{
		filepath.Join(root, "app", "src", "types", "api", "index.d.ts"): bundle.TypeScript(legacy),
		filepath.Join(root, "kernel", "apicontract", "schema.json"):     append(jsonData, '\n'),
	}
	if petal != "" {
		artifacts[filepath.Join(petal, "types", "api", "index.d.ts")] = bundle.TypeScript(legacy)
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
