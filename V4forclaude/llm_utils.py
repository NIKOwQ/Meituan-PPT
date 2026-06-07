"""llm_utils: 共享的 LLM 客户端创建和 JSON 工具函数。"""

import json
import os
import re

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()


# ── OpenAI Client ────────────────────────────────────────────────


def create_client() -> tuple[OpenAI, str]:
    """从环境变量创建 OpenAI 客户端，返回 (client, model)。"""
    api_key = os.getenv("DG_LLM_API_KEY")
    base_url = os.getenv("DG_LLM_BASE_URL")
    model = os.getenv("DG_LLM_MODEL", "gpt-4o")

    if not api_key:
        raise ValueError("请在 .env 中设置 DG_LLM_API_KEY")
    if not base_url:
        raise ValueError("请在 .env 中设置 DG_LLM_BASE_URL")

    return OpenAI(api_key=api_key, base_url=base_url), model


# ── JSON Utilities ───────────────────────────────────────────────


def extract_json(text: str) -> str:
    """从 LLM 回复中提取 JSON 块。"""
    # ```json ... ``` 代码块
    m = re.search(r"```(?:json)?\s*\n(.*)\n```", text, re.DOTALL)
    if m:
        return m.group(1).strip()

    # 裸 {...}
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        return m.group(0)

    return text


def repair_json(text: str) -> str:
    """修复 LLM 输出中未转义的双引号。

    逐字符解析，在 JSON 字符串值内部遇到 " 时，
    检查其后是否紧跟 JSON 语法字符（, : } ] 空白），
    如果不是则视为内容引号，转义为 \\"。
    """
    result: list[str] = []
    i = 0
    while i < len(text):
        if text[i] == '"':
            result.append('"')
            i += 1
            while i < len(text):
                if text[i] == '\\' and i + 1 < len(text):
                    result.append(text[i : i + 2])
                    i += 2
                    continue
                if text[i] == '"':
                    rest = text[i + 1 :].lstrip()
                    if not rest or rest[0] in ",:}]":
                        result.append('"')
                        i += 1
                        break
                    else:
                        result.append('\\"')
                        i += 1
                        continue
                result.append(text[i])
                i += 1
        else:
            result.append(text[i])
            i += 1
    return "".join(result)
