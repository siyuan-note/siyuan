package av

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func declaredCapabilityConstants(t *testing.T, typeName string) []string {
	t.Helper()
	packages, err := parser.ParseDir(token.NewFileSet(), ".", func(file os.FileInfo) bool {
		return !strings.HasSuffix(file.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	var values []string
	for _, file := range packages["av"].Files {
		for _, declaration := range file.Decls {
			group, ok := declaration.(*ast.GenDecl)
			if !ok || group.Tok != token.CONST {
				continue
			}
			for _, spec := range group.Specs {
				value := spec.(*ast.ValueSpec)
				typ, ok := value.Type.(*ast.Ident)
				matches := ok && typ.Name == typeName
				for _, name := range value.Names {
					matches = matches || strings.HasPrefix(name.Name, typeName)
				}
				if !matches {
					continue
				}
				for _, expression := range value.Values {
					literal, ok := expression.(*ast.BasicLit)
					if !ok || literal.Kind != token.STRING {
						t.Fatalf("%s constants must declare literal protocol values", typeName)
					}
					text, err := strconv.Unquote(literal.Value)
					if err != nil {
						t.Fatal(err)
					}
					values = append(values, text)
				}
			}
		}
	}
	sort.Strings(values)
	return values
}

func TestKeyCapabilityCompleteness(t *testing.T) {
	var actual []string
	orders := map[int]bool{}
	for typ, capability := range keyCapabilities {
		actual = append(actual, string(typ))
		if orders[capability.order] || capability.ValueKind == "" {
			t.Fatalf("invalid capability declaration for %s", typ)
		}
		orders[capability.order] = true
		if capability.Filterable != (capability.DefaultOperator != "") {
			t.Fatalf("filterable type %s must declare its default operator", typ)
		}
		if capability.DefaultOperator != "" {
			found := false
			for _, operator := range filterOperators {
				found = found || operator == capability.DefaultOperator
			}
			if !found {
				t.Fatalf("type %s uses an undeclared filter operator", typ)
			}
		}
	}
	sort.Strings(actual)
	if expected := declaredCapabilityConstants(t, "KeyType"); !reflect.DeepEqual(actual, expected) {
		t.Fatalf("field capabilities do not cover declared types: got %v want %v", actual, expected)
	}
	actual = nil
	for _, operator := range filterOperators {
		actual = append(actual, string(operator))
	}
	sort.Strings(actual)
	if expected := declaredCapabilityConstants(t, "FilterOperator"); !reflect.DeepEqual(actual, expected) {
		t.Fatalf("filter operator registry is incomplete: got %v want %v", actual, expected)
	}
}

func TestKeyCapabilityBehavior(t *testing.T) {
	for _, typ := range KeyTypes() {
		capability := GetKeyCapability(typ)
		computed := typ == KeyTypeCreated || typ == KeyTypeUpdated || typ == KeyTypeTemplate || typ == KeyTypeRollup || typ == KeyTypeLineNumber
		if capability.Editable == computed || AutomationEditableKey(typ) == computed ||
			isNewItemTemplateEditableKeyType(typ) != (!computed && typ != KeyTypeBlock) {
			t.Fatalf("editable behavior changed for %s", typ)
		}
		date := typ == KeyTypeDate || typ == KeyTypeCreated || typ == KeyTypeUpdated
		if IsCalendarDateType(typ) != date || IsDateKeyType(typ) != date {
			t.Fatalf("date behavior changed for %s", typ)
		}
		if IsSelectKeyType(typ) != (typ == KeyTypeSelect || typ == KeyTypeMSelect) {
			t.Fatalf("select behavior changed for %s", typ)
		}
		if capability.Filterable != (typ != KeyTypeLineNumber) || capability.Sortable != (typ != KeyTypeLineNumber) ||
			capability.Groupable != (typ != KeyTypeLineNumber && typ != KeyTypeRollup) {
			t.Fatalf("filter, sort, or group behavior changed for %s", typ)
		}
	}
	if GetKeyCapability("unknown") != (KeyCapability{}) || AutomationEditableKey("unknown") || IsCalendarDateType("unknown") {
		t.Fatal("unknown field type acquired capabilities")
	}
}

func TestKeyCapabilityGeneratedArtifacts(t *testing.T) {
	runtime, declarations := CapabilityTypeScript()
	for file, expected := range map[string][]byte{
		"../../app/src/protyle/render/av/capabilities.generated.ts": runtime,
		"../../app/src/types/av/index.d.ts":                         declarations,
	} {
		data, err := os.ReadFile(file)
		if err != nil || !bytes.Equal(bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n")), expected) {
			t.Fatalf("generated field capability artifact is out of date: %s (%v)", file, err)
		}
	}
}

func TestKeyCapabilityPersistenceFixture(t *testing.T) {
	const fixture = "testdata/spec9-layouts.json"
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ParseAttributeViewData("20260921000000-layouts", data)
	if err != nil {
		t.Fatal(err)
	}
	before, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	previousProvider, previousAcquire, previousRelease := AVDEKProvider, AVLockAcquire, AVLockRelease
	AVDEKProvider = func(string) ([]byte, error) { return bytes.Repeat([]byte{0x62}, 32), nil }
	AVLockAcquire, AVLockRelease = nil, nil
	t.Cleanup(func() {
		AVDEKProvider, AVLockAcquire, AVLockRelease = previousProvider, previousAcquire, previousRelease
	})
	const boxID = "20261008000000-box0001"
	ciphertext, err := EncryptAVData(boxID, view.ID, before)
	if err != nil || !util.IsCiphertext(ciphertext) {
		t.Fatalf("fixture encryption failed: %v", err)
	}
	preservedCiphertext := bytes.Clone(ciphertext)
	domain := avAAD(boxID, view.ID)
	for _, typ := range KeyTypes() {
		AutomationEditableKey(typ)
		isNewItemTemplateEditableKeyType(typ)
		IsCalendarDateType(typ)
		GetKeyCapability(typ)
	}
	after, err := json.Marshal(view)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("capability reads changed serialized AV data: %v", err)
	}
	decrypted, err := DecryptAVData(boxID, view.ID, ciphertext)
	if err != nil || !bytes.Equal(decrypted, after) || !bytes.Equal(ciphertext, preservedCiphertext) || domain != avAAD(boxID, view.ID) {
		t.Fatalf("capability reads changed ciphertext, plaintext, or encryption domain: %v", err)
	}
	if _, err = DecryptAVData("20261008000000-other01", view.ID, ciphertext); err == nil {
		t.Fatal("encrypted fixture authenticated in a different notebook")
	}
	stored, err := os.ReadFile(filepath.Clean(fixture))
	if err != nil || !bytes.Equal(data, stored) {
		t.Fatalf("capability reads changed the fixture: %v", err)
	}
	t.Logf("AV_FIXTURE_BYTES %x", sha256.Sum256(after))
	t.Logf("AV_FIXTURE_DOMAIN %s", domain)
}
