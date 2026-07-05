#!/bin/bash
# CloudStudio / 云端启动脚本
# 自动安装依赖并启动 Flask 应用

echo "=========================================="
echo "  工程质量监督智能匹配Agent - 云端启动"
echo "=========================================="

# 安装依赖
echo "[1/3] 安装Python依赖..."
pip install flask requests pypdf PyMuPDF --quiet 2>&1 | tail -3

# 初始化数据库
echo "[2/3] 初始化数据库..."
python -c "
import os, sys
sys.path.insert(0, '.')
from app import db, matcher, REGULATIONS_JSON
print(f'  规范数: {db.get_stats()[\"regulations\"]}')
print(f'  条款数: {db.get_stats()[\"clauses\"]}')
"

# 启动应用
echo "[3/3] 启动Flask应用..."
PORT=${PORT:-3000}
echo "  监听端口: $PORT"
echo "  访问地址: http://0.0.0.0:$PORT"
echo "=========================================="

exec python app.py
