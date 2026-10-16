package model

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func (tx *Transaction) validateAutomationTemplateReferences(source, target *av.AttributeView, key *av.Key, value *av.Value, boxID string) error {
	if value.Relation != nil && len(value.Relation.BlockIDs) > 0 {
		if key.Relation == nil || key.Relation.AvID == "" {
			return fmt.Errorf("automation relation target is unavailable")
		}
		related, err := tx.readAttributeViewForMutation(key.Relation.AvID, "", boxID)
		if err != nil {
			return err
		}
		for _, id := range value.Relation.BlockIDs {
			if !ast.IsNodeIDPattern(id) || related.GetBlockValue(id) == nil {
				return fmt.Errorf("automation related item [%s] does not exist in the target database", id)
			}
			// 预览标签限制长度，避免短 ID 数组放大成无界的主键文本响应。
			content := related.GetBlockValue(id).Block.Content
			if len(content) > 1024 {
				content = content[:1024]
			}
			value.Relation.Contents = append(value.Relation.Contents, &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: content}})
		}
	}
	for _, asset := range value.MAsset {
		if asset == nil || asset.Type != av.AssetTypeFile && asset.Type != av.AssetTypeImage {
			return fmt.Errorf("invalid automation asset")
		}
		cleanPath, assetBox, err := assetPathAndBox(asset.Content, boxID)
		if err != nil || !IsSameCryptoBoundary(boxID, assetBox) {
			return fmt.Errorf("automation asset crosses its notebook boundary")
		}
		// 外部链接只允许复用源或目标中已保存的引用，不发起网络请求。
		existing := false
		for _, view := range []*av.AttributeView{source, target} {
			view.VisitPersistedValues(func(stored *av.Value) {
				for _, item := range stored.MAsset {
					if item != nil && item.Content == asset.Content {
						existing = true
					}
				}
			})
		}
		if existing && !strings.HasPrefix(cleanPath, "assets/") {
			continue
		}
		path, err := GetAssetAbsPathInBox(asset.Content, boxID)
		if err != nil {
			return err
		}
		info, err := os.Stat(path)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("automation asset is not a file")
		}
	}
	return nil
}

// PreviewAttributeViewTemplate 使用独立快照和覆盖值，不执行写事务、不保存配置、不执行自动动作。
func PreviewAttributeViewTemplate(request apicontract.AVAutomationTemplatePreviewRequest) (*av.Value, error) {
	FlushTxQueue()
	_, boxID := av.FindAttributeViewPath(request.AvID)
	tx := &Transaction{}
	defer tx.finishAttributeViewMutation(false)
	source, err := tx.readAttributeViewForMutation(request.AvID, "", boxID)
	if err != nil {
		return nil, err
	}
	if source.GetBlockValue(request.ItemID) == nil {
		return nil, av.ErrItemNotFound
	}
	referenceSource := source
	source, err = cloneAttributeViewForFieldMutation(source)
	if err != nil {
		return nil, err
	}
	target := source
	if request.TargetAvID != "" && request.TargetAvID != source.ID {
		target, err = tx.readAttributeViewForMutation(request.TargetAvID, "", boxID)
		if err != nil {
			return nil, err
		}
	}
	key, err := target.GetKey(request.KeyID)
	if err != nil {
		return nil, err
	}
	zone, err := time.LoadLocation(request.TimeZone)
	if err != nil {
		return nil, err
	}
	if len(request.Inputs) > 100 {
		return nil, fmt.Errorf("too many automation preview values")
	}
	for id, override := range request.Inputs {
		field, fieldErr := source.GetKey(id)
		if fieldErr != nil || !av.AutomationEditableKey(field.Type) {
			return nil, fmt.Errorf("invalid automation preview field [%s]", id)
		}
		if len(override) > av.AutomationTemplateLimit {
			return nil, fmt.Errorf("invalid automation preview value")
		}
		value, valueErr := av.ParseAutomationTemplateValue(field, override, zone)
		if valueErr != nil {
			return nil, valueErr
		}
		value.KeyID, value.BlockID = id, request.ItemID
		for _, values := range source.KeyValues {
			if values.Key.ID != id {
				continue
			}
			filtered := values.Values[:0]
			for _, old := range values.Values {
				if old.BlockID != request.ItemID {
					filtered = append(filtered, old)
				}
			}
			values.Values = append(filtered, value)
		}
	}
	now := time.Now()
	if request.TriggerTime != "" {
		now, err = av.ParseAutomationTime(request.TriggerTime, zone)
		if err != nil {
			return nil, err
		}
	}
	value, err := av.EvaluateAutomationTemplate(av.AutomationTemplateContext{Source: source, ItemID: request.ItemID,
		Time: now, TimeZone: request.TimeZone}, key, request.Template)
	if err != nil {
		return nil, err
	}
	if target.ID == referenceSource.ID {
		target = referenceSource
	}
	if err = tx.validateAutomationTemplateReferences(referenceSource, target, key, value, boxID); err != nil {
		return nil, err
	}
	return value, nil
}
