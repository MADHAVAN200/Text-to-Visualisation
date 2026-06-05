import os
import sqlite3
import datetime
import random

def create_metadata_db(db_path):
    print(f"Creating metadata database at: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Create users
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password_hash TEXT,
        role TEXT,
        created_at DATETIME
    );
    """)

    # Create connected_databases
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS connected_databases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        db_type TEXT,
        host TEXT,
        port INTEGER,
        username TEXT,
        database_name TEXT,
        connection_string TEXT,
        created_at DATETIME
    );
    """)

    # Create schema_metadata
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS schema_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        database_id INTEGER,
        table_name TEXT,
        column_name TEXT,
        data_type TEXT,
        nullable BOOLEAN,
        primary_key BOOLEAN,
        foreign_key BOOLEAN,
        foreign_to_table TEXT,
        foreign_to_column TEXT
    );
    """)

    # Create query_history
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS query_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        database_id INTEGER,
        question TEXT,
        generated_sql TEXT,
        execution_time REAL,
        status TEXT,
        error_message TEXT,
        created_at DATETIME
    );
    """)

    # Create query_results_cache
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS query_results_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_hash TEXT UNIQUE,
        result_json TEXT,
        created_at DATETIME
    );
    """)

    # Create visualizations
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS visualizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_id INTEGER,
        chart_type TEXT,
        chart_config TEXT,
        created_at DATETIME
    );
    """)

    # Create dashboards
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS dashboards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        description TEXT,
        created_at DATETIME
    );
    """)

    # Create dashboard_widgets
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS dashboard_widgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dashboard_id INTEGER,
        visualization_id INTEGER,
        position_x INTEGER,
        position_y INTEGER,
        width INTEGER,
        height INTEGER
    );
    """)

    # Create ai_insights
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS ai_insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_id INTEGER,
        insight TEXT,
        created_at DATETIME
    );
    """)

    # Insert default admin user if not exists (hashed password for 'admin123' is dummy, we will use plain-bcrypt or simple verification in backend)
    cursor.execute("SELECT count(*) FROM users WHERE email = 'admin@voice2viz.ai'")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
        INSERT INTO users (name, email, password_hash, role, created_at)
        VALUES ('Administrator', 'admin@voice2viz.ai', '$2a$10$Xm5h66cWk510xG524tZ4ue27zM9G5Tep5ZcE584yYbeEGeiV8FfP2', 'admin', ?)
        """, (datetime.datetime.now().isoformat(),))
    
    conn.commit()
    conn.close()
    print("Metadata database created successfully.")

def create_sample_sales_db(db_path):
    print(f"Creating sample sales database at: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Create tables
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        description TEXT
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        category_id INTEGER,
        unit_price REAL,
        stock_quantity INTEGER,
        FOREIGN KEY (category_id) REFERENCES categories(id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        city TEXT,
        country TEXT,
        segment TEXT,
        created_at DATETIME
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        product_id INTEGER,
        sale_date DATE,
        quantity INTEGER,
        total_amount REAL,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
    );
    """)

    # Populate categories
    categories = [
        ("Electronics", "Gadgets, devices, and accessories"),
        ("Furniture", "Office and home furniture"),
        ("Office Supplies", "Stationery, paper, and organizers"),
        ("Apparel", "Clothing and shoes"),
        ("Books", "Educational and general literature")
    ]
    cursor.executemany("INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)", categories)

    # Fetch category ids
    cursor.execute("SELECT id, name FROM categories")
    category_map = {name: cid for cid, name in cursor.fetchall()}

    # Populate products
    products = [
        # Electronics
        ("Smartphone Pro", category_map["Electronics"], 899.99, 150),
        ("Noise Cancelling Headphones", category_map["Electronics"], 249.99, 300),
        ("Smart Watch Series 5", category_map["Electronics"], 349.99, 200),
        ("UltraWide Monitor 34\"", category_map["Electronics"], 499.99, 80),
        ("Mechanical Keyboard", category_map["Electronics"], 129.99, 250),
        # Furniture
        ("Ergonomic Office Chair", category_map["Furniture"], 299.99, 120),
        ("Standing Desk Birch", category_map["Furniture"], 599.99, 60),
        ("Bookshelf 5-Tier", category_map["Furniture"], 149.99, 100),
        ("Leather Recliner", category_map["Furniture"], 799.99, 40),
        # Office Supplies
        ("Premium Notebook Set", category_map["Office Supplies"], 19.99, 1000),
        ("Gel Pens Pack of 12", category_map["Office Supplies"], 14.99, 1500),
        ("Dry Erase Whiteboard", category_map["Office Supplies"], 89.99, 110),
        # Apparel
        ("Activewear Running Jacket", category_map["Apparel"], 79.99, 300),
        ("Leather Sneakers", category_map["Apparel"], 119.99, 180),
        # Books
        ("Introduction to SQL", category_map["Books"], 49.99, 400),
        ("Data Visualization Guide", category_map["Books"], 39.99, 500)
    ]
    cursor.executemany("INSERT OR IGNORE INTO products (name, category_id, unit_price, stock_quantity) VALUES (?, ?, ?, ?)", products)

    # Fetch product details for sale generation
    cursor.execute("SELECT id, unit_price FROM products")
    product_list = cursor.fetchall()

    # Populate customers
    customers = [
        ("Alice Johnson", "alice.j@gmail.com", "New York", "USA", "Consumer"),
        ("Bob Smith", "bob.smith@yahoo.com", "London", "UK", "Corporate"),
        ("Carlos Gomez", "carlos.g@gmail.com", "Madrid", "Spain", "Consumer"),
        ("Diana Chen", "diana.c@techcorp.com", "San Francisco", "USA", "Corporate"),
        ("Evan Wright", "evan.w@outlook.com", "Toronto", "Canada", "Consumer"),
        ("Fiona Gallagher", "fiona.g@hotmail.com", "Dublin", "Ireland", "Home Office"),
        ("George Miller", "george.m@gmail.com", "Sydney", "Australia", "Consumer"),
        ("Hannah Abbott", "hannah.a@gmail.com", "Berlin", "Germany", "Corporate"),
        ("Ian Malcolm", "ian.m@jurassic.com", "Austin", "USA", "Home Office"),
        ("Julia Roberts", "julia.r@gmail.com", "Los Angeles", "USA", "Consumer"),
        ("Kevin Mitnick", "kevin@security.org", "Las Vegas", "USA", "Corporate"),
        ("Laura Croft", "laura@tomb.org", "London", "UK", "Home Office"),
    ]
    
    current_date = datetime.datetime.now()
    customer_inserts = []
    for name, email, city, country, segment in customers:
        # Create different sign-up dates over the last year
        signup_days_ago = random.randint(30, 365)
        signup_date = current_date - datetime.timedelta(days=signup_days_ago)
        customer_inserts.append((name, email, city, country, segment, signup_date.isoformat()))
        
    cursor.executemany("INSERT OR IGNORE INTO customers (name, email, city, country, segment, created_at) VALUES (?, ?, ?, ?, ?, ?)", customer_inserts)

    # Fetch customer ids
    cursor.execute("SELECT id FROM customers")
    customer_ids = [row[0] for row in cursor.fetchall()]

    # Generate sales over the last 12 months
    sales_inserts = []
    for month_offset in range(12):
        # 12 months ago to current month
        base_date = current_date - datetime.timedelta(days=30 * (11 - month_offset))
        # number of transactions per month increases/varies to make charts interesting
        num_transactions = random.randint(15, 30)
        for _ in range(num_transactions):
            cust_id = random.choice(customer_ids)
            prod_id, unit_price = random.choice(product_list)
            qty = random.choice([1, 1, 1, 2, 2, 3, 5])
            total = round(qty * unit_price, 2)
            
            # random day in that month
            day_offset = random.randint(0, 27)
            sale_date = (base_date + datetime.timedelta(days=day_offset)).date()
            sales_inserts.append((cust_id, prod_id, sale_date.isoformat(), qty, total))

    cursor.executemany("INSERT INTO sales (customer_id, product_id, sale_date, quantity, total_amount) VALUES (?, ?, ?, ?, ?)", sales_inserts)

    conn.commit()
    conn.close()
    print("Sample sales database created successfully with sales records.")

if __name__ == "__main__":
    os.makedirs("ai-engine", exist_ok=True)
    create_metadata_db(os.path.join("ai-engine", "metadata.db"))
    create_sample_sales_db(os.path.join("ai-engine", "sample_sales.db"))
    print("All SQLite databases initialized successfully!")
