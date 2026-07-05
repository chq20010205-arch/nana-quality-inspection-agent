# -*- coding: utf-8 -*-
"""
PDF 规范条文提取模块（增强版）
================================
支持：
1. 使用 PyMuPDF (fitz) 提取 PDF 全文（不限页数）
2. 智能分块策略：将长文档按条款边界切分为多个块
3. AI 逐块深度解析：每个分块单独调用 LLM 提取条款
4. 合并去重：将所有分块的条款合并为完整的规范数据
5. 扫描版 PDF 支持：自动检测并渲染图片供 OCR
6. OCR 识别：使用 tesseract 对扫描版进行文字识别
"""

import re
import io
import json


# ============================================================
# PDF 文本提取
# ============================================================

def extract_text_from_pdf(file_bytes):
    """
    从PDF文件中提取全文文本（不限页数）。

    尝试顺序：
    1. PyMuPDF (fitz) - 主引擎
    2. pypdf - 备用引擎
    3. 扫描版检测 + 图片渲染

    返回:
        dict: {"text", "pages", "engine", "error", "need_ocr", "images"}
    """
    # 尝试 PyMuPDF
    result = _extract_with_pymupdf(file_bytes)
    if result["text"] and len(result["text"].strip()) > 50:
        return result

    # 尝试 pypdf
    result2 = _extract_with_pypdf(file_bytes)
    if result2["text"] and len(result2["text"].strip()) > 50:
        return result2

    # 扫描版PDF，渲染图片
    img_result = _render_pages_to_images(file_bytes, max_pages=10)
    if img_result.get("images"):
        return {
            "text": "",
            "pages": img_result["pages"],
            "error": "该PDF为扫描版（图片型PDF），文字无法直接提取。可尝试使用OCR识别。",
            "engine": "image_render",
            "images": img_result["images"],
            "need_ocr": True,
        }

    return {
        "text": result.get("text", "") or result2.get("text", ""),
        "pages": result.get("pages", 0),
        "error": result.get("error") or result2.get("error") or "PDF文本提取失败，文件可能已损坏",
        "engine": "none",
    }


def _extract_with_pymupdf(file_bytes):
    """使用 PyMuPDF (fitz) 提取全文"""
    try:
        import fitz
    except ImportError:
        return {"text": "", "pages": 0, "error": "PyMuPDF未安装", "engine": "pymupdf"}

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages = doc.page_count
        text_parts = []
        for page in doc:
            try:
                text = page.get_text("text") or ""
                text_parts.append(text.strip())
            except Exception:
                pass
        doc.close()
        full_text = "\n\n".join(text_parts).strip()
        return {"text": full_text, "pages": pages, "engine": "pymupdf"}
    except Exception as e:
        return {"text": "", "pages": 0, "error": f"PyMuPDF解析失败: {str(e)}", "engine": "pymupdf"}


def _extract_with_pypdf(file_bytes):
    """使用 pypdf 备用引擎"""
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader
        except ImportError:
            return {"text": "", "pages": 0, "error": "pypdf未安装", "engine": "pypdf"}

    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        pages = len(reader.pages)
        text_parts = []
        for page in reader.pages:
            try:
                text = page.extract_text() or ""
                text_parts.append(text)
            except Exception:
                pass
        full_text = "\n".join(text_parts).strip()
        return {"text": full_text, "pages": pages, "engine": "pypdf"}
    except Exception as e:
        return {"text": "", "pages": 0, "error": f"pypdf解析失败: {str(e)}", "engine": "pypdf"}


def _render_pages_to_images(file_bytes, max_pages=10):
    """渲染PDF页面为base64图片"""
    try:
        import fitz
        import base64
    except ImportError:
        return {"images": [], "pages": 0}

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        total_pages = doc.page_count
        images = []
        for i in range(min(total_pages, max_pages)):
            page = doc[i]
            mat = fitz.Matrix(200 / 72, 200 / 72)
            pix = page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes("png")
            img_b64 = base64.b64encode(img_bytes).decode("utf-8")
            images.append({"page": i + 1, "image": f"data:image/png;base64,{img_b64}"})
        doc.close()
        return {"images": images, "pages": total_pages}
    except Exception:
        return {"images": [], "pages": 0}


def ocr_pdf_images(file_bytes, max_pages=50):
    """对PDF全部页面进行OCR识别"""
    try:
        import fitz
    except ImportError:
        return {"text": "", "pages": 0, "error": "PyMuPDF未安装"}

    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return {
            "text": "", "pages": 0,
            "error": "OCR依赖未安装。请运行：pip install pytesseract Pillow，并安装 tesseract-ocr 程序。"
        }

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        total_pages = doc.page_count
        actual_pages = min(total_pages, max_pages)
        text_parts = []

        for i in range(actual_pages):
            page = doc[i]
            mat = fitz.Matrix(300 / 72, 300 / 72)
            pix = page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes("png")
            img = Image.open(io.BytesIO(img_bytes))
            text = pytesseract.image_to_string(img, lang="chi_sim+eng")
            text_parts.append(text.strip())

        doc.close()
        full_text = "\n\n".join(text_parts).strip()
        return {"text": full_text, "pages": total_pages, "engine": "ocr"}
    except Exception as e:
        error_msg = str(e)
        if "tesseract" in error_msg.lower():
            return {
                "text": "", "pages": 0,
                "error": "tesseract-ocr 程序未安装。请从 https://github.com/UB-Mannheim/tesseract/wiki 下载安装。"
            }
        return {"text": "", "pages": 0, "error": f"OCR识别失败: {error_msg}"}


# ============================================================
# 智能分块策略
# ============================================================

def smart_chunk_text(full_text, chunk_size=4000, overlap=200):
    """
    将长文本智能切分为多个块。

    策略：
    1. 优先在章节边界切分（"第X章"、"X.X.X" 条款编号处）
    2. 如果找不到边界，按固定长度切分
    3. 块之间有少量重叠，避免截断条款

    参数:
        full_text: 完整文本
        chunk_size: 每块最大字符数
        overlap: 块之间的重叠字符数

    返回:
        list: [{"text": "块文本", "start_pos": 起始位置, "end_pos": 结束位置}]
    """
    if not full_text or len(full_text) <= chunk_size:
        return [{"text": full_text or "", "start_pos": 0, "end_pos": len(full_text or "")}]

    chunks = []
    pos = 0
    text_len = len(full_text)

    while pos < text_len:
        end_pos = min(pos + chunk_size, text_len)

        # 如果不是最后一块，尝试在边界处切分
        if end_pos < text_len:
            # 在 [end_pos - overlap, end_pos] 范围内寻找最佳切分点
            search_start = max(pos + chunk_size - overlap, pos + 100)

            # 优先在章节标题处切分
            best_cut = _find_best_split_point(full_text, search_start, end_pos)
            if best_cut > 0:
                end_pos = best_cut

        chunk_text = full_text[pos:end_pos].strip()
        if chunk_text:
            chunks.append({
                "text": chunk_text,
                "start_pos": pos,
                "end_pos": end_pos,
            })

        # 下一块从当前结束位置开始（不加overlap，因为我们在边界切分）
        if end_pos >= text_len:
            break
        pos = end_pos

    return chunks


def _find_best_split_point(text, search_start, search_end):
    """
    在 [search_start, search_end] 范围内寻找最佳切分点。

    优先级：
    1. 章节标题 "第X章" / "第X节"
    2. 条款编号 "X.X.X" 开头的行
    3. 空行（段落分隔）
    4. 句号结尾
    """
    search_region = text[search_start:search_end]

    # 1. 章节标题
    for pattern in [
        r'\n\s*第[一二三四五六七八九十百\d]+章',
        r'\n\s*第[一二三四五六七八九十百\d]+节',
    ]:
        matches = list(re.finditer(pattern, search_region))
        if matches:
            return search_start + matches[-1].start()

    # 2. 条款编号行开头
    clause_matches = list(re.finditer(r'\n\s*(\d+(?:\.\d+){0,3})\s', search_region))
    if clause_matches:
        return search_start + clause_matches[-1].start()

    # 3. 空行
    blank_matches = list(re.finditer(r'\n\s*\n', search_region))
    if blank_matches:
        return search_start + blank_matches[-1].end()

    # 4. 句号
    period_matches = list(re.finditer(r'[。；！？\.]\s', search_region))
    if period_matches:
        return search_start + period_matches[-1].end()

    return 0  # 没找到好切分点


# ============================================================
# AI 深度解析（分块逐条提取）
# ============================================================

def parse_pdf_full_deep(full_text, llm_adapter, on_progress=None, cancel_check=None):
    """
    对 PDF 全文进行 AI 深度解析，提取所有条款。

    流程：
    1. 智能分块
    2. 第一块：提取规范元信息 + 条款
    3. 后续块：只提取条款
    4. 合并去重所有条款

    参数:
        full_text: PDF全文
        llm_adapter: LLM适配器
        on_progress: 进度回调函数 callback(chunk_idx, total_chunks, clauses_so_far)
        cancel_check: 取消检查函数，返回True时终止解析

    返回:
        dict: {"regulation": {...}, "raw_text": "...", "chunks": 块数, "clauses_count": 条款数}
    """
    if not full_text or not full_text.strip():
        return {"regulation": {}, "raw_text": "", "chunks": 0, "clauses_count": 0}

    if not llm_adapter or not llm_adapter.is_ready():
        # 无LLM，用规则提取
        regulation = _simple_extract_from_pdf(full_text)
        return {
            "regulation": regulation,
            "raw_text": full_text[:8000],
            "chunks": 1,
            "clauses_count": len(regulation.get("clauses", [])),
            "engine": "rule",
        }

    # 智能分块
    chunks = smart_chunk_text(full_text, chunk_size=4000, overlap=300)
    total_chunks = len(chunks)

    regulation = {
        "name": "",
        "code": "",
        "full_name": "",
        "category": "",
        "is_mandatory": False,
        "description": "",
        "clauses": [],
    }
    all_clauses = []
    seen_clause_numbers = set()
    errors = []

    for idx, chunk in enumerate(chunks):
        # 检查是否被取消
        if cancel_check and cancel_check():
            return {
                "regulation": regulation,
                "raw_text": full_text[:8000],
                "chunks": total_chunks,
                "clauses_count": len(all_clauses),
                "errors": errors,
                "cancelled": True,
                "engine": "ai_deep",
            }

        is_first = (idx == 0)

        try:
            if is_first:
                # 第一块：提取元信息 + 条款
                chunk_result = _parse_chunk_with_llm(
                    chunk["text"], llm_adapter, extract_meta=True
                )
                if chunk_result.get("regulation"):
                    reg = chunk_result["regulation"]
                    # 填充元信息
                    if reg.get("name"):
                        regulation["name"] = reg["name"]
                    if reg.get("code"):
                        regulation["code"] = reg["code"]
                    if reg.get("full_name"):
                        regulation["full_name"] = reg["full_name"]
                    if reg.get("category"):
                        regulation["category"] = reg["category"]
                    if "is_mandatory" in reg:
                        regulation["is_mandatory"] = reg["is_mandatory"]
                    if reg.get("description"):
                        regulation["description"] = reg["description"]
            else:
                # 后续块：只提取条款
                chunk_result = _parse_chunk_with_llm(
                    chunk["text"], llm_adapter, extract_meta=False
                )

            # 合并条款
            chunk_clauses = chunk_result.get("regulation", {}).get("clauses", [])
            for c in chunk_clauses:
                clause_num = c.get("clause_number", "").strip()
                # 去重
                if clause_num and clause_num in seen_clause_numbers:
                    continue
                if clause_num:
                    seen_clause_numbers.add(clause_num)

                # 确保条款内容完整
                content = c.get("clause_content", "").strip()
                if not content or len(content) < 3:
                    continue

                # 自动生成关键词如果缺失
                if not c.get("keywords"):
                    c["keywords"] = _auto_extract_keywords(content)

                all_clauses.append(c)

            if chunk_result.get("error"):
                errors.append(f"块{idx + 1}: {chunk_result['error']}")

        except Exception as e:
            errors.append(f"块{idx + 1}解析异常: {str(e)}")

        # 进度回调
        if on_progress:
            on_progress(idx + 1, total_chunks, len(all_clauses))

    # 如果第一块没提取到元信息，用规则补
    if not regulation["name"]:
        simple = _simple_extract_from_pdf(full_text[:2000])
        regulation["name"] = simple.get("name", "未知名称")
        regulation["code"] = simple.get("code", "未知编号")
        regulation["full_name"] = simple.get("full_name", regulation["name"])

    regulation["clauses"] = all_clauses

    return {
        "regulation": regulation,
        "raw_text": full_text[:8000],
        "chunks": total_chunks,
        "clauses_count": len(all_clauses),
        "errors": errors,
        "engine": "ai_deep",
    }


def _parse_chunk_with_llm(chunk_text, llm_adapter, extract_meta=True):
    """
    解析单个文本块。

    参数:
        chunk_text: 文本块
        llm_adapter: LLM适配器
        extract_meta: 是否提取规范元信息（名称、编号等）
    """
    if extract_meta:
        system_prompt = (
            "你是中国工程建设标准领域的专家。请从以下PDF文本片段中提取规范信息和所有可识别的条款。\n"
            "要求：\n"
            "1. 提取规范名称、编号、分类等元信息\n"
            "2. 逐条提取所有条款，包括条款号和完整条款内容\n"
            "3. 为每条条款生成3-5个关键词\n"
            "4. 不要遗漏任何条款\n"
            "5. 条款内容要完整，不要截断\n"
        )
        meta_instruction = (
            '  "name": "规范名称",\n'
            '  "code": "规范编号，如GB 55037-2022",\n'
            '  "full_name": "规范全称",\n'
            '  "category": "分类：消防防火/消防给水/消防电气/防烟排烟/疏散设施/建筑电气/结构安全/给排水/建筑节能",\n'
            '  "is_mandatory": true或false,\n'
            '  "description": "规范简介",\n'
        )
    else:
        system_prompt = (
            "你是中国工程建设标准领域的专家。请从以下PDF文本片段中提取所有可识别的条款。\n"
            "要求：\n"
            "1. 只提取条款，不需要规范名称等元信息\n"
            "2. 逐条提取所有条款，包括条款号和完整条款内容\n"
            "3. 为每条条款生成3-5个关键词\n"
            "4. 不要遗漏任何条款\n"
            "5. 条款内容要完整，不要截断\n"
        )
        meta_instruction = ""

    user_prompt = (
        f"{chunk_text}\n\n"
        "请按以下JSON格式返回（只返回JSON，不要其他内容）：\n"
        "{\n"
        f'{meta_instruction}'
        '  "clauses": [\n'
        '    {\n'
        '      "clause_number": "条款号，如6.3.4",\n'
        '      "clause_content": "条款完整内容",\n'
        '      "keywords": ["关键词1", "关键词2", "关键词3"]\n'
        '    }\n'
        '  ]\n'
        "}\n"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    result = llm_adapter.chat(messages, temperature=0.1, max_tokens=8192)
    if "error" in result:
        return {"regulation": {}, "error": result["error"]}

    content = result["content"].strip()
    # 去除markdown代码块标记
    if content.startswith("```"):
        lines = content.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        content = "\n".join(lines)

    regulation = _safe_json_parse(content)

    return {"regulation": regulation}


def _safe_json_parse(text):
    """安全解析JSON，尝试多种方式"""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 尝试提取最外层 {}
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # 尝试修复常见JSON问题
    cleaned = text
    cleaned = re.sub(r',\s*}', '}', cleaned)  # 尾部逗号
    cleaned = re.sub(r',\s*]', ']', cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    return {}


def _auto_extract_keywords(content):
    """从条款内容自动提取关键词"""
    # 去除标点和数字
    text = re.sub(r'[^\u4e00-\u9fa5a-zA-Z]', ' ', content)
    words = text.split()

    # 过滤太短的词
    keywords = [w for w in words if len(w) >= 2]

    # 去重并取前5个
    seen = set()
    result = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            result.append(kw)
        if len(result) >= 5:
            break

    return result


# ============================================================
# 兼容旧接口
# ============================================================

def parse_pdf_text_to_regulation(pdf_text, llm_adapter=None):
    """
    将PDF文本解析为结构化规范数据（兼容旧接口）。
    内部调用 parse_pdf_full_deep 实现全文解析。
    """
    if not pdf_text or not pdf_text.strip():
        return {"regulation": {}, "raw_text": ""}

    result = parse_pdf_full_deep(pdf_text, llm_adapter)
    return {
        "regulation": result.get("regulation", {}),
        "raw_text": result.get("raw_text", ""),
    }


def _simple_extract_from_pdf(text):
    """从PDF文本中简单规则提取规范信息"""
    code_match = re.search(
        r'(GB\s?\d{4,5}[-–—]\d{4}|GB/T\s?\d{4,5}[-–—]\d{4}|JGJ\s?\d{2,3}[-–—]\d{4})',
        text,
    )
    code = code_match.group(1) if code_match else "未知编号"

    lines = [l.strip() for l in text.splitlines() if l.strip()]
    name = ""
    for line in lines[:10]:
        if "规范" in line or "标准" in line or "通则" in line or "规程" in line:
            name = line.replace("中华人民共和国", "").strip()
            break

    # 规则提取条款
    clauses = []
    clause_pattern = re.compile(
        r'(?:^|\n)\s*(\d+(?:\.\d+){1,3})\s+([\s\S]*?)(?=\n\s*\d+(?:\.\d+){1,3}\s|\Z)'
    )
    for m in clause_pattern.finditer(text):
        clause_num = m.group(1).strip()
        clause_content = re.sub(r'\s+', ' ', m.group(2)).strip()
        if len(clause_content) > 5:
            clauses.append({
                "clause_number": clause_num,
                "clause_content": clause_content[:500],
                "keywords": _auto_extract_keywords(clause_content),
            })
        if len(clauses) >= 200:
            break

    return {
        "name": name or "未知名称",
        "code": code,
        "full_name": name or "未知名称",
        "category": "",
        "is_mandatory": code.startswith("GB ") and not code.startswith("GB/T"),
        "description": "",
        "clauses": clauses,
    }
