# 🌸 娜娜的工程质量监督Agent

为住建局质监站科员开发的智能工具：输入现场巡视问题 → 自动匹配规章制度条款 → 生成整改通知书。

## ✨ 核心功能

1. **问题匹配** — 三种模式（关键词 / AI智能 / 混合模式），匹配数量3~50条可选
2. **规章制度库** — 查看/搜索/导入/添加/编辑/删除/批量操作，预载12部规范40条条款
3. **通知书生成** — 填写工程信息+问题清单 → 生成标准格式整改通知书 → 导出 Word/PDF
4. **AI功能** — AI匹配、AI问题分析、AI通知书润色、AI二次复核
5. **规范自动入库** — 在线搜索法律条文全文收录 / PDF AI深度解析整篇收录 / 手动粘贴AI解析
6. **匹配-通知书联动** — 匹配结果一键加入通知书

## 🛠️ 技术栈

- **后端**: Python Flask + SQLite
- **前端**: 原生 HTML/CSS/JS（少女奶油风）
- **LLM**: 支持智谱GLM / MiniMax / DeepSeek / 豆包（各家最新旗舰模型）
- **PDF解析**: PyMuPDF + pypdf + OCR + AI深度解析（智能分块逐条提取）
- **导出**: python-docx (Word) + fpdf2 (PDF)

## 🚀 快速开始

```bash
# 安装依赖
pip install -r requirements.txt

# 启动应用
python app.py

# 浏览器访问
# http://127.0.0.1:5000
```

或双击 `run.bat` 一键启动（Windows）。

## Vercel 上线配置

这个项目在 Vercel 上使用 `app.py` 作为 Python Serverless 入口。上线前请在 Vercel 项目的 Storage 中创建并连接：

1. Postgres/Neon 数据库：确保项目环境变量中存在 `DATABASE_URL` 或 `POSTGRES_URL`。规章制度、通知记录和大模型配置会持久化到这个数据库。
2. Blob 文件库：创建 Private Blob store，确保项目环境变量中存在 `BLOB_READ_WRITE_TOKEN`。
3. 管理员口令：手动添加 `FILE_ADMIN_TOKEN`，前端“后台文件库”会用它校验上传、下载和删除操作。

如果没有配置 Postgres，线上会临时退回 `/tmp` SQLite，只适合测试，冷启动或重新部署后数据可能丢失。

## 📁 项目结构

```
quality_inspection_agent/
├── app.py              # Flask主应用（路由、数据库、任务管理器）
├── llm_adapter.py      # LLM多模型适配器
├── pdf_parser.py       # PDF解析（PyMuPDF + OCR + AI深度解析）
├── web_search.py       # 法律条文网络搜索
├── requirements.txt    # Python依赖
├── run.bat             # Windows启动脚本
├── data/
│   └── regulations.json  # 预载规章制度数据
├── templates/
│   └── index.html      # Web界面
└── static/
    ├── css/style.css   # 少女奶油风样式
    └── js/app.js       # 前端交互逻辑
```

## 🤖 支持的大模型

| 提供商 | 旗舰模型 | 获取API Key |
|--------|----------|-------------|
| DeepSeek | deepseek-v4-pro | platform.deepseek.com |
| 智谱GLM | glm-5.2 | open.bigmodel.cn |
| MiniMax | MiniMax-M1 | platform.minimaxi.com |
| 豆包 | doubao-1.5-pro-256k | console.volcengine.com |

## 📄 License

MIT
