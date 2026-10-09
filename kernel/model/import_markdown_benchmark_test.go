package model

import (
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/shirou/gopsutil/v4/process"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// BenchmarkMarkdownImportWorkingSet 对照保留全部树与加密暂存的工作集，不启动内核或访问用户工作空间。
func BenchmarkMarkdownImportWorkingSet(b *testing.B) {
	originalConf, originalTemp := Conf, util.TempDir
	Conf = NewAppConf()
	Conf.Editor, Conf.Export = conf.NewEditor(), conf.NewExport()
	util.TempDir = b.TempDir()
	b.Cleanup(func() { Conf, util.TempDir = originalConf, originalTemp })
	markdown := "# Heading\n\n" + strings.Repeat("Paragraph with **bold**, *emphasis*, [a link](https://example.com) and `code`.\n\n", 540)
	proc, err := process.NewProcess(int32(os.Getpid()))
	if err != nil {
		b.Fatal(err)
	}
	for _, count := range []int{100, 400} {
		for _, staged := range []bool{false, true} {
			mode := "retained"
			if staged {
				mode = "staged"
			}
			b.Run(fmt.Sprintf("%s/%d", mode, count), func(b *testing.B) {
				debug.FreeOSMemory()
				initial, err := proc.MemoryInfo()
				if err != nil {
					b.Fatal(err)
				}
				peakRSS := initial.RSS
				sample := func() {
					memory, err := proc.MemoryInfo()
					if err != nil {
						b.Fatal(err)
					}
					peakRSS = max(peakRSS, memory.RSS)
				}
				b.ResetTimer()
				for iteration := 0; iteration < b.N; iteration++ {
					var trees []*parse.Tree
					var spool *markdownImportSpool
					links := map[string]string{}
					if staged {
						spool, err = newMarkdownImportSpool()
						if err != nil {
							b.Fatal(err)
						}
					}
					for i := range count {
						tree, _, _, _ := parseStdMd([]byte(markdown), true)
						id := ast.NewNodeID()
						reassignIDUpdated(tree, id, "")
						tree.Box, tree.Path, tree.HPath = "20261010000000-bench01", "/"+id+".sy", fmt.Sprintf("/document-%d", i)
						tree.Root.Spec = treenode.CurrentSpec
						if staged {
							if err := spool.add(tree); err != nil {
								b.Fatal(err)
							}
						} else {
							trees = append(trees, tree)
							addImportSearchLinks(tree, links)
						}
						if (i+1)%markdownImportBatchDocuments == 0 {
							sample()
							if staged {
								debug.FreeOSMemory()
							}
						}
					}
					if staged {
						var pending []*parse.Tree
						if err := spool.finish(func(tree *parse.Tree) error {
							pending = append(pending, tree)
							return nil
						}, func() {
							sample()
							pending = nil
							debug.FreeOSMemory()
						}); err != nil {
							b.Fatal(err)
						}
						spool.close()
					} else {
						engine := NewLute()
						engine.SetHTMLTag2TextMark(true)
						for _, tree := range trees {
							convertMdHyperlinks2WikiLinks(tree)
							convertWikiLinksAndTags(tree, links)
							mergeTextAndHandlerNestedInlines(tree, engine)
						}
						sample()
						runtime.KeepAlive(trees)
					}
				}
				b.ReportMetric(float64(peakRSS)/(1024*1024), "peak-RSS-MiB")
				b.ReportMetric(float64(count*len(markdown))/(1024*1024), "input-MiB")
			})
		}
	}
}
