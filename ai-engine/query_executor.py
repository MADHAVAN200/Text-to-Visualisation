import time
import sqlite3
import pandas as pd
import json

def get_db_connection_params(database_id, metadata_db_path="ai-engine/metadata.db"):
    conn = sqlite3.connect(metadata_db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT db_type, database_name, host, port, username, connection_string 
        FROM connected_databases 
        WHERE id = ?
    """, (database_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise ValueError(f"Database configuration with ID {database_id} not found.")
    return row

def execute_sqlite_query(db_path, sql_query):
    conn = sqlite3.connect(db_path)
    # Use pandas to easily load and profile
    df = pd.read_sql_query(sql_query, conn)
    conn.close()
    return df

def execute_postgresql_query(conn_str, sql_query):
    import psycopg2
    conn = psycopg2.connect(conn_str)
    df = pd.read_sql_query(sql_query, conn)
    conn.close()
    return df

def execute_mysql_query(host, port, username, connection_string, db_name, sql_query):
    import mysql.connector
    # connection_string stores password in plain text or format: host,port,user,pass,db
    # We will assume connection_string stores password as the 4th value in comma separated list
    parts = connection_string.split(',')
    password = parts[3] if len(parts) > 3 else ""
    
    conn = mysql.connector.connect(
        host=host,
        port=port,
        user=username,
        password=password,
        database=db_name
    )
    df = pd.read_sql_query(sql_query, conn)
    conn.close()
    return df

def profile_dataframe(df):
    """
    Profiles columns in the dataframe to determine their semantic types.
    Semantic types: 'temporal', 'categorical', 'numeric', 'text'
    """
    profile = {}
    for col in df.columns:
        col_type = str(df[col].dtype)
        # Check if column values can be parsed as dates
        is_date = False
        if 'datetime' in col_type or 'date' in col_type:
            is_date = True
        else:
            # Sample non-null values
            non_null_samples = df[col].dropna().head(5)
            if not non_null_samples.empty:
                # Try parsing as datetime
                try:
                    for val in non_null_samples:
                        if isinstance(val, str) and len(val) >= 4:
                            pd.to_datetime(val)
                    is_date = True
                except (ValueError, TypeError):
                    pass
        
        if is_date:
            semantic_type = 'temporal'
        elif 'int' in col_type or 'float' in col_type or 'numeric' in col_type:
            # Let's verify if it should be categorical (e.g. low cardinality ID columns)
            if df[col].nunique() < 5 and 'id' in col.lower():
                semantic_type = 'categorical'
            else:
                semantic_type = 'numeric'
        else:
            # String or object. Check cardinality
            unique_count = df[col].nunique()
            total_count = len(df[col])
            if total_count > 0 and (unique_count / total_count < 0.5 or unique_count <= 15):
                semantic_type = 'categorical'
            else:
                semantic_type = 'text'
                
        profile[col] = {
            "data_type": col_type,
            "semantic_type": semantic_type,
            "unique_values": int(df[col].nunique()),
            "null_values": int(df[col].isnull().sum())
        }
    return profile

def execute_query(database_id: int, sql_query: str, metadata_db_path="ai-engine/metadata.db") -> dict:
    """
    Executes a SQL query on a connected database and returns serialized JSON.
    """
    db_type, db_name, host, port, username, connection_string = get_db_connection_params(database_id, metadata_db_path)
    
    start_time = time.time()
    try:
        if db_type.lower() == 'sqlite':
            df = execute_sqlite_query(db_name, sql_query)
        elif db_type.lower() == 'postgresql':
            df = execute_postgresql_query(connection_string, sql_query)
        elif db_type.lower() == 'mysql':
            df = execute_mysql_query(host, port, username, connection_string, db_name, sql_query)
        else:
            raise ValueError(f"Unsupported database type: {db_type}")
            
        execution_time = time.time() - start_time
        
        # Profile DataFrame
        columns_profile = profile_dataframe(df)
        
        # Format results: list of dicts for rows
        # Handle nan/inf so JSON serialization doesn't fail
        df_cleaned = df.copy()
        for col in df_cleaned.select_dtypes(include=['float', 'integer']).columns:
            df_cleaned[col] = df_cleaned[col].apply(lambda x: None if pd.isna(x) or x in [float('inf'), float('-inf')] else x)
        
        # Format dates as strings
        for col in df_cleaned.columns:
            if columns_profile[col]['semantic_type'] == 'temporal':
                df_cleaned[col] = df_cleaned[col].apply(lambda x: str(x) if pd.notna(x) else None)
        
        rows = df_cleaned.to_dict(orient='records')
        columns = list(df.columns)
        
        return {
            "success": True,
            "execution_time": round(execution_time, 4),
            "columns": columns,
            "columns_profile": columns_profile,
            "rows": rows,
            "row_count": len(rows),
            "error": None
        }
        
    except Exception as e:
        execution_time = time.time() - start_time
        return {
            "success": False,
            "execution_time": round(execution_time, 4),
            "columns": [],
            "columns_profile": {},
            "rows": [],
            "row_count": 0,
            "error": str(e)
        }
