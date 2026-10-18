"""清理 Docker Hub 构建候选标签，默认只预览，保留发布、构建缓存和 ONNX 标签。"""

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
import re
import urllib.error
import urllib.request


CANDIDATE_TAG = re.compile(r"build-([0-9]+)-([0-9]+)-(?:amd64|arm64|armv7|armv8|verified)")
REPOSITORY = re.compile(r"[a-z0-9]+(?:[._-][a-z0-9]+)*/[a-z0-9]+(?:[._-][a-z0-9]+)*")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def hub_request(path, token="", *, method="GET", payload=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request("https://hub.docker.com" + path, data, headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            body = response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        if method == "DELETE" and error.code == 404:
            return None
        # 不输出认证响应正文，避免日志包含凭据或访问令牌。
        raise RuntimeError(f"Docker Hub {method} failed: HTTP {error.code}") from None


def hub_token(username, password):
    result = hub_request("/v2/auth/token", method="POST", payload={"identifier": username, "secret": password})
    token = result.get("access_token") if isinstance(result, dict) else None
    if not isinstance(token, str) or not token:
        raise ValueError("Docker Hub authentication did not return an access token")
    return token


def list_tags(repository, token):
    tags = {}
    page = 1
    while True:
        result = hub_request(f"/v2/repositories/{repository}/tags/?page_size=100&page={page}", token)
        if not isinstance(result, dict) or not isinstance(result.get("results"), list) or "next" not in result:
            raise ValueError("Invalid Docker Hub tag listing")
        previous_count = len(tags)
        for tag in result["results"]:
            if not isinstance(tag, dict) or not isinstance(tag.get("name"), str):
                raise ValueError("Invalid Docker Hub tag metadata")
            tags[tag["name"]] = tag
        if not result["next"]:
            return list(tags.values())
        if len(tags) == previous_count:
            raise ValueError("Docker Hub tag pagination did not advance")
        # 分页地址由本地构造，不把认证头发送到响应中提供的其他地址。
        page += 1


def select_tags(tags, run_id, run_attempt, *, published=False, retention_days=7, now=None):
    if not re.fullmatch(r"[1-9][0-9]*", run_id) or not re.fullmatch(r"[1-9][0-9]*", run_attempt):
        raise ValueError("Expected a positive workflow run ID and attempt")
    if retention_days <= 0:
        raise ValueError("Expected a positive retention period")
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=retention_days)
    selected = set()
    for tag in tags:
        name = tag.get("name", "")
        match = CANDIDATE_TAG.fullmatch(name)
        if not match:
            continue
        if match[1] == run_id:
            # 发布成功后清理本次运行已使用的所有重试产物，失败运行保留候选以便重试。
            if published and int(match[2]) <= int(run_attempt):
                selected.add(name)
            continue
        try:
            updated = datetime.fromisoformat(tag["last_updated"].replace("Z", "+00:00"))
            if updated.tzinfo is None:
                raise ValueError("Missing timezone")
        except (KeyError, AttributeError, TypeError, ValueError):
            print(f"Warning: preserving tag with invalid last_updated: {name}")
            continue
        if updated < cutoff:
            selected.add(name)
    return sorted(selected)


def cleanup(repository, run_id, run_attempt, *, token="", execute=False, **options):
    if not REPOSITORY.fullmatch(repository):
        raise ValueError("Expected a Docker Hub namespace/repository")
    if execute and not token:
        raise ValueError("Deleting Docker Hub tags requires authentication")
    # 先完成分页读取再删除，避免标签数量变化使后续分页跳过候选。
    tags = list_tags(repository, token)
    selected = select_tags(tags, run_id, run_attempt, **options)
    print(f"Selected {len(selected)} of {len(tags)} tags in {repository}")
    failures = []
    for name in selected:
        if not execute:
            print(f"Would delete {repository}:{name}")
            continue
        try:
            # 仅删除标签，不通过 registry 的 manifest 摘要删除共享镜像。
            hub_request(f"/v2/repositories/{repository}/tags/{name}/", token, method="DELETE")
            print(f"Deleted {repository}:{name}")
        except (RuntimeError, urllib.error.URLError, TimeoutError, ConnectionError) as error:
            failures.append(name)
            print(f"Warning: could not delete {repository}:{name}: {error}")
    if failures:
        raise RuntimeError(f"Could not delete {len(failures)} candidate tags")
    return selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-attempt", required=True)
    parser.add_argument("--published", action="store_true", help="The current run published successfully")
    parser.add_argument("--retention-days", type=int, default=7)
    parser.add_argument("--execute", action="store_true", help="Delete selected tags instead of previewing")
    args = parser.parse_args()
    username = os.environ.get("DOCKER_HUB_USER", "")
    password = os.environ.get("DOCKER_HUB_PWD", "")
    if args.execute and (not username or not password):
        parser.error("DOCKER_HUB_USER and DOCKER_HUB_PWD are required for deletion")
    token = hub_token(username, password) if username and password else ""
    cleanup(args.repository, args.run_id, args.run_attempt, token=token, execute=args.execute,
            published=args.published, retention_days=args.retention_days)


if __name__ == "__main__":
    main()
