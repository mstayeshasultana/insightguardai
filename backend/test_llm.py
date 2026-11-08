
import os
from pathlib import Path
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

# Explicitly locate the .env beside this Python file
env_path = Path(__file__).resolve().parent / ".env"

load_dotenv(dotenv_path=env_path, override=True)

api_key = os.getenv("FEATHERLESS_API_KEY")
model_name = os.getenv("FEATHERLESS_MODEL")

print("API key loaded:", bool(api_key))
print("Model:", model_name)

api_key = os.getenv("FEATHERLESS_API_KEY")
model_name = os.getenv("FEATHERLESS_MODEL")

if not api_key or not api_key.strip():
    raise RuntimeError("FEATHERLESS_API_KEY is empty")

if not model_name:
    raise RuntimeError("Featherless model is missing")

# Connect LangChain to Featherless
llm = ChatOpenAI(
    model=model_name,
    api_key=api_key,
    base_url="https://api.featherless.ai/v1",
    temperature=0,
    timeout=45,
    max_retries=1,
    max_tokens=250,
)

# User's business question
question = (
    "I need a dashboard showing "
    "Xarelto sales performance in Germany."
)

system_prompt = """
You are an assistant that interprets
business analytics requests.

Extract:
- product
- market
- metric
- intent

Return only a valid JSON object.

Do not invent missing information.
Use null for unknown values.

For intent, use one of:
find_existing_analytics, create_analytics, unknown.
"""

response = llm.invoke([
    ("system", system_prompt),
    ("human", question)
])

print("Model:", model_name)
print("AI response:")
print(response.content)
