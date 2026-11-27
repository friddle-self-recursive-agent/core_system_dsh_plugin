#!/usr/bin/env bash
# max-file-lines.sh —— 本仓最小 lint：源文件 ≤800 行红线（R-ENG-7）。
# 语义同 core_design lint/max-file-lines.sh：git ls-files 过滤代码扩展，超 800 行=红。
# 豁免：dist/（生成物）、lockfile、go.sum；
# 另支持仓根 .max-file-lines-allowlist 白名单（一行一个路径；2026-11-27 起 v1 旧 client
# 已删除，清单为空——后续如需过渡豁免仍可加行）。
# 用法：bash plugin/lint/max-file-lines.sh [--allowlist <file>]
set -euo pipefail

LIMIT=800
ALLOWLIST_FILE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"
DEFAULT_ALLOWLIST="$REPO_ROOT/.max-file-lines-allowlist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --allowlist) ALLOWLIST_FILE="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done
[[ -z "$ALLOWLIST_FILE" && -f "$DEFAULT_ALLOWLIST" ]] && ALLOWLIST_FILE="$DEFAULT_ALLOWLIST"

# 白名单读取（注释行/# 开头与空行跳过）；文件不存在=空集。
declare -a ALLOWED=()
if [[ -n "$ALLOWLIST_FILE" && -f "$ALLOWLIST_FILE" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    ALLOWED+=("$line")
  done < "$ALLOWLIST_FILE"
fi

is_allowed() {
  local path="$1"
  for a in "${ALLOWED[@]:-}"; do
    [[ -n "$a" && "$path" == "$a" ]] && return 0
  done
  return 1
}

# 代码扩展过滤（.ts/.js/.mjs/.cjs/.css/.go）；排除 dist/、lockfile、go.sum（生成物豁免）。
violations=0
while IFS= read -r f; do
  case "$f" in
    */dist/*|*/node_modules/*|package-lock.json|npm-shrinkwrap.json|*/go.sum) continue ;;
  esac
  is_allowed "$f" && continue
  lines=$(wc -l < "$REPO_ROOT/$f" | tr -d ' ')
  if (( lines > LIMIT )); then
    echo "RED $f ($lines > $LIMIT)"
    violations=$((violations + 1))
  fi
done < <(git -C "$REPO_ROOT" ls-files | grep -E '\.(ts|js|mjs|cjs|css|go)$' || true)

if (( violations > 0 )); then
  echo "max-file-lines: $violations 个文件超 ${LIMIT} 行（R-ENG-7 红线）" >&2
  exit 1
fi
echo "max-file-lines: 全绿（≤${LIMIT} 行；豁免集见 ${ALLOWLIST_FILE:-<无>}）"
