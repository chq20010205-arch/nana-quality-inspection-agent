# 🚀 娜娜的工程质量监督Agent — 阿里云部署指南

域名：`nana-quality-inspection-agent.top`

## 架构总览

```
用户浏览器
    ↓ HTTPS (443)
阿里云ECS服务器 (Ubuntu 22.04)
    ↓
Nginx (反向代理 + SSL证书)
    ↓
Gunicorn (Python WSGI服务器)
    ↓
Flask应用 (app.py)
    ↓
SQLite (regulations.db)
```

---

## 第一步：购买阿里云ECS服务器

1. 登录 [阿里云控制台](https://ecs.console.aliyun.com)
2. 创建ECS实例：
   - **系统**：Ubuntu 22.04 LTS 64位
   - **配置**：2核4G（推荐，PyMuPDF和AI解析需要内存）
   - **带宽**：按量付费 或 1Mbps固定带宽
   - **安全组**：开放端口 22(SSH)、80(HTTP)、443(HTTPS)
3. 记下 **公网IP地址**（如 `47.xx.xx.xx`）
4. 设置SSH登录密码或密钥对

---

## 第二步：域名解析配置

1. 进入 [阿里云域名控制台](https://dns.console.aliyun.com)
2. 找到域名 `nana-quality-inspection-agent.top`
3. 添加解析记录：

| 记录类型 | 主机记录 | 记录值 | 说明 |
|----------|----------|--------|------|
| A | @ | `你的ECS公网IP` | 主域名 |
| A | www | `你的ECS公网IP` | www子域名 |

4. 等待解析生效（通常1-10分钟）

验证解析：
```bash
ping nana-quality-inspection-agent.top
# 应返回你的ECS公网IP
```

---

## 第三步：服务器环境搭建

SSH连接到服务器后，依次执行：

```bash
# 1. 更新系统
sudo apt update && sudo apt upgrade -y

# 2. 安装Python 3.11 + 虚拟环境
sudo apt install -y python3.11 python3.11-venv python3-pip

# 3. 安装Nginx
sudo apt install -y nginx

# 4. 安装Git
sudo apt install -y git

# 5. 安装tesseract-ocr（PDF OCR功能需要）
sudo apt install -y tesseract-ocr tesseract-ocr-chi-sim

# 6. 安装中文字体（PDF导出需要）
sudo apt install -y fonts-wqy-zenhei fonts-wqy-microhei
```

---

## 第四步：部署应用代码

```bash
# 1. 创建应用目录
sudo mkdir -p /opt/nana-agent
sudo chown $USER:$USER /opt/nana-agent
cd /opt/nana-agent

# 2. 克隆代码（从GitHub）
git clone https://github.com/chq20010205-arch/nana-quality-inspection-agent.git .

# 3. 创建Python虚拟环境
python3.11 -m venv venv

# 4. 激活虚拟环境
source venv/bin/activate

# 5. 安装依赖
pip install -r requirements.txt
pip install gunicorn

# 6. 初始化数据库
python -c "from app import db; print('DB initialized')"

# 7. 测试运行
python app.py
# 看到 "Running on http://127.0.0.1:5000" 说明正常
# Ctrl+C 停止
```

---

## 第五步：配置Gunicorn（生产级WSGI服务器）

```bash
# 测试Gunicorn能否正常启动
cd /opt/nana-agent
source venv/bin/activate
gunicorn --workers 3 --bind 127.0.0.1:5000 app:app

# 看到 "Listening at: http://127.0.0.1:5000" 说明正常
# Ctrl+C 停止，接下来配置systemd自启动
```

创建systemd服务文件：

```bash
sudo nano /etc/systemd/system/nana-agent.service
```

写入以下内容：

```ini
[Unit]
Description=Nana Quality Inspection Agent
After=network.target

[Service]
User=root
WorkingDirectory=/opt/nana-agent
Environment="PATH=/opt/nana-agent/venv/bin"
ExecStart=/opt/nana-agent/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:5000 --timeout 120 app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable nana-agent
sudo systemctl start nana-agent
sudo systemctl status nana-agent
# 看到 "active (running)" 说明成功
```

---

## 第六步：配置Nginx反向代理

```bash
sudo nano /etc/nginx/sites-available/nana-agent
```

写入以下内容（先配HTTP，后面加HTTPS）：

```nginx
server {
    listen 80;
    server_name nana-quality-inspection-agent.top www.nana-quality-inspection-agent.top;

    # 上传文件大小限制（PDF上传）
    client_max_body_size 50M;

    # 静态文件
    location /static/ {
        alias /opt/nana-agent/static/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # 反向代理到Gunicorn
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时设置（AI解析需要较长时间）
        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/nana-agent /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # 测试配置
sudo systemctl restart nginx
```

此时访问 `http://nana-quality-inspection-agent.top` 应该能看到网站。

---

## 第七步：配置HTTPS（免费SSL证书）

### 方式一：阿里云免费SSL证书（推荐新手）

1. 进入 [阿里云SSL证书控制台](https://yundun.console.aliyun.com/?p=cas)
2. 购买免费证书（DV单域名版，0元/年）
3. 填写域名 `nana-quality-inspection-agent.top`
4. 验证方式选择DNS（会自动添加TXT记录）
5. 签发后下载Nginx格式证书
6. 上传到服务器：
   ```bash
   sudo mkdir -p /etc/nginx/ssl
   # 上传 .pem 和 .key 文件
   sudo nano /etc/nginx/sites-available/nana-agent
   ```

修改Nginx配置为：

```nginx
server {
    listen 80;
    server_name nana-quality-inspection-agent.top www.nana-quality-inspection-agent.top;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name nana-quality-inspection-agent.top www.nana-quality-inspection-agent.top;

    ssl_certificate /etc/nginx/ssl/nana-agent.pem;
    ssl_certificate_key /etc/nginx/ssl/nana-agent.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 50M;

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
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 方式二：Let's Encrypt（自动续期）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d nana-quality-inspection-agent.top -d www.nana-quality-inspection-agent.top
# 按提示操作，自动配置HTTPS
# 证书90天有效，自动续期：sudo certbot renew --dry-run
```

---

## 第八步：阿里云安全组配置

1. 进入ECS控制台 → 安全组
2. 添加入方向规则：

| 端口范围 | 授权对象 | 说明 |
|----------|----------|------|
| 22/22 | 你的IP/32 | SSH |
| 80/80 | 0.0.0.0/0 | HTTP |
| 443/443 | 0.0.0.0/0 | HTTPS |

---

## 日常运维命令

```bash
# 查看应用状态
sudo systemctl status nana-agent

# 重启应用
sudo systemctl restart nana-agent

# 查看应用日志
sudo journalctl -u nana-agent -f

# 查看Nginx日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# 更新代码
cd /opt/nana-agent
git pull origin main
sudo systemctl restart nana-agent

# 备份数据库
cp /opt/nana-agent/regulations.db /opt/nana-agent/backup/regulations-$(date +%Y%m%d).db
```

---

## 备案说明

> ⚠️ **重要**：中国大陆的阿里云ECS需要域名备案才能通过80/443端口访问。

- 如果ECS在**中国大陆地域**：必须完成ICP备案（约7-20个工作日）
- 如果ECS在**中国香港/海外地域**：无需备案，可直接使用

备案流程：
1. [阿里云备案系统](https://beian.aliyun.com)
2. 提交身份证 + 域名证书 + 服务器信息
3. 通过初审后拍照核验
4. 等待管局审核

备案期间可以先用 `http://IP:5000` 临时访问。

---

## 一键部署脚本

将以下脚本保存为 `deploy.sh`，在服务器上执行：

```bash
#!/bin/bash
set -e

echo "🌸 娜娜的工程质量监督Agent — 一键部署"

# 安装依赖
sudo apt update && sudo apt install -y python3.11 python3.11-venv nginx git tesseract-ocr tesseract-ocr-chi-sim fonts-wqy-zenhei

# 部署应用
sudo mkdir -p /opt/nana-agent
sudo chown $USER:$USER /opt/nana-agent
cd /opt/nana-agent

if [ ! -d ".git" ]; then
    git clone https://github.com/chq20010205-arch/nana-quality-inspection-agent.git .
fi

python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt gunicorn

# 创建systemd服务
sudo tee /etc/systemd/system/nana-agent.service > /dev/null <<'EOF'
[Unit]
Description=Nana Quality Inspection Agent
After=network.target

[Service]
User=root
WorkingDirectory=/opt/nana-agent
Environment="PATH=/opt/nana-agent/venv/bin"
ExecStart=/opt/nana-agent/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:5000 --timeout 120 app:app
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable nana-agent
sudo systemctl restart nana-agent

echo "✅ 部署完成！"
echo "应用运行在: http://127.0.0.1:5000"
echo "下一步: 配置Nginx反向代理和域名解析"
```

---

## 部署检查清单

- [ ] ECS服务器已创建，记录公网IP
- [ ] 域名解析A记录已指向ECS公网IP
- [ ] 安全组开放22/80/443端口
- [ ] 服务器已安装Python 3.11 + Nginx + Gunicorn
- [ ] 代码已克隆到 /opt/nana-agent
- [ ] Gunicorn通过systemd自启动运行
- [ ] Nginx反向代理配置完成
- [ ] HTTPS证书已配置
- [ ] （如需）ICP备案已完成
- [ ] 访问 https://nana-quality-inspection-agent.top 验证
