package plugin

import "github.com/fastschema/qjs"

func injectSandboxGlobals(p *KernelPlugin) error { return nil }

var _ = (*qjs.Value)(nil) // keep import
