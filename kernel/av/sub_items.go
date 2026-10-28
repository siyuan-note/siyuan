package av

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/88250/lute/ast"
)

const SubItemsSpec = 14

// SubItemsConfig 指定一对双向自关联字段，父项是权威关系，子项维护其反向值。
type SubItemsConfig struct {
	Enabled       bool   `json:"enabled"`
	ParentKeyID   string `json:"parentKeyID"`
	ChildrenKeyID string `json:"childrenKeyID"`
}

type SubItemsIndex struct {
	Parents  map[string]string
	Children map[string][]string
	Roots    []string
}

func (a *AttributeView) HasSubItems() bool {
	return a != nil && a.SubItems != nil && a.SubItems.Enabled
}

func (a *AttributeView) IsSubItemsKey(keyID string) bool {
	return a.HasSubItems() && (keyID == a.SubItems.ParentKeyID || keyID == a.SubItems.ChildrenKeyID)
}

func (a *AttributeView) subItemsKeys() (parents, children *KeyValues, err error) {
	if a == nil {
		return nil, nil, errors.New("database is missing")
	}
	for _, kv := range a.KeyValues {
		if kv == nil || kv.Key == nil {
			return nil, nil, errors.New("invalid database field")
		}
	}
	c := a.SubItems
	if c == nil || c.ParentKeyID == "" || c.ChildrenKeyID == "" || c.ParentKeyID == c.ChildrenKeyID {
		return nil, nil, errors.New("invalid database sub-item fields")
	}
	parents, err = a.GetKeyValues(c.ParentKeyID)
	if err != nil {
		return
	}
	children, err = a.GetKeyValues(c.ChildrenKeyID)
	if err != nil {
		return
	}
	for _, pair := range [][2]*KeyValues{{parents, children}, {children, parents}} {
		k := pair[0].Key
		if k.Type != KeyTypeRelation || k.Relation == nil || k.Relation.AvID != a.ID || !k.Relation.IsTwoWay || k.Relation.BackKeyID != pair[1].Key.ID {
			return nil, nil, errors.New("database sub-item fields must be reciprocal self-relations")
		}
	}
	return
}

// BuildSubItemsIndex 校验完整源图，不受筛选、分页、分组和权限投影影响，不修复输入。
func (a *AttributeView) BuildSubItemsIndex() (*SubItemsIndex, error) {
	return a.buildSubItemsIndex(true)
}

func (a *AttributeView) buildSubItemsIndex(validateInverse bool) (*SubItemsIndex, error) {
	if a == nil {
		return nil, errors.New("database is missing")
	}
	for _, kv := range a.KeyValues {
		if kv == nil || kv.Key == nil {
			return nil, errors.New("invalid database field")
		}
	}
	ret := &SubItemsIndex{Parents: map[string]string{}, Children: map[string][]string{}, Roots: []string{}}
	primary := a.GetBlockKeyValues()
	if primary == nil {
		return nil, errors.New("database primary field is missing")
	}
	for _, value := range primary.Values {
		if value == nil || value.BlockID == "" {
			return nil, errors.New("invalid database sub-item entry")
		}
		if _, exists := ret.Parents[value.BlockID]; exists {
			return nil, errors.New("duplicate database sub-item entry")
		}
		ret.Parents[value.BlockID] = ""
	}
	if !a.HasSubItems() {
		for _, v := range primary.Values {
			ret.Roots = append(ret.Roots, v.BlockID)
		}
		return ret, nil
	}
	parents, children, err := a.subItemsKeys()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, value := range parents.Values {
		if value == nil {
			return nil, errors.New("invalid database parent value")
		}
		if _, exists := ret.Parents[value.BlockID]; !exists || seen[value.BlockID] {
			return nil, errors.New("invalid database parent entry")
		}
		seen[value.BlockID] = true
		if value.Relation == nil || len(value.Relation.BlockIDs) == 0 {
			continue
		}
		if len(value.Relation.BlockIDs) != 1 {
			return nil, fmt.Errorf("database entry [%s] can only have one parent", value.BlockID)
		}
		parent := value.Relation.BlockIDs[0]
		if _, exists := ret.Parents[parent]; !exists {
			return nil, fmt.Errorf("database parent entry [%s] does not exist", parent)
		}
		ret.Parents[value.BlockID] = parent
	}
	// 每个节点最多访问两次，支持导入的深层级树。
	colors := map[string]uint8{}
	for id := range ret.Parents {
		path := []string{}
		for current := id; current != "" && colors[current] != 2; current = ret.Parents[current] {
			if colors[current] == 1 {
				return nil, fmt.Errorf("database sub-item relations contain a cycle at entry [%s]", current)
			}
			colors[current] = 1
			path = append(path, current)
		}
		for _, current := range path {
			colors[current] = 2
		}
	}
	for _, value := range primary.Values {
		id, parent := value.BlockID, ret.Parents[value.BlockID]
		if parent == "" {
			ret.Roots = append(ret.Roots, id)
		} else {
			ret.Children[parent] = append(ret.Children[parent], id)
		}
	}
	if !validateInverse {
		return ret, nil
	}
	seen = map[string]bool{}
	for _, value := range children.Values {
		if value == nil {
			return nil, errors.New("invalid database children value")
		}
		if _, exists := ret.Parents[value.BlockID]; !exists || seen[value.BlockID] {
			return nil, errors.New("invalid database children entry")
		}
		seen[value.BlockID] = true
		var actual []string
		if value.Relation != nil {
			actual = value.Relation.BlockIDs
		}
		if len(actual) != len(ret.Children[value.BlockID]) {
			return nil, errors.New("database parent and children relations disagree")
		}
		unique := map[string]bool{}
		for _, child := range actual {
			if unique[child] || ret.Parents[child] != value.BlockID {
				return nil, errors.New("database parent and children relations disagree")
			}
			unique[child] = true
		}
	}
	for parent, ids := range ret.Children {
		if len(ids) > 0 && !seen[parent] {
			return nil, errors.New("database children relation is missing")
		}
	}
	return ret, nil
}

func (a *AttributeView) ValidateSubItems() error {
	if a == nil {
		return errors.New("database is missing")
	}
	for _, view := range a.Views {
		if view == nil {
			return errors.New("invalid database view")
		}
		if view.SubItemsDisplay != "" && view.SubItemsDisplay != "flat" && view.SubItemsDisplay != "nested" {
			return errors.New("invalid database sub-item display")
		}
	}
	if !a.HasSubItems() {
		return nil
	}
	_, err := a.BuildSubItemsIndex()
	return err
}

// SetSubItemsParents 整批更改所有边后校验，允许中间状态成环而最终合法的同步移动。
func (a *AttributeView) SetSubItemsParents(changes map[string]string) error {
	index, err := a.BuildSubItemsIndex()
	if err != nil {
		return err
	}
	if !a.HasSubItems() {
		return errors.New("database sub-items are disabled")
	}
	for id, parent := range changes {
		if _, exists := index.Parents[id]; !exists {
			return ErrItemNotFound
		}
		if parent != "" {
			if _, exists := index.Parents[parent]; !exists {
				return ErrItemNotFound
			}
		}
		index.Parents[id] = parent
	}
	parents, children, err := a.subItemsKeys()
	if err != nil {
		return err
	}
	oldParents, oldChildren := parents.Values, children.Values
	parents.Values, children.Values = cloneSubItemsValues(oldParents), cloneSubItemsValues(oldChildren)
	parentValues, childValues := indexSubItemsValues(parents), indexSubItemsValues(children)
	for id, parent := range changes {
		var ids []string
		if parent != "" {
			ids = []string{parent}
		}
		setSubItemsValue(parents, parentValues, id, ids)
	}
	childrenByID := map[string][]string{}
	for _, value := range a.GetBlockKeyValues().Values {
		if parent := index.Parents[value.BlockID]; parent != "" {
			childrenByID[parent] = append(childrenByID[parent], value.BlockID)
		}
	}
	for id := range index.Parents {
		setSubItemsValue(children, childValues, id, childrenByID[id])
	}
	if err = a.ValidateSubItems(); err != nil {
		parents.Values, children.Values = oldParents, oldChildren
	}
	return err
}

func cloneSubItemsValues(values []*Value) []*Value {
	ret := make([]*Value, len(values))
	for i, value := range values {
		ret[i] = value.Clone()
	}
	return ret
}

func indexSubItemsValues(kv *KeyValues) map[string]*Value {
	ret := map[string]*Value{}
	for _, value := range kv.Values {
		ret[value.BlockID] = value
	}
	return ret
}

func setSubItemsValue(kv *KeyValues, values map[string]*Value, itemID string, ids []string) {
	if value := values[itemID]; value != nil {
		if value.Relation != nil && slices.Equal(value.Relation.BlockIDs, ids) {
			return
		}
		value.Relation = &ValueRelation{BlockIDs: append([]string{}, ids...)}
		value.SetUpdatedAt(time.Now().UnixMilli())
		return
	}
	if len(ids) == 0 {
		return
	}
	now := time.Now().UnixMilli()
	value := &Value{ID: ast.NewNodeID(), KeyID: kv.Key.ID, BlockID: itemID, Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: append([]string{}, ids...)}, CreatedAt: now, UpdatedAt: now}
	kv.Values = append(kv.Values, value)
	values[itemID] = value
}

// RestoreSubItemsParents 供已经校验过的删除撤销使用，在恢复主键后同步父项与反向值。
// 读取源数据不调用此方法，损坏源必须返回错误。
func (a *AttributeView) RestoreSubItemsParents(changes map[string]string) error {
	if !a.HasSubItems() {
		return nil
	}
	parents, children, err := a.subItemsKeys()
	if err != nil {
		return err
	}
	values := indexSubItemsValues(parents)
	for id, parent := range changes {
		var ids []string
		if parent != "" {
			ids = []string{parent}
		}
		setSubItemsValue(parents, values, id, ids)
	}
	index, err := a.buildSubItemsIndex(false)
	if err != nil {
		return err
	}
	values = indexSubItemsValues(children)
	for id := range index.Parents {
		setSubItemsValue(children, values, id, index.Children[id])
	}
	return a.ValidateSubItems()
}

// PromoteSubItemsForRemoval 保留存活后代，将直接子项放在被删除祖先的手工排序位置。
func (a *AttributeView) PromoteSubItemsForRemoval(ids []string) error {
	if !a.HasSubItems() {
		return nil
	}
	index, err := a.BuildSubItemsIndex()
	if err != nil {
		return err
	}
	removed := map[string]bool{}
	for _, id := range ids {
		removed[id] = true
	}
	changes := map[string]string{}
	ancestors := map[string]string{}
	for id, parent := range index.Parents {
		if removed[id] {
			changes[id] = ""
			continue
		}
		path := []string{}
		for removed[parent] {
			if cached, ok := ancestors[parent]; ok {
				parent = cached
				break
			}
			path = append(path, parent)
			parent = index.Parents[parent]
		}
		for _, ancestor := range path {
			ancestors[ancestor] = parent
		}
		if parent != index.Parents[id] {
			changes[id] = parent
		}
	}
	if err = a.SetSubItemsParents(changes); err != nil {
		return err
	}
	for _, view := range a.Views {
		view.ItemIDs = index.OrderAfterRemoval(view.ItemIDs, removed)
		for _, group := range view.Groups {
			group.GroupItemIDs = index.OrderAfterRemoval(group.GroupItemIDs, removed)
			if len(group.SubItemsItemIDs) > 0 {
				group.SubItemsItemIDs = index.OrderAfterRemoval(group.SubItemsItemIDs, removed)
			}
		}
	}
	return nil
}

// OrderAfterRemoval 使用已校验的删除前图计算提升后的手工顺序，也用于撤销冲突校验。
func (index *SubItemsIndex) OrderAfterRemoval(itemIDs []string, removed map[string]bool) []string {
	order := make([]string, 0, len(itemIDs))
	emitted := map[string]bool{}
	children := map[string][]string{}
	for _, id := range itemIDs {
		children[index.Parents[id]] = append(children[index.Parents[id]], id)
	}
	for _, root := range itemIDs {
		// 子项可能排在父项之前，统一在最高连续被删祖先的位置提升。
		if removed[index.Parents[root]] {
			continue
		}
		stack := []string{root}
		for len(stack) > 0 {
			id := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if emitted[id] {
				continue
			}
			emitted[id] = true
			if !removed[id] {
				order = append(order, id)
				continue
			}
			for i := len(children[id]) - 1; i >= 0; i-- {
				stack = append(stack, children[id][i])
			}
		}
	}
	// 尚未补齐排序元数据的视图也保留所有存活条目。
	for _, id := range itemIDs {
		if !removed[id] && !emitted[id] {
			emitted[id] = true
			order = append(order, id)
		}
	}
	return order
}
