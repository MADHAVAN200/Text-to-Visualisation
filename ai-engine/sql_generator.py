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
    """
    A smart rule-based local NLP fallback that matches questions and generates
    correct SQL for the sample_sales.db schema when no Groq API Key is present.
    """
    q = question.lower().strip()
    
    # 1. Top 10 products by revenue
    if "top" in q and "products" in q and ("revenue" in q or "sales" in q or "amount" in q):
        limit = 10
        limit_match = re.search(r'top\s+(\d+)', q)
        if limit_match:
            limit = int(limit_match.group(1))
        return f"""SELECT p.name AS product_name, c.name AS category, SUM(s.total_amount) AS total_revenue
FROM sales s
JOIN products p ON s.product_id = p.id
JOIN categories c ON p.category_id = c.id
GROUP BY p.id, p.name, c.name
ORDER BY total_revenue DESC
LIMIT {limit};"""

    # 2. Sales / Revenue by Category
    if "sales" in q or "revenue" in q or "amount" in q:
        if "category" in q or "categories" in q:
            return """SELECT c.name AS category_name, SUM(s.total_amount) AS total_sales, COUNT(s.id) AS order_count
FROM sales s
JOIN products p ON s.product_id = p.id
JOIN categories c ON p.category_id = c.id
GROUP BY c.id, c.name
ORDER BY total_sales DESC;"""

        # 3. Monthly Sales / Revenue Over Time
        if "month" in q or "monthly" in q or "time" in q or "trend" in q:
            # Check if a specific year is mentioned
            year_clause = ""
            if "2025" in q:
                year_clause = "WHERE sale_date LIKE '2025%'"
            elif "2026" in q:
                year_clause = "WHERE sale_date LIKE '2026%'"
            
            return f"""SELECT strftime('%Y-%m', sale_date) AS month, SUM(total_amount) AS revenue, COUNT(id) AS sales_count
FROM sales
{year_clause}
GROUP BY month
ORDER BY month ASC;"""

    # 4. Customers by City / Country / Region
    if "customer" in q or "customers" in q:
        if "city" in q or "cities" in q:
            return """SELECT city, COUNT(id) AS customer_count
FROM customers
GROUP BY city
ORDER BY customer_count DESC;"""
        if "country" in q or "countries" in q:
            return """SELECT country, COUNT(id) AS customer_count
FROM customers
GROUP BY country
ORDER BY customer_count DESC;"""
        if "segment" in q:
            return """SELECT segment, COUNT(id) AS customer_count
FROM customers
GROUP BY segment
ORDER BY customer_count DESC;"""
        
        # Show all customers or similar
        return """SELECT name, email, city, country, segment, date(created_at) AS join_date 
FROM customers 
ORDER BY created_at DESC 
LIMIT 20;"""

    # 5. Products list or stock info
    if "product" in q or "products" in q:
        if "stock" in q or "quantity" in q or "inventory" in q:
            return """SELECT p.name AS product_name, c.name AS category, p.stock_quantity, p.unit_price
FROM products p
JOIN categories c ON p.category_id = c.id
ORDER BY p.stock_quantity ASC;"""
        return """SELECT p.name AS product_name, c.name AS category, p.unit_price, p.stock_quantity
FROM products p
JOIN categories c ON p.category_id = c.id
ORDER BY p.name ASC;"""

    # 6. Basic counts or summary
    if "count" in q or "summary" in q or "overview" in q:
        if "sales" in q or "orders" in q:
            return "SELECT COUNT(*) AS total_orders, SUM(total_amount) AS total_revenue, AVG(total_amount) AS average_order_value FROM sales;"
        if "customers" in q:
            return "SELECT COUNT(*) AS total_customers FROM customers;"

    # Default fallback: list sales transactions
    return """SELECT s.id AS transaction_id, c.name AS customer_name, p.name AS product_name, s.sale_date, s.quantity, s.total_amount
FROM sales s
JOIN customers c ON s.customer_id = c.id
JOIN products p ON s.product_id = p.id
ORDER BY s.sale_date DESC
LIMIT 50;"""

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
        model="llama3-70b-8192",
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
    Main entry point for generating SQL. Automatically switches between LLM and local rule-based fallback.
    """
    schema_text = get_database_schema_text(database_id, metadata_db_path)
    
    # Try using Groq if API Key is provided
    if api_key and api_key.strip() and not api_key.startswith("YOUR_"):
        try:
            return generate_sql_llm(question, schema_text, api_key)
        except Exception as e:
            print(f"Groq API error, falling back to local NLP. Error: {e}")
            return generate_sql_rule_based(question, schema_text)
    else:
        # Fallback to local regex-based generator
        return generate_sql_rule_based(question, schema_text)
