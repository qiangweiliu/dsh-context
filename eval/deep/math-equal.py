#!/usr/bin/env python3
"""单题数学判分：复用 eval/grade-math.py 的 sympy 等价逻辑。

用法：python3 eval/deep/math-equal.py "<pred>" "<gold>"
输出：1 表示等价，0 表示不等价或无法解析。
"""
import importlib.util
import sys
from pathlib import Path

path = Path(__file__).resolve().parent.parent / "grade-math.py"
spec = importlib.util.spec_from_file_location("grade_math", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

try:
    print("1" if module.equal(sys.argv[1], sys.argv[2]) else "0")
except Exception:
    print("0")
