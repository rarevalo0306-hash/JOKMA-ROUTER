from decimal import Decimal, InvalidOperation


def estimate_tokens(text: str) -> int:
    """Rough count when a provider omits usage. About four characters per token.

    This is an estimate for Latin text, not a tokenizer. Real usage from the
    provider always wins when it is present, including zero.
    """
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


def content_to_text(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if "text" in item:
                    parts.append(str(item["text"]))
                elif "content" in item:
                    parts.append(str(item["content"]))
        return "".join(parts)
    return str(content)


def estimate_messages(messages: list[dict]) -> int:
    total = 0
    for message in messages:
        total += estimate_tokens(content_to_text(message.get("content")))
        total += estimate_tokens(str(message.get("role") or ""))
    return total


def as_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def estimate_cost(
    prompt_tokens: int,
    completion_tokens: int,
    input_per_million,
    output_per_million,
) -> Decimal:
    cost = (
        Decimal(prompt_tokens) * as_decimal(input_per_million)
        + Decimal(completion_tokens) * as_decimal(output_per_million)
    ) / Decimal(1_000_000)
    return cost.quantize(Decimal("0.00000001"))
