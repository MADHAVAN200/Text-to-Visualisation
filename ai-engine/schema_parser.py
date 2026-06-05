import sqlite3
import os

def parse_sqlite_schema(db_path, database_id, metadata_conn):
    """
    Parses an SQLite database schema and inserts columns/keys into the schema_metadata table.
    """
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"SQLite file not found at: {db_path}")

    target_conn = sqlite3.connect(db_path)
    target_cursor = target_conn.cursor()

    # Get list of tables
    target_cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    tables = [row[0] for row in target_cursor.fetchall()]

    metadata_cursor = metadata_conn.cursor()

    # Clear existing schema metadata for this database
    metadata_cursor.execute("DELETE FROM schema_metadata WHERE database_id = ?", (database_id,))

    for table in tables:
        # Get column info: cid, name, type, notnull, dflt_value, pk
        target_cursor.execute(f"PRAGMA table_info({table});")
        columns = target_cursor.fetchall()

        # Get foreign keys: id, seq, table, from, to, on_update, on_delete, match
        target_cursor.execute(f"PRAGMA foreign_key_list({table});")
        fk_list = target_cursor.fetchall()
        
        # Build a map of foreign keys
        fk_map = {}
        for fk in fk_list:
            from_col = fk[3]
            to_table = fk[2]
            to_col = fk[4]
            fk_map[from_col] = (to_table, to_col)

        for col in columns:
            col_name = col[1]
            col_type = col[2]
            notnull = col[3]
            is_pk = col[5] > 0
            
            is_fk = col_name in fk_map
            foreign_to_table = fk_map[col_name][0] if is_fk else None
            foreign_to_column = fk_map[col_name][1] if is_fk else None
            
            metadata_cursor.execute("""
            INSERT INTO schema_metadata (
                database_id, table_name, column_name, data_type, 
                nullable, primary_key, foreign_key, foreign_to_table, foreign_to_column
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                database_id, table, col_name, col_type,
                not notnull, is_pk, is_fk, foreign_to_table, foreign_to_column
            ))

    metadata_conn.commit()
    target_conn.close()
    return tables

def parse_postgresql_schema(conn_str, database_id, metadata_conn):
    """
    Parses a PostgreSQL schema. Note: Needs psycopg2.
    We fetch from information_schema.
    """
    import psycopg2
    target_conn = psycopg2.connect(conn_str)
    target_cursor = target_conn.cursor()

    metadata_cursor = metadata_conn.cursor()
    metadata_cursor.execute("DELETE FROM schema_metadata WHERE database_id = ?", (database_id,))

    # Get tables
    target_cursor.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    """)
    tables = [row[0] for row in target_cursor.fetchall()]

    for table in tables:
        # Get columns
        target_cursor.execute("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s;
        """, (table,))
        cols = target_cursor.fetchall()

        # Get primary keys
        target_cursor.execute("""
            SELECT a.attname
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = %s::regclass AND i.indisprimary;
        """, (table,))
        pks = {row[0] for row in target_cursor.fetchall()}

        # Get foreign keys
        target_cursor.execute("""
            SELECT
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = %s;
        """, (table,))
        fks = {row[0]: (row[1], row[2]) for row in target_cursor.fetchall()}

        for col_name, data_type, is_nullable in cols:
            is_pk = col_name in pks
            is_fk = col_name in fks
            foreign_to_table = fks[col_name][0] if is_fk else None
            foreign_to_column = fks[col_name][1] if is_fk else None

            metadata_cursor.execute("""
            INSERT INTO schema_metadata (
                database_id, table_name, column_name, data_type, 
                nullable, primary_key, foreign_key, foreign_to_table, foreign_to_column
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                database_id, table, col_name, data_type,
                is_nullable == 'YES', is_pk, is_fk, foreign_to_table, foreign_to_column
            ))

    metadata_conn.commit()
    target_conn.close()
    return tables

def parse_mysql_schema(host, port, username, password, database_name, database_id, metadata_conn):
    """
    Parses a MySQL schema. Note: Needs mysql-connector-python.
    """
    import mysql.connector
    target_conn = mysql.connector.connect(
        host=host,
        port=port,
        user=username,
        password=password,
        database=database_name
    )
    target_cursor = target_conn.cursor()

    metadata_cursor = metadata_conn.cursor()
    metadata_cursor.execute("DELETE FROM schema_metadata WHERE database_id = ?", (database_id,))

    # Get tables
    target_cursor.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = %s AND table_type = 'BASE TABLE';
    """, (database_name,))
    tables = [row[0] for row in target_cursor.fetchall()]

    for table in tables:
        # Get columns, keys info
        target_cursor.execute("""
            SELECT column_name, data_type, is_nullable, column_key
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s;
        """, (database_name, table))
        cols = target_cursor.fetchall()

        # Get foreign keys
        target_cursor.execute("""
            SELECT column_name, referenced_table_name, referenced_column_name
            FROM information_schema.key_column_usage
            WHERE table_schema = %s AND table_name = %s AND referenced_table_name IS NOT NULL;
        """, (database_name, table))
        fks = {row[0]: (row[1], row[2]) for row in target_cursor.fetchall()}

        for col_name, data_type, is_nullable, column_key in cols:
            is_pk = (column_key == 'PRI')
            is_fk = col_name in fks
            foreign_to_table = fks[col_name][0] if is_fk else None
            foreign_to_column = fks[col_name][1] if is_fk else None

            metadata_cursor.execute("""
            INSERT INTO schema_metadata (
                database_id, table_name, column_name, data_type, 
                nullable, primary_key, foreign_key, foreign_to_table, foreign_to_column
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                database_id, table, col_name, data_type,
                is_nullable == 'YES', is_pk, is_fk, foreign_to_table, foreign_to_column
            ))

    metadata_conn.commit()
    target_conn.close()
    return tables

def sync_database_schema(database_id, metadata_db_path="ai-engine/metadata.db"):
    """
    Syncs the schema of a specific connected database into metadata.db.
    """
    metadata_conn = sqlite3.connect(metadata_db_path)
    cursor = metadata_conn.cursor()
    
    # Get database connection info
    cursor.execute("""
        SELECT db_type, database_name, host, port, username, connection_string 
        FROM connected_databases 
        WHERE id = ?
    """, (database_id,))
    db_info = cursor.fetchone()
    
    if not db_info:
        metadata_conn.close()
        raise ValueError(f"Database with ID {database_id} not found in metadata.")
        
    db_type, db_name, host, port, username, connection_string = db_info
    
    try:
        if db_type.lower() == 'sqlite':
            # For SQLite, the database_name field contains the local file path
            tables = parse_sqlite_schema(db_name, database_id, metadata_conn)
        elif db_type.lower() == 'postgresql':
            tables = parse_postgresql_schema(connection_string, database_id, metadata_conn)
        elif db_type.lower() == 'mysql':
            # MySQL connection. (password is decrypted or retrieved appropriately; in this case stored in connection_string or connection properties)
            # For this simple implementation, let's parse password from connection_string or similar.
            # We will assume connection_string stores password in plain text or format: host,port,user,pass,db
            parts = connection_string.split(',')
            password = parts[3] if len(parts) > 3 else ""
            tables = parse_mysql_schema(host, port, username, password, db_name, database_id, metadata_conn)
        else:
            raise ValueError(f"Unsupported database type: {db_type}")
            
        metadata_conn.close()
        return {"success": True, "tables": tables}
    except Exception as e:
        metadata_conn.close()
        return {"success": False, "error": str(e)}
