import re

def validate_sql(sql_query: str) -> tuple[bool, str]:
    """
    Validates a SQL query.
    Returns (is_valid, error_message).
    Only SELECT and WITH statements are allowed.
    Blocks DML/DDL commands like INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE.
    """
    if not sql_query or not isinstance(sql_query, str):
        return False, "Query must be a non-empty string."

    # Remove SQL comments (both single line -- and multi-line /* ... */)
    cleaned = re.sub(r'--.*$', '', sql_query, flags=re.MULTILINE)
    cleaned = re.sub(r'/\*.*?\*/', '', cleaned, flags=re.DOTALL)
    
    # Trim and normalize whitespace
    cleaned = cleaned.strip()
    
    if not cleaned:
        return False, "Query consists only of comments or whitespace."

    # Parse tokens
    tokens = [t.lower() for t in re.split(r'\s+', cleaned) if t]
    if not tokens:
        return False, "Invalid SQL structure."

    # The query must start with SELECT or WITH
    first_token = tokens[0]
    if first_token not in ('select', 'with'):
        return False, f"Unauthorized SQL command: query starts with '{first_token.upper()}'. Only SELECT or WITH queries are allowed."

    # Scan for forbidden keywords anywhere in the SQL (e.g. subqueries, CTEs)
    forbidden_keywords = {
        'delete', 'drop', 'truncate', 'alter', 'insert', 'update', 
        'replace', 'create', 'grant', 'revoke', 'rename', 'merge'
    }

    for token in tokens:
        # Strip trailing commas, parentheses, etc.
        word = re.sub(r'[^\w]', '', token)
        if word in forbidden_keywords:
            return False, f"Unauthorized operation detected: '{word.upper()}'. Write operations are strictly blocked."

    return True, ""
