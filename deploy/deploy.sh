#!/bin/bash
# ============================================================
# 娜娜的工程质量监督Agent — 一键部署脚本
# 在阿里云ECS (Ubuntu 22.04) 上执行
# 用法: sudo bash deploy.sh
# ============================================================
set -e

DOMAIN="nana-quality-inspection-agent.top"
APP_DIR="/opt/nana-agent"
REPO_URL="https://github.com/chq20010205-arch/nana-quality-inspection-agent.git"

echo "🌸 娜娜的工程质量监督Agent — 一键部署"
echo "=========================================="

# 检查是否为root
if [ "$EUID" -ne 0 ]; then
    echo "❌ 请使用 sudo 运行此脚本"
    exit 1
fi

# 1. 安装系统依赖
echo "[1/7] 安装系统依赖..."
apt update -y
apt install -y python3.11 python3.11-venv python3-pip nginx git \
    tesseract-ocr tesseract-ocr-chi-sim \
    fonts-wqy-zenhei fonts-wqy-microhei \
    certbot python3-certbot-nginx

# 2. 创建应用目录并克隆代码
echo "[2/7] 部署应用代码..."
mkdir -p $APP_DIR
cd $APP_DIR

if [ -d ".git" ]; then
    echo "  代码已存在，拉取最新版本..."
    git pull origin main || true
else
    git clone $REPO_URL .
fi

# 3. 创建Python虚拟环境
echo "[3/7] 配置Python环境..."
python3.11 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt gunicorn

# 4. 配置systemd服务
echo "[4/7] 配置系统服务..."
mkdir -p /var/log/nana-agent

cat > /etc/systemd/system/nana-agent.service <<EOF
[Unit]
Description=Nana Quality Inspection Agent
After=network.target

[Service]
User=root
WorkingDirectory=$APP_DIR
Environment="PATH=$APP_DIR/venv/bin"
Environment="PYTHONUNBUFFERED=1"
ExecStart=$APP_DIR/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:5000 --timeout 120 app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nana-agent
systemctl restart nana-agent

# 5. 配置Nginx
echo "[5/7] 配置Nginx反向代理..."
cat > /etc/nginx/sites-available/nana-agent <<'EOF'
server {
    listen 80;
    server_name nana-quality-inspection-agent.top www.nana-quality-inspection-agent.top;
    client_max_body_size 50M;
    port_in_redirect off;
    server_name_in_redirect off;

    location /static/ {
        alias /opt/nana-agent/static/;
        expires 30d;
    }

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/nana-agent /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

# 6. 验证应用
echo "[6/7] 验证应用运行..."
sleep 2
if curl -s http://127.0.0.1:5000/api/stats | grep -q "regulations"; then
    echo "  ✅ 应用运行正常"
else
    echo "  ⚠️  应用可能未正常启动，请检查: journalctl -u nana-agent -f"
fi

# 7. 配置HTTPS
echo "[7/7] 配置HTTPS..."
echo ""
echo "=========================================="
echo "✅ 基础部署完成！"
echo ""
echo "📋 接下来你需要手动完成："
echo ""
echo "1. 在阿里云域名控制台添加A记录解析："
echo "   @ → $(curl -s ifconfig.me)"
echo "   www → $(curl -s ifconfig.me)"
echo ""
echo "2. 等待解析生效后，配置HTTPS证书："
echo "   certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo ""
echo "3. （如ECS在中国大陆）完成ICP备案"
echo ""
echo "🌐 访问地址: http://$DOMAIN"
echo "=========================================="
