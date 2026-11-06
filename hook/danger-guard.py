#!/usr/bin/env python3
"""PreToolUse hook：拦截危险 Bash 命令"""
import json
import re
import sys
import io

# 确保 stdout 使用 UTF-8（Windows 等环境可能需要）
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# (正则, 拦截理由)
BLOCKED = [
    (r"rm\s+-rf\s+(/|~)", "禁止递归删除根目录或家目录"),
    (r"git\s+push\b.*(--force|-f)", "禁止 force push"),
    (r"curl\b.*\|\s*(ba)?sh", "禁止 curl | sh 直接执行远程脚本"),
]

def main():
    data = json.load(sys.stdin)  # hook 协议：stdin 收 JSON

    # 如果不是 Bash 工具，直接放行（输出 allow 决策）
    if data.get("tool_name") != "Bash":
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "通过",
            }
        }, ensure_ascii=False))
        sys.exit(0)

    cmd = data.get("tool_input", {}).get("command", "")
    for pattern, msg in BLOCKED:
        if re.search(pattern, cmd):
            # ✅ 关键：ensure_ascii=False 让中文直接显示
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": msg,
                }
            }, ensure_ascii=False))
            sys.exit(0)

    # 没匹配到危险模式 → 放行
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "通过",
        }
    }, ensure_ascii=False))
    sys.exit(0)

if __name__ == "__main__":
    main()

# echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf ~/test"}}' | python3 danger-guard.py
# echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | python3 danger-guard.py