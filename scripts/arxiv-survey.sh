#!/usr/bin/env bash
# 用 arXiv API 查"提升通用 agent 能力"的提示词方法，打印标题+摘要。
set -uo pipefail
queries=(
  'all:"agentic context engineering"'
  'all:"reflective prompt evolution"'
  'all:"self-refine"'
  'all:"chain-of-verification"'
  'all:"large language models as optimizers"'
  'all:"concise chain-of-thought"'
)
for q in "${queries[@]}"; do
  echo "=== $q"
  curl -sG "http://export.arxiv.org/api/query" \
    --data-urlencode "search_query=$q" \
    --data-urlencode "max_results=2" \
    --data-urlencode "sortBy=relevance" |
    python3 -c '
import sys, re, html
raw = sys.stdin.read()
for entry in re.findall(r"<entry>(.*?)</entry>", raw, re.S)[:2]:
    title = html.unescape(re.sub(r"<[^>]+>", "", re.search(r"<title>(.*?)</title>", entry, re.S).group(1))).strip()
    summary = html.unescape(re.sub(r"<[^>]+>", "", re.search(r"<summary>(.*?)</summary>", entry, re.S).group(1))).strip()
    ident = re.search(r"<id>(.*?)</id>", entry, re.S).group(1).strip()
    print("  -", title)
    print("   ", ident)
    print("   ", summary[:420].replace("\n", " "))
'
done
