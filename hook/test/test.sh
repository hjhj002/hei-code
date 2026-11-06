# 危险指令
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf ~/test"}}' | python3 hook/danger-guard.py

# 安全指令
echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | python3 hook/danger-guard.py