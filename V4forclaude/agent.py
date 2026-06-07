"""FlowAgent: 模拟客服 Agent，接收长指令 + 对话历史，返回单条回复。"""

from openai import OpenAI

from llm_utils import create_client

_FIRST_TURN_TRIGGER = "请开始通话"


class FlowAgent:
    """LLM Agent：接收长指令（system prompt）+ 对话历史，返回单条回复。"""

    def __init__(self):
        self.client: OpenAI
        self.model: str
        self.client, self.model = create_client()

    def reply(self, instruction: str, history: list[dict]) -> str:
        """生成 Agent 的下一轮回复。

        Args:
            instruction: 原始 Markdown 长指令（作为 system prompt）
            history: [{"role": "user"|"assistant", "content": "..."}, ...]
                     对话历史。首轮为空列表时自动添加触发消息。

        Returns:
            Agent 的单条回复 str
        """
        messages = [{"role": "system", "content": instruction}]

        if not history:
            # 首轮触发：添加启动消息让 Agent 生成开场白
            messages.append({"role": "user", "content": _FIRST_TURN_TRIGGER})
        else:
            messages.extend(history)

        resp = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.7,
        )
        return resp.choices[0].message.content
