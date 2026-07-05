# -*- coding: utf-8 -*-
"""
法律条文网络搜索模块
====================
支持：
1. 通过关键词在公开渠道搜索相关规范名称和条文信息
2. 使用LLM解析搜索结果，提取结构化规范数据

注意：由于DuckDuckGo等公开搜索引擎会更新反爬策略，
搜索功能可能因网络环境而受限。建议优先配置LLM以获得更好的解析效果。
"""

import re
import urllib.request
import urllib.parse
import urllib.error
import json
import ssl


def _create_ssl_context():
    """创建不验证证书的SSL上下文"""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def search_legal_provisions(keyword, max_results=5):
    """
    搜索法律/规范条文信息。

    参数:
        keyword: 搜索关键词，如"建筑防火通用规范 防火封堵"
        max_results: 最多返回几条结果

    返回:
        dict: {"results": [...], "source": "..."}
    """
    # 这里优先尝试 DuckDuckGo 的 lite 版（较少反爬）
    results = _search_duckduckgo(keyword, max_results)
    if results:
        return {"results": results, "source": "DuckDuckGo"}

    # 如果失败，返回 Bing 的简单搜索结果（标题+摘要）作为 fallback
    results = _search_bing(keyword, max_results)
    if results:
        return {"results": results, "source": "Bing"}

    return {"results": [], "source": "none", "message": "网络搜索暂时不可用，请稍后重试或直接粘贴规范内容"}


def _search_duckduckgo(keyword, max_results=5):
    """使用DuckDuckGo lite版搜索"""
    try:
        query = urllib.parse.quote_plus(keyword)
        url = f"https://duckduckgo.com/html/?q={query}"
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15, context=_create_ssl_context()) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        # 简单正则提取结果标题和摘要
        results = []
        # DuckDuckGo lite 结果通常包含 .result 块
        blocks = re.findall(
            r'<div class="result[^"]*"[^>]*>(.*?)</div>\s*</div>',
            html, re.S | re.I
        )
        for block in blocks[:max_results]:
            title_match = re.search(r'<a[^>]*class="result__a"[^>]*>(.*?)</a>', block, re.S | re.I)
            snippet_match = re.search(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', block, re.S | re.I)

            title = _strip_html(title_match.group(1)) if title_match else ""
            snippet = _strip_html(snippet_match.group(1)) if snippet_match else ""
            url_match = re.search(r'href="([^"]+)"', title_match.group(0) if title_match else "", re.I)
            link = urllib.parse.unquote(url_match.group(1)) if url_match else ""

            if title or snippet:
                results.append({
                    "title": title,
                    "snippet": snippet,
                    "url": link
                })

        return results
    except Exception as e:
        return []


def _search_bing(keyword, max_results=5):
    """Bing搜索结果简单提取（备用）"""
    try:
        query = urllib.parse.quote_plus(keyword)
        url = f"https://www.bing.com/search?q={query}&setmkt=zh-CN"
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15, context=_create_ssl_context()) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        results = []
        # 提取 Bing 结果标题和摘要
        items = re.findall(r'<li class="b_algo"[^>]*>(.*?)</li>', html, re.S | re.I)
        for item in items[:max_results]:
            title_match = re.search(r'<h2[^>]*>(.*?)</h2>', item, re.S | re.I)
            snippet_match = re.search(r'<p[^>]*>(.*?)</p>', item, re.S | re.I)
            title = _strip_html(title_match.group(1)) if title_match else ""
            snippet = _strip_html(snippet_match.group(1)) if snippet_match else ""
            if title or snippet:
                results.append({
                    "title": title,
                    "snippet": snippet,
                    "url": ""
                })

        return results
    except Exception:
        return []


def _strip_html(text):
    """去除HTML标签并清理空白"""
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def fetch_page_text(url, max_chars=20000):
    """
    尝试获取网页文本内容。
    使用简单启发式提取正文文本。
    """
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=20, context=_create_ssl_context()) as resp:
            raw = resp.read()

        # 尝试多种编码
        text = ""
        for encoding in ("utf-8", "gbk", "gb2312", "latin-1"):
            try:
                text = raw.decode(encoding, errors="ignore")
                if text and len(text) > 100:
                    break
            except Exception:
                continue

        # 去除script/style标签
        text = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', text, flags=re.I)
        text = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', text, flags=re.I)
        text = re.sub(r'<!--[\s\S]*?-->', '', text)
        # 去除标签但保留换行
        text = re.sub(r'<br\s*/?>', '\n', text, flags=re.I)
        text = re.sub(r'<p[^>]*>', '\n', text, flags=re.I)
        text = re.sub(r'</p>', '\n', text, flags=re.I)
        text = re.sub(r'<div[^>]*>', '\n', text, flags=re.I)
        text = re.sub(r'<[^>]+>', '', text)
        # 合并空行
        text = re.sub(r'\n\s*\n', '\n\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        # 去除HTML实体
        text = text.replace('&nbsp;', ' ').replace('&amp;', '&')
        text = text.replace('&lt;', '<').replace('&gt;', '>')
        text = text.replace('&quot;', '"').replace('&#39;', "'")
        return text[:max_chars].strip()
    except Exception:
        return ""


def parse_search_results_to_regulation(search_results, query, llm_adapter=None):
    """
    将搜索结果解析为结构化规范数据。

    如果配置了LLM，优先使用LLM解析；
    否则使用简单规则提取规范名称和编号。

    返回:
        dict: {"regulation": {...}, "raw_text": "..."}
    """
    # 合并搜索结果文本
    raw_text = f"搜索关键词：{query}\n\n"
    for r in search_results:
        raw_text += f"标题：{r.get('title', '')}\n"
        raw_text += f"摘要：{r.get('snippet', '')}\n\n"

    if llm_adapter and llm_adapter.is_ready():
        return _parse_with_llm(raw_text, llm_adapter)

    # 无LLM时的简单提取
    regulation = _simple_extract_regulation(raw_text)
    return {"regulation": regulation, "raw_text": raw_text}


def _parse_with_llm(raw_text, llm_adapter):
    """使用LLM解析搜索结果为规范JSON"""
    system_prompt = (
        "你是中国工程建设标准领域的专家。请根据以下搜索结果，"
        "提取出规范名称、编号、相关条款内容，并整理成结构化JSON。"
        "如果信息不足，可以只返回已提取到的部分。"
    )
    user_prompt = (
        f"{raw_text}\n\n"
        "请按以下JSON格式返回（只返回JSON，不要其他内容）：\n"
        "{\n"
        '  "name": "规范名称（必填）",\n'
        '  "code": "规范编号（必填）",\n'
        '  "full_name": "规范全称",\n'
        '  "category": "分类，如消防防火/建筑电气/结构安全等",\n'
        '  "is_mandatory": true 或 false,\n'
        '  "description": "规范简介",\n'
        '  "clauses": [\n'
        '    {\n'
        '      "clause_number": "条款号",\n'
        '      "clause_content": "条款内容",\n'
        '      "keywords": ["关键词1", "关键词2"]\n'
        '    }\n'
        '  ]\n'
        "}\n"
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    result = llm_adapter.chat(messages, temperature=0.2, max_tokens=2048)
    if "error" in result:
        return {"regulation": {}, "raw_text": raw_text, "error": result["error"]}

    content = result["content"].strip()
    if content.startswith("```"):
        lines = content.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        content = "\n".join(lines)

    try:
        regulation = json.loads(content)
    except json.JSONDecodeError:
        # 尝试提取JSON部分
        match = re.search(r'\{[\s\S]*\}', content)
        if match:
            try:
                regulation = json.loads(match.group())
            except json.JSONDecodeError:
                regulation = {}
        else:
            regulation = {}

    return {"regulation": regulation, "raw_text": raw_text}


def _simple_extract_regulation(text):
    """简单规则提取规范信息"""
    # 匹配 GB/GB/T/JGJ 等标准编号
    code_match = re.search(r'(GB\s?\d{4,5}[-–—]\d{4}|GB/T\s?\d{4,5}[-–—]\d{4}|JGJ\s?\d{2,3}[-–—]\d{4})', text)
    code = code_match.group(1) if code_match else "未知编号"

    # 尝试匹配规范名称（通常包含"规范"、"标准"、"通则"等）
    name = ""
    name_patterns = [
        r'《([^》]*(?:规范|标准|通则|规程|规则)[^》]*)》',
        r'([\u4e00-\u9fa5]{5,30}(?:规范|标准|通则|规程|规则))',
    ]
    for pat in name_patterns:
        m = re.search(pat, text)
        if m:
            name = m.group(1).strip()
            break

    return {
        "name": name or "未知名称",
        "code": code,
        "full_name": name or "未知名称",
        "category": "",
        "is_mandatory": code.startswith("GB ") and not code.startswith("GB/T"),
        "description": "",
        "clauses": []
    }
