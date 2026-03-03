"""
Check if language file keys are complete.

This script checks all language files in app/appearance/langs/ directory
and finds:
- Missing keys: keys that exist in most files but not in current file
- Extra keys: keys that don't exist in most files but exist in current file
- Duplicate keys: keys that appear multiple times in the same file
using statistical methods.

Usage:
    python scripts/check-lang-keys.py
    python scripts/check-lang-keys.py -d app/appearance/langs
    python scripts/check-lang-keys.py --dir app/appearance/langs

Options:
    -d, --dir DIR    Language files directory path (default: app/appearance/langs)
    -h, --help       Show help message and exit

Exit codes:
    0    All language files have complete keys
    1    Some language files have missing or extra keys
"""

import json
import os
import re
from pathlib import Path
from argparse import ArgumentParser
from collections import defaultdict, Counter


def find_duplicate_keys_recursive(data, prefix="", duplicates=None):
    """Recursively find duplicate keys in nested JSON structure.

    Args:
        data: JSON data (dict, list, or primitive)
        prefix: Current key prefix (for nested keys)
        duplicates: Set to store duplicate keys found

    Returns:
        set: Set of duplicate keys (using dot notation for nested keys)
    """
    if duplicates is None:
        duplicates = set()
    
    if isinstance(data, dict):
        seen_keys = {}
        for key, value in data.items():
            full_key = f"{prefix}.{key}" if prefix else key
            
            # Check for duplicate at current level
            if key in seen_keys:
                duplicates.add(full_key)
            seen_keys[key] = True
            
            # Recursively check nested structures
            if isinstance(value, dict):
                find_duplicate_keys_recursive(value, full_key, duplicates)
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    if isinstance(item, dict):
                        find_duplicate_keys_recursive(item, f"{full_key}[{i}]", duplicates)
    
    return duplicates


def find_duplicate_keys(file_path):
    """Find duplicate keys in JSON file including nested structures.

    Args:
        file_path (Path): Language file path

    Returns:
        list: List of duplicate keys found in the file (using dot notation for nested keys)
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if not isinstance(data, dict):
            return []
        
        duplicates = find_duplicate_keys_recursive(data)
        return sorted(duplicates)
    except Exception as e:
        print(f"Error: Failed to check duplicate keys in {file_path}: {e}")
        return []


def collect_all_keys(data, prefix=""):
    """Recursively collect all keys from nested JSON structure.

    Args:
        data: JSON data (dict, list, or primitive)
        prefix: Current key prefix (for nested keys)

    Returns:
        set: Set of all keys (using dot notation for nested keys)
    """
    keys = set()
    
    if isinstance(data, dict):
        for key, value in data.items():
            full_key = f"{prefix}.{key}" if prefix else key
            keys.add(full_key)
            
            # Recursively collect nested keys
            if isinstance(value, dict):
                keys.update(collect_all_keys(value, full_key))
            elif isinstance(value, list):
                # Handle list of objects
                for i, item in enumerate(value):
                    if isinstance(item, dict):
                        keys.update(collect_all_keys(item, f"{full_key}[{i}]"))
    
    return keys


def get_key_order(file_path):
    """Get the order of keys as they appear in the JSON file.

    Args:
        file_path (Path): Language file path

    Returns:
        dict: Dictionary mapping key name (including nested paths) to its position index
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            data = json.loads(content)
        
        # Collect all keys recursively
        all_keys = collect_all_keys(data)
        
        # Get order by parsing the raw text
        key_order = {}
        pattern = r'["\']([^"\']+)["\']\s*:'
        index = 0
        
        # Track nesting path
        nesting_stack = []
        
        for match in re.finditer(pattern, content):
            key = match.group(1)
            pos = match.start()
            
            # Check nesting level
            text_before = content[:pos]
            open_braces = text_before.count('{')
            close_braces = text_before.count('}')
            nesting_level = open_braces - close_braces
            
            # Build full key path based on nesting
            if nesting_level == 1:  # Top level
                nesting_stack = [key]
                full_key = key
            elif nesting_level > 1:  # Nested level
                # Keep only the relevant nesting levels
                nesting_stack = nesting_stack[:nesting_level - 1] + [key]
                full_key = ".".join(nesting_stack)
            else:
                continue
            
            # Only record if this is a valid key we're tracking
            if full_key in all_keys and full_key not in key_order:
                key_order[full_key] = index
                index += 1
        
        return key_order
    except Exception as e:
        return {}


def load_lang_file(file_path):
    """Load language file and return key set and file content.

    Args:
        file_path (Path): Language file path

    Returns:
        tuple: (key set (including nested keys), file content dict, duplicate keys list, key order dict)
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Collect all keys including nested ones
            all_keys = collect_all_keys(data)
            duplicates = find_duplicate_keys(file_path)
            key_order = get_key_order(file_path)
            return all_keys, data, duplicates, key_order
    except json.JSONDecodeError as e:
        print(f"Error: Failed to parse file {file_path}: {e}")
        return None, None, [], {}
    except Exception as e:
        print(f"Error: Failed to read file {file_path}: {e}")
        return None, None, [], {}


def check_lang_keys(langs_dir):
    """Check if language file keys are complete.

    Uses statistical method: count how many files contain each key, then determine:
    - Missing keys: keys that exist in most files but not in current file
    - Extra keys: keys that don't exist in most files but exist in current file
    - Duplicate keys: keys that appear multiple times in the same file

    Args:
        langs_dir (str): Language files directory path

    Returns:
        bool: True if all files have complete keys, False otherwise
    """
    langs_path = Path(langs_dir)
    if not langs_path.exists():
        print(f"Error: Directory does not exist: {langs_dir}")
        return False

    # Load all language files
    lang_keys = {}
    duplicate_keys_by_file = {}
    key_order_by_file = {}
    
    for lang_file in sorted(langs_path.glob("*.json")):
        keys, data, duplicates, key_order = load_lang_file(lang_file)
        if keys is None:
            continue
        lang_keys[lang_file.name] = keys
        if duplicates:
            duplicate_keys_by_file[lang_file.name] = duplicates
        key_order_by_file[lang_file.name] = key_order

    if not lang_keys:
        print("Error: No language files found")
        return False

    total_files = len(lang_keys)
    if total_files == 0:
        print("Error: No valid language files found")
        return False

    # Count how many files contain each key
    key_count = defaultdict(int)
    all_keys = set()
    
    for keys in lang_keys.values():
        all_keys.update(keys)
        for key in keys:
            key_count[key] += 1

    # Calculate threshold: if a key exists in more than half of the files, it should exist
    threshold = (total_files + 1) // 2  # Round up, e.g., 5 files need 3

    # Classify keys: expected keys and unexpected keys
    expected_keys = {key for key, count in key_count.items() if count >= threshold}
    unexpected_keys = all_keys - expected_keys

    # Find reference file (file with most keys) for ordering missing keys
    reference_file = max(lang_keys.items(), key=lambda x: len(x[1]))[0]
    reference_key_order = key_order_by_file.get(reference_file, {})

    print(f"Checked {total_files} language files")
    print(f"Threshold: keys need to exist in at least {threshold} files to be considered expected")
    print(f"Expected keys: {len(expected_keys)}")
    print(f"Unexpected keys: {len(unexpected_keys)}\n")

    # Check keys for each file
    all_complete = True
    file_issues = {}  # {lang_name: {'missing': set, 'extra': set, 'duplicates': list}}

    for lang_name, keys in lang_keys.items():
        # Find missing keys (should exist but don't exist in current file)
        missing = expected_keys - keys
        # Find extra keys (shouldn't exist but exist in current file)
        extra = keys & unexpected_keys
        # Get duplicate keys
        duplicates = duplicate_keys_by_file.get(lang_name, [])

        if missing or extra or duplicates:
            file_issues[lang_name] = {'missing': missing, 'extra': extra, 'duplicates': duplicates}
            if missing or duplicates:
                all_complete = False

    # Output results
    if all_complete and not file_issues:
        print("All language files have complete keys!")
        return True

    # Report issues grouped by file
    print("Issues found:")
    print("  Missing keys: exist in most files but not in current file")
    print("  Extra keys: don't exist in most files but exist in current file")
    print("  Duplicate keys: keys that appear multiple times in the same file\n")
    
    for lang_name in sorted(file_issues.keys()):
        issues = file_issues[lang_name]
        missing = issues['missing']
        extra = issues['extra']
        duplicates = issues['duplicates']
        key_order = key_order_by_file.get(lang_name, {})
        
        # Sort function for missing keys: use reference file order
        def sort_missing_by_order(key):
            return (reference_key_order.get(key, float('inf')), key)
        
        # Sort function for extra/duplicate keys: use current file order
        def sort_by_order(key):
            return (key_order.get(key, float('inf')), key)
        
        has_issues = False
        if missing or extra or duplicates:
            has_issues = True
            print(f"  {lang_name}:")

        # Show extra keys
        if extra:
            key_word = "key" if len(extra) == 1 else "keys"
            print(f"    {len(extra)} Extra {key_word}:")
            extra_with_count = [(key, key_count[key]) for key in sorted(extra, key=sort_by_order)]
            if len(extra_with_count) <= 10:
                for key, count in extra_with_count:
                    print(f"      - {key} (exists in only {count}/{total_files} files)")
            else:
                for key, count in extra_with_count[:10]:
                    print(f"      - {key} (exists in only {count}/{total_files} files)")
                print(f"      ... {len(extra_with_count) - 10} more keys not shown")

        # Show missing keys
        if missing:
            key_word = "key" if len(missing) == 1 else "keys"
            print(f"    {len(missing)} Missing {key_word}:")
            missing_with_count = [(key, key_count[key]) for key in sorted(missing, key=sort_missing_by_order)]
            if len(missing_with_count) <= 10:
                for key, count in missing_with_count:
                    print(f"      - {key} (exists in {count}/{total_files} files)")
            else:
                for key, count in missing_with_count[:10]:
                    print(f"      - {key} (exists in {count}/{total_files} files)")
                print(f"      ... {len(missing_with_count) - 10} more keys not shown")

        # Show duplicate keys
        if duplicates:
            key_word = "key" if len(duplicates) == 1 else "keys"
            print(f"    {len(duplicates)} Duplicate {key_word}:")
            for key in sorted(duplicates, key=sort_by_order):
                print(f"      - {key}")

        if has_issues:
            print()

    return False


def main():
    parser = ArgumentParser(
        description="Check if language file keys are complete"
    )
    parser.add_argument(
        "-d", "--dir",
        default="app/appearance/langs",
        help="Language files directory path (default: app/appearance/langs)"
    )
    args = parser.parse_args()

    # Get project root directory (parent of script directory)
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    langs_dir = project_root / args.dir

    success = check_lang_keys(langs_dir)
    exit(0 if success else 1)


if __name__ == "__main__":
    main()

