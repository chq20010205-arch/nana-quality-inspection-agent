# 🔧 PDF上传BUG修复 — 服务器更新指南

## 问题诊断

线上网站 `nana-quality-inspection-agent.top` 存在3个BUG导致PDF无法上传：

### BUG 1: 308重定向导致POST请求失败
- 非www域名 → www域名 的308重定向会丢弃POST请求的body
- **症状**: 从 `nana-quality-inspection-agent.top` 上传PDF时请求失败

### BUG 2: PDF解析任务无限卡住
- 服务器上PyMuPDF/pypdf可能未安装或运行时阻塞
- 任务卡在15%（"正在提取PDF文本..."）超过70秒不返回
- **症状**: 上传后进度条一直不动，永远不完成

### BUG 3: 前端错误处理不足
- fetch请求未检查HTTP状态码
- 无轮询超时限制
- **症状**: 上传失败时没有明确错误提示

---

## 修复内容

| 文件 | 修复 |
|------|------|
| `pdf_parser.py` | PDF提取添加60秒线程超时，防止无限阻塞 |
| `app.py` | 任务超过5分钟自动标记失败，不再永久卡住 |
| `static/js/app.js` | fetch添加`redirect:'follow'`、HTTP状态检查、轮询超时限制 |
| `deploy/nginx.conf` | 非www和www共用server块，添加`port_in_redirect off` |
| `deploy/deploy.sh` | 同步更新Nginx配置 |

---

## 服务器更新步骤

SSH连接到阿里云ECS后执行：

```bash
# 1. 进入应用目录
cd /opt/nana-agent

# 2. 拉取最新代码
git pull origin main

# 3. 重启应用
sudo systemctl restart nana-agent

# 4. 更新Nginx配置（关键！）
sudo cp deploy/nginx.conf /etc/nginx/sites-available/nana-agent
sudo nginx -t
sudo systemctl reload nginx

# 5. 确认PyMuPDF已安装
source venv/bin/activate
python -c "import fitz; print('PyMuPDF版本:', fitz.version)"

# 如果上面报错，执行：
pip install PyMuPDF pypdf

# 6. 验证修复
curl -s https://www.nana-quality-inspection-agent.top/api/stats
```

---

## 验证PDF上传

更新完成后，在浏览器中测试：

1. 访问 `https://nana-quality-inspection-agent.top`
2. 进入「规章制度库」→「PDF导入」
3. 上传一个PDF文件
4. 观察进度条是否正常推进
5. 如果5分钟内未完成，会显示超时错误（而不是永远卡住）

---

## 如果仍然失败

### 检查服务器依赖

```bash
cd /opt/nana-agent
source venv/bin/activate
python -c "
from pdf_parser import extract_text_from_pdf
# 用一个小的PDF测试
result = extract_text_from_pdf(open('/path/to/test.pdf','rb').read())
print(result)
"
```

### 检查Nginx是否有重定向

```bash
# 测试非www域名的POST请求是否被重定向
curl -v -X POST https://nana-quality-inspection-agent.top/api/regulations/import/pdf 2>&1 | grep -i "location\|308\|301"
# 如果输出中包含301/308和Location头，说明Nginx仍在重定向
```

### 查看应用日志

```bash
sudo journalctl -u nana-agent -f
# 然后在前端上传PDF，观察日志输出
```
