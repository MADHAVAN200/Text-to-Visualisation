import os
import sqlite3
import re
from groq import Groq

def get_database_schema_text(database_id, metadata_db_path="ai-engine/metadata.db"):
    """
    Retrieves the schema for a database from metadata.db and formats it as text.
    """
    conn = sqlite3.connect(metadata_db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT table_name, column_name, data_type, primary_key, foreign_key, foreign_to_table, foreign_to_column
        FROM schema_metadata
        WHERE database_id = ?
        ORDER BY table_name, id
    """, (database_id,))
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return "No schema metadata found for this database. Please parse the schema first."

    schema_dict = {}
    for table_name, col_name, data_type, pk, fk, f_table, f_col in rows:
        if table_name not in schema_dict:
            schema_dict[table_name] = []
        
        col_desc = f"{col_name} ({data_type})"
        if pk:
            col_desc += " PRIMARY KEY"
        if fk:
            col_desc += f" FOREIGN KEY REFERENCES {f_table}({f_col})"
        schema_dict[table_name].append(col_desc)

    schema_text = ""
    for table_name, cols in schema_dict.items():
        schema_text += f"Table: {table_name}\n"
        for col in cols:
            schema_text += f"  - {col}\n"
        schema_text += "\n"
    
    return schema_text

def generate_sql_rule_based(question: str, schema_text: str) -> str:
    """The legacy service must never substitute sample-schema SQL."""
    raise ValueError("Use the Express schema planner for offline requests, or configure a model key.")

def generate_sql_llm(question: str, schema_text: str, api_key: str) -> str:
    """
    Generates SQL query using Groq Cloud API with Llama 3 model.
    """
    client = Groq(api_key=api_key)
    
    prompt = f"""You are a senior data analyst and SQLite / SQL expert.
Convert the following natural language question into a clean, syntactically correct SQL query based ONLY on the database schema provided.

Database Schema:
{schema_text}

Question:
"{question}"

Rules:
1. Respond ONLY with the raw SQL code block. Do NOT include markdown styling like ```sql or any preamble or explanation. Just the plain SQL string.
2. The query must be read-only (SELECT or WITH).
3. Do not include any semicolon at the end.
4. Ensure you use correct table names and columns from the schema. Perform joins where necessary.
5. If SQLite is the database, use SQLite syntax (e.g., date functions like strftime, date).
"""

    chat_completion = client.chat.completions.create(
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        model=os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b"),
        temperature=0.0,
    )
    
    sql = chat_completion.choices[0].message.content.strip()
    # Clean up SQL formatting if model added ```sql code blocks anyway
    if sql.startswith("```"):
        sql = re.sub(r'^```(sql)?\n', '', sql)
        sql = re.sub(r'\n```$', '', sql)
    
    return sql.strip()

def generate_sql(question: str, database_id: int, api_key: str = None, metadata_db_path="ai-engine/metadata.db") -> str:
    """
    Legacy model-only SQL generation. Unsupported/offline requests fail explicitly.
    """
    schema_text = get_database_schema_text(database_id, metadata_db_path)
    
    # Try using Groq if API Key is provided
    if api_key and api_key.strip() and not api_key.startswith("YOUR_"):
        try:
            return generate_sql_llm(question, schema_text, api_key)
        except Exception as e:
            raise ValueError("Language interpretation failed; no fallback SQL was executed.") from e
    else:
        # No sample-schema SQL substitution is permitted
        return generate_sql_rule_based(question, schema_text)
