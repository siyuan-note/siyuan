package av

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 索引只保存数据库 ID，不保留加密笔记本的规则、属性或正文。同步清理缓存后重新发现规则。
var collectionIndex = struct {
	sync.Mutex
	directory  string
	generation uint64
	boxes      map[string]map[string]bool
	loaded     map[string]bool
}{boxes: map[string]map[string]bool{}, loaded: map[string]bool{}}

func resetCollectionIndexLocked() {
	generation := cache.GetAVCacheGeneration()
	if collectionIndex.directory != util.DataDir || collectionIndex.generation != generation {
		collectionIndex.directory, collectionIndex.generation = util.DataDir, generation
		collectionIndex.boxes, collectionIndex.loaded = map[string]map[string]bool{}, map[string]bool{}
	}
}

func hasBlockCollection(config *AutomationConfig) bool {
	if config != nil {
		for _, rule := range config.Rules {
			if rule != nil && rule.Enabled && rule.Trigger == "block" {
				return true
			}
		}
	}
	return false
}

func rememberCollectionView(view *AttributeView, boxID string) {
	collectionIndex.Lock()
	defer collectionIndex.Unlock()
	resetCollectionIndexLocked()
	if collectionIndex.boxes[boxID] == nil {
		collectionIndex.boxes[boxID] = map[string]bool{}
	}
	collectionIndex.boxes[boxID][view.ID] = hasBlockCollection(view.Automations)
}

// BlockCollectionViewIDsInBox 首次访问时发现规则，此后保存数据库直接更新索引，不逐次扫描目录。
func BlockCollectionViewIDsInBox(boxID string) ([]string, error) {
	collectionIndex.Lock()
	resetCollectionIndexLocked()
	loaded, generation, directory := collectionIndex.loaded[boxID], collectionIndex.generation, collectionIndex.directory
	collectionIndex.Unlock()
	if !loaded {
		entries, readErr := os.ReadDir(filepath.Join(util.DataDir, boxID, "storage", "av"))
		if readErr != nil && !os.IsNotExist(readErr) {
			return nil, readErr
		}
		ids := map[string]bool{}
		for _, entry := range entries {
			id := strings.TrimSuffix(entry.Name(), ".json")
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || !ast.IsNodeIDPattern(id) {
				continue
			}
			data, readErr := ReadAttributeViewDataInBox(id, boxID)
			if readErr != nil {
				return nil, readErr
			}
			var header struct {
				Automations *AutomationConfig `json:"automations"`
			}
			if readErr = json.Unmarshal(data, &header); readErr != nil {
				return nil, readErr
			}
			ids[id] = hasBlockCollection(header.Automations)
		}
		collectionIndex.Lock()
		resetCollectionIndexLocked()
		if generation != collectionIndex.generation || directory != collectionIndex.directory {
			collectionIndex.Unlock()
			return BlockCollectionViewIDsInBox(boxID)
		}
		maps.Copy(ids, collectionIndex.boxes[boxID])
		collectionIndex.boxes[boxID], collectionIndex.loaded[boxID] = ids, true
		collectionIndex.Unlock()
	}
	collectionIndex.Lock()
	defer collectionIndex.Unlock()
	ret := []string{}
	for id, enabled := range collectionIndex.boxes[boxID] {
		if enabled {
			ret = append(ret, id)
		}
	}
	sort.Strings(ret)
	return ret, nil
}
