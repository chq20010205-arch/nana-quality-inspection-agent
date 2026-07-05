# -*- coding: utf-8 -*-
"""
多LLM适配器模块
==================
统一适配 智谱GLM / MiniMax / DeepSeek / 豆包 四类大模型。
所有模型均采用 OpenAI 兼容的 chat/completions 接口格式，
差异仅在于 base_url、model 名称和鉴权方式。

使用方式:
    adapter = LLMAdapter()
    adapter.configure("deepseek", api_key="sk-xxx")
    response = adapter.chat("你好")
"""

import json
import os
import urllib.request
import urllib.error
import ssl

# ==============================================================================
# 预置模型提供商配置
# ==============================================================================
PROVIDER_PRESETS = {
    "deepseek": {
        "label": "DeepSeek (深度求索)",
        "base_url": "https://api.deepseek.com/v1/chat/completions",
        "models": [
            {"id": "deepseek-chat", "label": "DeepSeek-V3 (通用对话)", "max_tokens": 8192},
            {"id": "deepseek-reasoner", "label": "DeepSeek-R1 (推理模型)", "max_tokens": 8192},
            {"id": "deepseek-v4-pro", "label": "DeepSeek-V4 Pro (最强旗舰)", "max_tokens": 16384},
            {"id": "deepseek-v4", "label": "DeepSeek-V4 (新一代标准)", "max_tokens": 8192},
        ],
        "default_model": "deepseek-chat",
        "doc_url": "https://platform.deepseek.com/api_keys",
        "note": "V4 Pro为最新旗舰模型，推理能力最强；注册即送500万token免费额度",
    },
    "zhipu": {
        "label": "智谱GLM (ChatGLM)",
        "base_url": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "models": [
            {"id": "glm-5.2", "label": "GLM-5.2 (最新旗舰)", "max_tokens": 16384},
            {"id": "glm-5", "label": "GLM-5 (新一代标准)", "max_tokens": 8192},
            {"id": "glm-4-plus", "label": "GLM-4-Plus (增强版)", "max_tokens": 8192},
            {"id": "glm-4-flash", "label": "GLM-4-Flash (免费)", "max_tokens": 4096},
            {"id": "glm-4-long", "label": "GLM-4-Long (超长文本)", "max_tokens": 32768},
        ],
        "default_model": "glm-4-flash",
        "doc_url": "https://open.bigmodel.cn/usercenter/apikeys",
        "note": "GLM-5.2为最新旗舰模型；glm-4-flash 完全免费，适合高频调用",
    },
    "minimax": {
        "label": "MiniMax (稀宇科技)",
        "base_url": "https://api.minimax.chat/v1/text/chatcompletion_v2",
        "models": [
            {"id": "MiniMax-M1", "label": "MiniMax-M1 (最新旗舰)", "max_tokens": 16384},
            {"id": "MiniMax-Text-01", "label": "MiniMax-Text-01 (推理增强)", "max_tokens": 16384},
            {"id": "abab6.5s-chat", "label": "ABAB 6.5s (轻量版)", "max_tokens": 8192},
            {"id": "abab6.5-chat", "label": "ABAB 6.5 (标准版)", "max_tokens": 8192},
        ],
        "default_model": "abab6.5s-chat",
        "doc_url": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
        "note": "M1为最新旗舰模型，支持超长上下文，多模态能力强",
    },
    "doubao": {
        "label": "豆包 (字节火山引擎)",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
        "models": [
            {"id": "doubao-1.5-pro-256k", "label": "Doubao-1.5-Pro-256k (最新旗舰)", "max_tokens": 16384},
            {"id": "doubao-1.5-pro-32k", "label": "Doubao-1.5-Pro-32k (新一代标准)", "max_tokens": 8192},
            {"id": "doubao-1.5-lite-32k", "label": "Doubao-1.5-Lite-32k (轻量版)", "max_tokens": 4096},
            {"id": "doubao-pro-128k", "label": "Doubao-Pro-128k (长文本)", "max_tokens": 8192},
        ],
        "default_model": "doubao-1.5-pro-32k",
        "doc_url": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
        "note": "1.5-Pro为最新旗舰；需在火山引擎控制台创建推理接入点，model填接入点ID或模型名",
    },
}


class LLMAdapter:
    """多LLM统一适配器"""

    def __init__(self, config_path=None):
        self.config_path = config_path or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "data", "llm_config.json"
        )
        self.config = self._load_config()

    # ==========================================================================
    # 配置管理
    # ==========================================================================
    def _load_config(self):
        """从文件加载配置"""
        default_config = {
            "provider": "",
            "api_key": "",
            "model": "",
            "temperature": 0.3,
            "max_tokens": 2048,
            "enabled": False,
        }
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    default_config.update(saved)
            except (json.JSONDecodeError, IOError):
                pass
        return default_config

    def _save_config(self):
        """保存配置到文件"""
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(self.config, f, ensure_ascii=False, indent=2)

    def get_config(self):
        """获取当前配置（隐藏API Key中间部分）"""
        cfg = dict(self.config)
        if cfg.get("api_key") and len(cfg["api_key"]) > 10:
            key = cfg["api_key"]
            cfg["api_key_masked"] = key[:4] + "*" * (len(key) - 8) + key[-4:]
        else:
            cfg["api_key_masked"] = cfg.get("api_key", "")
        return cfg

    def get_providers(self):
        """获取所有预置提供商信息"""
        return PROVIDER_PRESETS

    def update_config(self, provider, api_key, model=None, **kwargs):
        """更新配置"""
        self.config["provider"] = provider
        self.config["api_key"] = api_key

        if model:
            self.config["model"] = model
        elif provider in PROVIDER_PRESETS:
            self.config["model"] = PROVIDER_PRESETS[provider]["default_model"]

        if "temperature" in kwargs:
            self.config["temperature"] = float(kwargs["temperature"])
        if "max_tokens" in kwargs:
            self.config["max_tokens"] = int(kwargs["max_tokens"])
        if "enabled" in kwargs:
            self.config["enabled"] = bool(kwargs["enabled"])

        self._save_config()
        return self.config

    def set_enabled(self, enabled):
        """启用/禁用LLM"""
        self.config["enabled"] = bool(enabled)
        self._save_config()

    def is_ready(self):
        """检查LLM是否可用"""
        return (
            self.config.get("enabled", False)
            and self.config.get("provider")
            and self.config.get("api_key")
            and self.config.get("model")
        )

    # ==========================================================================
    # API 调用
    # ==========================================================================
    def chat(self, messages, temperature=None, max_tokens=None):
        """
        调用LLM对话接口

        参数:
            messages: 消息列表 [{"role": "system"/"user"/"assistant", "content": "..."}]
            temperature: 温度参数（覆盖配置）
            max_tokens: 最大token数（覆盖配置）

        返回:
            dict: {"content": "回复文本", "usage": {...}, "raw": {...}}
            失败时返回: {"error": "错误信息"}
        """
        if not self.is_ready():
            return {"error": "LLM未配置或未启用，请在设置中配置API Key并启用"}

        provider = self.config["provider"]
        if provider not in PROVIDER_PRESETS:
            return {"error": f"不支持的提供商: {provider}"}

        preset = PROVIDER_PRESETS[provider]
        base_url = preset["base_url"]
        api_key = self.config["api_key"]
        model = self.config["model"]

        # 构建请求体（OpenAI兼容格式）
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature if temperature is not None else self.config.get("temperature", 0.3),
            "max_tokens": max_tokens or self.config.get("max_tokens", 2048),
        }

        # 豆包模型特殊处理：如果api_key以"ep-"开头，说明是接入点ID
        if provider == "doubao" and not model.startswith("ep-"):
            # 豆包可以用模型名或接入点ID
            pass

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

        # MiniMax 需要额外处理
        if provider == "minimax":
            # MiniMax v2 接口兼容 OpenAI 格式，但某些参数名不同
            pass

        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(base_url, data=data, headers=headers, method="POST")

            # 创建不验证证书的SSL上下文（兼容某些环境）
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                result = json.loads(resp.read().decode("utf-8"))

                # 提取回复内容（统一OpenAI兼容格式）
                content = ""
                if "choices" in result and len(result["choices"]) > 0:
                    choice = result["choices"][0]
                    if "message" in choice:
                        content = choice["message"].get("content", "")
                    elif "text" in choice:
                        content = choice["text"]

                usage = result.get("usage", {})

                return {
                    "content": content,
                    "usage": usage,
                    "model": model,
                    "provider": provider,
                }

        except urllib.error.HTTPError as e:
            error_body = ""
            try:
                error_body = e.read().decode("utf-8")
                error_json = json.loads(error_body)
                error_msg = error_json.get("error", {}).get("message", error_body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                error_msg = error_body or str(e)
            return {"error": f"API请求失败 (HTTP {e.code}): {error_msg}"}

        except urllib.error.URLError as e:
            return {"error": f"网络请求失败: {str(e.reason)}"}

        except Exception as e:
            return {"error": f"调用异常: {str(e)}"}

    # ==========================================================================
    # 测试连接
    # ==========================================================================
    def test_connection(self):
        """测试LLM连接是否正常"""
        if not self.config.get("provider") or not self.config.get("api_key"):
            return {"success": False, "message": "请先配置提供商和API Key"}

        test_messages = [
            {"role": "user", "content": "请回复'连接成功'四个字。"},
        ]

        result = self.chat(test_messages, max_tokens=50)

        if "error" in result:
            return {"success": False, "message": result["error"]}
        else:
            return {
                "success": True,
                "message": f"连接成功！模型回复: {result['content'][:50]}",
                "model": result.get("model", ""),
                "provider": result.get("provider", ""),
            }

    # ==========================================================================
    # 业务场景：AI增强匹配
    # ==========================================================================
    def ai_match(self, problem_text, clauses_data):
        """
        使用LLM进行AI增强匹配

        将问题描述和数据库中所有条款摘要发给LLM，让LLM判断最匹配的条款。

        参数:
            problem_text: 问题描述
            clauses_data: 数据库中所有条款的列表

        返回:
            dict: {"matched": [...], "analysis": "..."} 或 {"error": "..."}
        """
        if not self.is_ready():
            return {"error": "LLM未启用"}

        # 构建条款索引摘要（控制token数量）
        clauses_summary = []
        for i, c in enumerate(clauses_data):
            summary = (
                f"[{i}] 《{c.get('reg_full_name', c.get('reg_name', ''))}》"
                f"{c.get('reg_code', '')} 第{c.get('clause_number', '')}条 | "
                f"关键词: {c.get('keywords', '')} | "
                f"内容: {c.get('clause_content', '')[:80]}"
            )
            clauses_summary.append(summary)

        clauses_text = "\n".join(clauses_summary)

        system_prompt = (
            "你是建筑工程质量监督领域的专家。你的任务是根据现场巡视发现的问题描述，"
            "从给定的规章制度条款库中找出最匹配的条款。\n\n"
            "请严格按照以下JSON格式回复，不要包含其他内容：\n"
            '{\n'
            '  "matches": [\n'
            '    {\n'
            '      "index": 条款在列表中的序号,\n'
            '      "relevance": "高/中/低",\n'
            '      "reason": "匹配理由"\n'
            '    }\n'
            '  ],\n'
            '  "analysis": "对问题的整体分析，包括问题性质、可能的安全隐患、整改建议"\n'
            '}\n\n'
            "最多返回5条匹配，按相关性从高到低排序。"
            "只返回JSON，不要有markdown代码块标记。"
        )

        user_prompt = (
            f"现场问题描述：\n{problem_text}\n\n"
            f"规章制度条款库：\n{clauses_text}\n\n"
            f"请找出与该问题最匹配的条款并返回JSON。"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        result = self.chat(messages, temperature=0.1, max_tokens=2048)

        if "error" in result:
            return result

        content = result["content"].strip()

        # 清理可能的markdown代码块标记
        if content.startswith("```"):
            lines = content.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            content = "\n".join(lines)

        try:
            ai_result = json.loads(content)
        except json.JSONDecodeError:
            # 尝试提取JSON部分
            import re
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                try:
                    ai_result = json.loads(json_match.group())
                except json.JSONDecodeError:
                    return {
                        "error": "AI返回格式解析失败",
                        "raw_response": content,
                    }
            else:
                return {
                    "error": "AI返回格式解析失败",
                    "raw_response": content,
                }

        # 将AI匹配结果与数据库条款关联
        matched_clauses = []
        for m in ai_result.get("matches", []):
            idx = m.get("index", -1)
            if 0 <= idx < len(clauses_data):
                clause = clauses_data[idx]
                matched_clauses.append({
                    "clause_id": clause.get("id"),
                    "regulation_name": clause.get("reg_name", ""),
                    "regulation_code": clause.get("reg_code", ""),
                    "regulation_full_name": clause.get("reg_full_name", clause.get("reg_name", "")),
                    "is_mandatory_reg": bool(clause.get("reg_mandatory", 0)),
                    "clause_number": clause.get("clause_number", ""),
                    "clause_content": clause.get("clause_content", ""),
                    "clause_category": clause.get("category", ""),
                    "keywords": clause.get("keywords", "").split(",") if clause.get("keywords") else [],
                    "ai_relevance": m.get("relevance", ""),
                    "ai_reason": m.get("reason", ""),
                    "match_source": "ai",
                })

        return {
            "matched": matched_clauses,
            "analysis": ai_result.get("analysis", ""),
            "usage": result.get("usage", {}),
        }

    # ==========================================================================
    # 业务场景：AI问题分析
    # ==========================================================================
    def ai_analyze(self, problem_text, matched_clauses=None):
        """
        使用LLM对问题进行深度分析

        参数:
            problem_text: 问题描述
            matched_clauses: 已匹配的条款列表（可选）

        返回:
            dict: {"analysis": "...", "suggestions": "..."} 或 {"error": "..."}
        """
        if not self.is_ready():
            return {"error": "LLM未启用"}

        clauses_text = ""
        if matched_clauses:
            clauses_text = "\n\n已匹配的规范条款：\n"
            for m in matched_clauses[:3]:
                clauses_text += (
                    f"- 《{m.get('regulation_full_name', '')}》"
                    f"{m.get('regulation_code', '')} 第{m.get('clause_number', '')}条\n"
                    f"  内容: {m.get('clause_content', '')}\n"
                )

        system_prompt = (
            "你是建筑工程质量监督领域的资深专家，具有丰富的现场巡视和整改经验。"
            "请对以下现场发现的问题进行专业分析。"
        )

        user_prompt = (
            f"现场问题描述：\n{problem_text}\n"
            f"{clauses_text}\n\n"
            "请从以下方面进行分析：\n"
            "1. 问题性质与严重程度\n"
            "2. 可能存在的安全隐患\n"
            "3. 整改建议与注意事项\n"
            "4. 验收要点\n\n"
            "请用专业但易懂的语言回答。"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        result = self.chat(messages, temperature=0.4, max_tokens=2048)

        if "error" in result:
            return result

        return {
            "analysis": result["content"],
            "usage": result.get("usage", {}),
        }

    # ==========================================================================
    # 业务场景：AI通知书二次复核
    # ==========================================================================
    def ai_review_notice(self, problems, project_info):
        """
        生成通知书前，由AI进行二次复核。

        复核两个内容：
        1. 相关问题是否可以对应正确的条文条例
        2. 检索是否有 typo（错别字、标点、格式错误等）

        参数:
            problems: 问题列表，每个包含 description 和 matches
            project_info: 工程信息字典

        返回:
            dict: {"pass": bool, "items": [...], "summary": "..."} 或 {"error": "..."}
        """
        if not self.is_ready():
            return {"error": "LLM未启用"}

        # 构建复核材料
        items_text = ""
        for i, prob in enumerate(problems, 1):
            desc = prob.get("description", "")
            items_text += f"\n问题{i}：{desc}\n"
            matches = prob.get("matches", [])
            if matches:
                for j, m in enumerate(matches[:3], 1):
                    items_text += (
                        f"  匹配{j}："
                        f"《{m.get('regulation_full_name', '')}》"
                        f"{m.get('regulation_code', '')} 第{m.get('clause_number', '')}条\n"
                        f"  内容：{m.get('clause_content', '')[:100]}\n"
                    )
            else:
                items_text += "  无匹配条款\n"

        system_prompt = (
            "你是建设工程质量监督领域的资深专家，负责在出具整改通知书前对文本进行二次复核。"
            "请严格检查以下两项：\n"
            "1. 每个问题与所引用规范条款的对应关系是否正确、恰当；\n"
            "2. 全文是否存在 typo（错别字、错用标点、缺字漏字、格式错误等）。\n\n"
            "请只返回以下JSON格式，不要包含任何其他解释：\n"
            "{\n"
            '  "pass": true/false,  // 全部通过为true，否则false\n'
            '  "items": [\n'
            '    {\n'
            '      "problem_index": 1,\n'
            '      "problem": "原始问题描述",\n'
            '      "corrected_problem": "修正后的问题描述（无修改则与原始相同）",\n'
            '      "correctness_pass": true/false,\n'
            '      "correctness_comment": "对问题-条款对应关系的复核意见",\n'
            '      "typo_pass": true/false,\n'
            '      "typo_comment": "对typo的检查意见"\n'
            '    }\n'
            '  ],\n'
            '  "summary": "总体复核结论"\n'
            "}\n"
        )

        user_prompt = (
            f"工程名称：{project_info.get('project_name', '')}\n"
            f"抽查日期：{project_info.get('inspection_date', '')}\n"
            f"{items_text}\n\n"
            f"请进行复核并返回JSON。"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        result = self.chat(messages, temperature=0.2, max_tokens=4096)
        if "error" in result:
            return result

        content = result["content"].strip()
        if content.startswith("```"):
            lines = content.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            content = "\n".join(lines)

        try:
            review = json.loads(content)
        except json.JSONDecodeError:
            import re
            match = re.search(r'\{[\s\S]*\}', content)
            if match:
                try:
                    review = json.loads(match.group())
                except json.JSONDecodeError:
                    return {
                        "error": "AI复核结果解析失败",
                        "raw_response": content,
                    }
            else:
                return {
                    "error": "AI复核结果解析失败",
                    "raw_response": content,
                }

        # 确保返回结构完整
        review.setdefault("pass", False)
        review.setdefault("items", [])
        review.setdefault("summary", "")
        return review

    def ai_polish_notice(self, notice_text, project_info):
        """
        使用LLM润色整改通知书

        参数:
            notice_text: 原始通知书文本
            project_info: 工程信息

        返回:
            dict: {"polished": "..."} 或 {"error": "..."}
        """
        if not self.is_ready():
            return {"error": "LLM未启用"}

        system_prompt = (
            "你是建设工程质量监督站的文书专家。请对以下整改通知书进行润色，"
            "保持原有格式和规范引用不变，优化语言表达的准确性、规范性和严肃性。"
            "不要改变通知书的结构和核心内容，只做文字层面的优化。"
            "直接输出润色后的通知书全文，不要加任何说明。"
        )

        user_prompt = f"以下是待润色的整改通知书：\n\n{notice_text}"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        result = self.chat(messages, temperature=0.2, max_tokens=4096)

        if "error" in result:
            return result

        return {
            "polished": result["content"],
            "usage": result.get("usage", {}),
        }
