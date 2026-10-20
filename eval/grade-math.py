#!/usr/bin/env python3
"""MATH 判分：预测与 gold 都转成 sympy 表达式做等价判断，失败再退字符串/多解/数值比较。

口径：
- gold 是精确表达式时，不接受小数近似（exact-form 也算能力的一部分）。
- gold 本身是数值时，允许 1e-9 容差；预测句子里出现该数值也算对。
- 多解（如 "8,-112"、"(4,24)"）忽略顺序逐项比较。

用法：python3 eval/grade-math.py eval/results/math5.jsonl
"""
import json
import re
import sys
from collections import defaultdict

from sympy import N, simplify, srepr
from sympy.parsing.latex import parse_latex
from sympy.parsing.sympy_parser import parse_expr, standard_transformations

NUMERIC = re.compile(r"^-?\d+(?:\.\d+)?$")


_FRAC = [
    (re.compile(r"\\frac\s*(\\[A-Za-z]+)(\d+)"), r"\\frac{\1}{\2}"),
    (re.compile(r"\\frac\s*(\d)(\d+)"), r"\\frac{\1}{\2}"),
    (re.compile(r"\\frac\s*([A-Za-z])([A-Za-z0-9])"), r"\\frac{\1}{\2}"),
    (re.compile(r"\\frac\s*(\d+)(\\[A-Za-z]+|\d)"), r"\\frac{\1}{\2}"),
]


def _fix_frac(s):
    """把 `\\frac \\pi4` / `\\frac12` 这类未加花括号的写法补成标准形式。"""
    for _ in range(3):
        before = s
        for pattern, repl in _FRAC:
            s = pattern.sub(repl, s)
        if s == before:
            break
    return s


def norm(text):
    s = str(text or "").strip()
    s = s.replace("**", "").replace("\\(", "").replace("\\)", "").replace("\\[", "").replace("\\]", "")
    s = re.sub(r"\\(displaystyle|textstyle|quad|qquad)", "", s)
    s = s.strip("$").strip()
    s = re.sub(r"\\\s+", "", s)
    s = _fix_frac(s)
    s = re.sub(r"\\(left|right|!|,|;|:)", "", s)
    s = re.sub(r"\\text\{([^}]*)\}", r"\1", s)
    s = re.sub(r"\\mathrm\{([^}]*)\}", r"\1", s)
    s = s.replace("\\dfrac", "\\frac").replace("\\tfrac", "\\frac")
    s = re.sub(r"_\{([^{}]*)\}", r"_\1", s)
    s = re.sub(r"\^\{([^{}]*)\}", r"^\1", s)
    s = re.sub(r"\\sqrt(\d+)", r"\\sqrt{\1}", s)
    s = re.sub(r"\\sqrt([a-zA-Z])(?![a-zA-Z])", r"\\sqrt{\1}", s)
    s = re.sub(r"\^\{?\\circ\}?", "", s)
    s = re.sub(r"\\%", "%", s)
    s = re.sub(r"^[A-Za-z]\w*(\([^)]*\))?\s*=\s*", "", s)
    return s.replace(" ", "").strip().rstrip(".")


def split_multi(text):
    s = norm(text)
    depth = 0
    parts = []
    current = ""
    for ch in s:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    parts.append(current)
    return [p for p in parts if p]


def to_expr(text):
    s = norm(text)
    try:
        return parse_latex(s)
    except Exception:
        pass
    try:
        return parse_expr(
            s.replace("\\cdot", "*").replace("\\times", "*").replace("\\pi", "pi"),
            transformations=standard_transformations,
        )
    except Exception:
        return None


def same_value(p, g):
    if p and p == g:
        return True
    a, b = to_expr(p), to_expr(g)
    if a is None or b is None:
        return False
    if srepr(a) == srepr(b):
        return True
    try:
        if simplify(a - b) == 0:
            return True
    except Exception:
        pass
    if NUMERIC.fullmatch(g):
        try:
            if abs(float(N(a)) - float(N(b))) < 1e-9:
                return True
        except Exception:
            pass
    try:
        if type(a).__name__ in ("Tuple", "FiniteSet") and type(b).__name__ in ("Tuple", "FiniteSet"):
            left, right = list(a), list(b)
            if len(left) != len(right):
                return False
            return all(same_value(str(x), str(y)) for x, y in zip(left, right))
        if str(a) == str(b):
            return True
    except Exception:
        pass
    return False


def equal(pred, gold):
    g = norm(gold)
    if not g:
        return False
    candidates = [norm(pred)]
    raw = norm(pred)
    if "=" in raw:
        candidates.append(norm(raw.split("=")[-1]))
    for cand in candidates:
        if same_value(cand, g):
            return True
        if NUMERIC.fullmatch(g) and re.search(rf"(?<![\d.]){re.escape(g)}(?![\d])", cand.replace(",", "")):
            return True
        gm = split_multi(g)
        if len(gm) > 1:
            pm = split_multi(cand)
            if len(pm) == len(gm):
                remaining = list(pm)
                matched = 0
                for item in gm:
                    for i, other in enumerate(remaining):
                        if same_value(other, item):
                            remaining.pop(i)
                            matched += 1
                            break
                if matched == len(gm):
                    return True
    return False


def main():
    results = sys.argv[1] if len(sys.argv) > 1 else "eval/results/math5.jsonl"
    rows = [json.loads(line) for line in open(results, encoding="utf-8") if line.strip()]
    by_cond = defaultdict(list)
    for row in rows:
        by_cond[row["cond"]].append(row)

    print(f"== {results}：{len(by_cond)} 组")
    print("条件\t答对\t正确率\t平均耗时\t产出字符\t状态异常")
    for cond, own in by_cond.items():
        hits = 0
        for row in own:
            row["correct"] = bool(row.get("status") == "ok" and equal(row.get("pred"), row.get("gold")))
            hits += 1 if row["correct"] else 0
        avg = sum(r["seconds"] for r in own) / len(own)
        chars = sum(r["chars"] for r in own) / len(own)
        bad = sum(1 for r in own if r["status"] != "ok")
        print(f"{cond}\t{hits}/{len(own)}\t{hits / len(own) * 100:.1f}%\t{avg:.1f}s\t{chars:.0f}\t{bad}")

    order = list(by_cond)
    print("\n== 逐题（任一组错才列出）")
    ids = []
    for own in by_cond.values():
        for row in own:
            if not row["correct"] and row["id"] not in ids:
                ids.append(row["id"])
    for rid in ids:
        cells = []
        gold = "?"
        for cond in order:
            row = next((r for r in by_cond[cond] if r["id"] == rid), None)
            if row is None:
                cells.append(f"{cond}:—")
                continue
            gold = row["gold"]
            cells.append(f"{cond}:{'✓' if row['correct'] else '✗'}")
        print(f"{rid}\t{' '.join(cells)}\tgold={gold}")

    unparsed = sum(1 for own in by_cond.values() for row in own if to_expr(row.get("pred")) is None)
    print(f"\n预测无法被 sympy 解析：{unparsed}/{len(rows)}")


if __name__ == "__main__":
    main()
