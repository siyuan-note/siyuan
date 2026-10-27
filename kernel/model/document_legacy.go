package model

import (
	"errors"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func legacyDocumentPathError(reason string, candidates *treenode.LegacyDocumentCandidates) error {
	cause := documentaddressing.ErrPathAmbiguous
	if reason == "legacyPathUnsupported" {
		cause = documentaddressing.ErrLegacyPathUnsupported
	}
	ret := &DocumentAddressingError{Reason: reason, Cause: cause, CleanIDs: []string{}, UnsupportedIDs: []string{}}
	for _, candidate := range candidates.Clean {
		ret.CleanIDs = append(ret.CleanIDs, candidate.ID)
	}
	for _, candidate := range candidates.Unsupported {
		ret.UnsupportedIDs = append(ret.UnsupportedIDs, candidate.ID)
	}
	return ret
}

func legacyDocumentCandidates(boxID string, hpaths []string) (map[string]*treenode.LegacyDocumentCandidates, error) {
	return legacyDocumentCreationCandidates(boxID, hpaths, nil)
}

func legacyDocumentCreationCandidates(boxID string, hpaths []string, pending *treenode.BlockTree) (map[string]*treenode.LegacyDocumentCandidates, error) {
	if err := checkDocumentPathNotebook(boxID); err != nil {
		return nil, err
	}
	ret, err := treenode.ClassifyLegacyDocumentPathsForCreate(boxID, hpaths, pending)
	if err != nil {
		return nil, documentAddressingError("indexUnavailable", err)
	}
	return ret, nil
}

// ResolveLegacyDocumentPath requires one unambiguous, structurally clean target.
// Root paths retain their existing meaning. Callers acting on the result must
// still use the normal source-operation checks for moves, creates and reads.
func ResolveLegacyDocumentPath(boxID, hpath string, create bool) (*treenode.BlockTree, error) {
	if err := AcquireEncryptedBoxOperation(boxID); err != nil {
		return nil, err
	}
	defer ReleaseEncryptedBoxOperation(boxID)
	hpathRefresh.Lock()
	defer hpathRefresh.Unlock()
	hpaths := []string{hpath}
	if hpath == "/" {
		hpaths = nil
	}
	groups, err := legacyDocumentCandidates(boxID, hpaths)
	if err != nil {
		return nil, err
	}
	if hpath == "/" {
		return &treenode.BlockTree{BoxID: boxID, Path: "/", Type: "d"}, nil
	}
	candidates := groups[hpath]
	if len(candidates.Unsupported) > 0 || len(candidates.Clean) > 1 {
		if !create && len(candidates.Clean) == 0 {
			return nil, legacyDocumentPathError("legacyPathUnsupported", candidates)
		}
		return nil, legacyDocumentPathError("pathAmbiguous", candidates)
	}
	if len(candidates.Clean) == 0 {
		return nil, nil
	}
	return candidates.Clean[0], nil
}

// legacyDocumentCreationParents checks every requested parent prefix before any
// source is created. A matching parent ID selects its real clean ancestor chain;
// it never bypasses slash/empty-title conflicts. The caller holds hpathRefresh.
func legacyDocumentCreationParents(boxID, hpath, parentID string, pending *treenode.BlockTree) (string, map[string]*treenode.BlockTree, error) {
	parts := strings.Split(strings.TrimSuffix(hpath, ".sy"), "/")[1:]
	hpaths := []string{}
	for i, part := range parts {
		trimmed := strings.TrimSpace(part)
		if part != trimmed && i < len(parts)-1 {
			// 保留已有富标题的原始空白；仅缺失的分段沿已选祖先使用旧版 trim 规则。
			hp := "/" + strings.Join(parts[:i+1], "/")
			groups, err := legacyDocumentCreationCandidates(boxID, []string{hp}, pending)
			if err != nil {
				return "", nil, err
			}
			if candidates := groups[hp]; len(candidates.Clean)+len(candidates.Unsupported) > 0 {
				trimmed = part
			}
		}
		parts[i] = trimmed
		if i < len(parts)-1 {
			hpaths = append(hpaths, "/"+strings.Join(parts[:i+1], "/"))
		}
	}
	hpath = "/" + strings.Join(parts, "/")
	groups, err := legacyDocumentCreationCandidates(boxID, hpaths, pending)
	if err != nil {
		return "", nil, err
	}
	ret := map[string]*treenode.BlockTree{}
	var preferred *treenode.BlockTree
	if len(hpaths) > 0 && !IsBoxDoc(boxID, parentID) {
		for _, candidate := range groups[hpaths[len(hpaths)-1]].Clean {
			if candidate.ID == parentID {
				preferred = candidate
			}
		}
	}
	for _, hp := range hpaths {
		candidates := groups[hp]
		if len(candidates.Unsupported) > 0 {
			return "", nil, legacyDocumentPathError("pathAmbiguous", candidates)
		}
		if preferred != nil {
			for _, candidate := range candidates.Clean {
				if candidate.ID == preferred.ID || strings.HasPrefix(preferred.Path, strings.TrimSuffix(candidate.Path, ".sy")+"/") {
					ret[hp] = candidate
					break
				}
			}
			if ret[hp] == nil {
				return "", nil, documentAddressingError("indexUnavailable", treenode.ErrDocumentMetadataUnavailable)
			}
		} else if len(candidates.Clean) > 1 {
			return "", nil, legacyDocumentPathError("pathAmbiguous", candidates)
		} else if len(candidates.Clean) == 1 {
			ret[hp] = candidates.Clean[0]
		}
	}
	return hpath, ret, nil
}

func cleanupRetiredDocumentAddressing() error {
	if util.ReadOnly {
		return nil
	}
	return documentaddressing.CleanupRetiredRecords(util.ConfDir)
}

// LegacyPathFailure exposes only addressing failures that the legacy HTTP
// result types can represent. Other source/authentication errors remain errors.
func LegacyPathFailure(err error) (*DocumentAddressingError, bool) {
	var failure *DocumentAddressingError
	if errors.As(err, &failure) {
		switch failure.Reason {
		case "pathAmbiguous", "legacyPathUnsupported", "indexUnavailable":
			return failure, true
		}
	}
	return nil, false
}
