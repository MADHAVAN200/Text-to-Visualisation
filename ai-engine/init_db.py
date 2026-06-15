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

    # Insert default admin user if not exists (hashed password for 'admin123' is dummy)
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
    if os.path.exists(db_path):
        try:
            os.remove(db_path)
        except Exception as e:
            print(f"Failed to remove old sample database: {e}")
            
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 1. Create categories table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        description TEXT
    );
    """)

    # 2. Create suppliers table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT,
        contact_name TEXT,
        city TEXT,
        country TEXT,
        phone TEXT
    );
    """)

    # 3. Create products table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        category_id INTEGER,
        supplier_id INTEGER,
        unit_price REAL,
        stock_quantity INTEGER,
        FOREIGN KEY (category_id) REFERENCES categories(id),
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );
    """)

    # 4. Create warehouses table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS warehouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        location TEXT,
        capacity INTEGER
    );
    """)

    # 5. Create inventory table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_id INTEGER,
        product_id INTEGER,
        quantity_on_hand INTEGER,
        last_updated DATETIME,
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
    );
    """)

    # 6. Create customers table
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

    # 7. Create employees table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT,
        last_name TEXT,
        title TEXT,
        department TEXT,
        email TEXT
    );
    """)

    # 8. Create sales table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        product_id INTEGER,
        employee_id INTEGER,
        sale_date DATE,
        quantity INTEGER,
        total_amount REAL,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (employee_id) REFERENCES employees(id)
    );
    """)

    # 9. Create payments table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER,
        payment_date DATE,
        payment_method TEXT,
        amount REAL,
        status TEXT,
        FOREIGN KEY (sale_id) REFERENCES sales(id)
    );
    """)

    # 10. Create reviews table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        customer_id INTEGER,
        rating INTEGER,
        comment TEXT,
        review_date DATE,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
    """)

    # Seed 1. Categories
    categories = [
        ("Electronics", "Gadgets, devices, and accessories"),
        ("Furniture", "Office and home furniture"),
        ("Office Supplies", "Stationery, paper, and organizers"),
        ("Apparel", "Clothing, footwear, and apparel"),
        ("Books", "Educational, fiction, and journals"),
        ("Sports & Outdoors", "Fitness gear, camping, and outdoor equipment"),
        ("Home & Kitchen", "Appliances, cookware, and home decor"),
        ("Beauty & Personal Care", "Cosmetics, skincare, and personal hygiene"),
        ("Automotive", "Car care, accessories, and replacement parts"),
        ("Toys & Games", "Board games, active toys, and puzzles")
    ]
    cursor.executemany("INSERT INTO categories (name, description) VALUES (?, ?)", categories)

    # Seed 2. Suppliers
    suppliers = [
        ("Apex Tech Supply", "John Doe", "New York", "USA", "555-0101"),
        ("Global Timber Co", "Jane Smith", "Vancouver", "Canada", "555-0102"),
        ("Office Depot Distributors", "Bob Johnson", "Chicago", "USA", "555-0103"),
        ("Fashion Hub International", "Alice Brown", "Milan", "Italy", "555-0104"),
        ("Chronicle Book Dist", "David Wilson", "London", "UK", "555-0105"),
        ("GearUp Outdoors", "Emma Davis", "Denver", "USA", "555-0106"),
        ("Kitchen & Hearth Ltd", "Frank Miller", "Munich", "Germany", "555-0107"),
        ("Radiant Beauty Corp", "Grace Lee", "Paris", "France", "555-0108"),
        ("Detroit Auto Parts", "Henry Ford", "Detroit", "USA", "555-0109"),
        ("Toyland Wholesale", "Ivy Chen", "Tokyo", "Japan", "555-0110"),
        ("Beta Electronics", "Kevin Patel", "Mumbai", "India", "555-0111"),
        ("Nordic Design Studio", "Lars Olsen", "Copenhagen", "Denmark", "555-0112"),
        ("Apparel Source Group", "Mia Wong", "Hong Kong", "China", "555-0113"),
        ("Reader Choice Ltd", "Nate Harris", "Sydney", "Australia", "555-0114"),
        ("Summit Sports Inc", "Olivia Martinez", "Seattle", "USA", "555-0115"),
        ("EcoHome Solutions", "Peter Krauss", "Vienna", "Austria", "555-0116"),
        ("Gloss & Glow Brands", "Quinn Jones", "Los Angeles", "USA", "555-0117"),
        ("EuroCar Imports", "Rene Dupont", "Lyon", "France", "555-0118"),
        ("PlayTime Co", "Sarah Connor", "Austin", "USA", "555-0119"),
        ("Universal Logistics", "Thomas Muller", "Berlin", "Germany", "555-0120")
    ]
    cursor.executemany("INSERT INTO suppliers (company_name, contact_name, city, country, phone) VALUES (?, ?, ?, ?, ?)", suppliers)

    # Seed 3. Products (10 per category)
    products = [
        # Electronics
        ("Smartphone Pro", 1, 1, 899.99, 150),
        ("Noise Cancelling Headphones", 1, 1, 249.99, 300),
        ("Smart Watch Series 5", 1, 11, 349.99, 200),
        ("UltraWide Monitor 34\"", 1, 11, 499.99, 80),
        ("Mechanical Keyboard", 1, 1, 129.99, 250),
        ("Bluetooth Speaker Waterproof", 1, 11, 79.99, 450),
        ("USB-C Docking Station", 1, 1, 149.99, 180),
        ("1080p Webcam AutoFocus", 1, 1, 59.99, 320),
        ("Wireless Charger Pad", 1, 11, 29.99, 600),
        ("Tablet Lite 10\"", 1, 1, 199.99, 140),
        # Furniture
        ("Ergonomic Office Chair", 2, 2, 299.99, 120),
        ("Standing Desk Birch", 2, 2, 599.99, 60),
        ("Bookshelf 5-Tier", 2, 12, 149.99, 100),
        ("Leather Recliner", 2, 2, 799.99, 40),
        ("Coffee Table Oak", 2, 12, 199.99, 85),
        ("Dining Table Set", 2, 2, 899.99, 25),
        ("Nightstand with Drawer", 2, 12, 89.99, 150),
        ("File Cabinet Metal", 2, 2, 119.99, 90),
        ("Desk Lamp LED", 2, 12, 45.00, 300),
        ("Armchair Velvet", 2, 2, 349.99, 50),
        # Office Supplies
        ("Premium Notebook Set", 3, 3, 19.99, 1000),
        ("Gel Pens Pack of 12", 3, 3, 14.99, 1500),
        ("Dry Erase Whiteboard", 3, 3, 89.99, 110),
        ("Heavy Duty Stapler", 3, 13, 24.99, 400),
        ("Paper Shredder MicroCut", 3, 13, 99.99, 80),
        ("Binder Clips Assorted", 3, 3, 8.99, 2500),
        ("Printer Paper Ream", 3, 3, 6.99, 3000),
        ("Desk Organizer Mesh", 3, 13, 15.49, 600),
        ("Sticky Notes Cube", 3, 3, 11.99, 2000),
        ("Scissors Precision", 3, 13, 5.99, 800),
        # Apparel
        ("Activewear Running Jacket", 4, 4, 79.99, 300),
        ("Leather Sneakers", 4, 4, 119.99, 180),
        ("Cotton T-Shirt Basic", 4, 14, 14.99, 1200),
        ("Denim Jeans Classic", 4, 4, 59.99, 500),
        ("Wool Sweater Crewneck", 4, 14, 69.99, 250),
        ("Running Shoes Cushion", 4, 4, 89.99, 400),
        ("Baseball Cap Adjustable", 4, 14, 19.99, 700),
        ("Winter Coat Heavy", 4, 4, 149.99, 100),
        ("Leather Belt Dress", 4, 14, 29.99, 600),
        ("Socks Athletic 6-Pack", 4, 4, 15.99, 1500),
        # Books
        ("Introduction to SQL", 5, 5, 49.99, 400),
        ("Data Visualization Guide", 5, 5, 39.99, 500),
        ("Python Programming 101", 5, 15, 45.00, 350),
        ("The Lean Startup", 5, 5, 24.99, 600),
        ("Design Patterns in JS", 5, 15, 49.99, 200),
        ("Algorithmic Trading", 5, 5, 79.99, 150),
        ("Machine Learning Basic", 5, 15, 64.99, 250),
        ("System Architecture Master", 5, 5, 89.99, 180),
        ("Clean Code Manual", 5, 15, 37.99, 450),
        ("The Pragmatic Programmer", 5, 5, 42.50, 400),
        # Sports & Outdoors
        ("Yoga Mat Extra Thick", 6, 6, 29.99, 500),
        ("Adjustable Dumbbells Set", 6, 6, 299.99, 75),
        ("Water Bottle Insulated", 6, 16, 24.99, 800),
        ("Resistance Bands Pack", 6, 6, 15.99, 1200),
        ("Camping Tent 4-Person", 6, 16, 129.99, 60),
        ("Sleeping Bag Ultralight", 6, 6, 69.99, 150),
        ("Backpack Hiking 50L", 6, 16, 89.99, 110),
        ("Tennis Racket Graphite", 6, 6, 119.99, 130),
        ("Running Watch GPS", 6, 16, 199.99, 90),
        ("Sports Duffle Bag", 6, 6, 34.99, 250),
        # Home & Kitchen
        ("Air Fryer XL 5.8QT", 7, 7, 119.99, 140),
        ("Blender Professional 1200W", 7, 7, 89.99, 200),
        ("Chef Knife 8-Inch", 7, 17, 49.99, 350),
        ("Nonstick Cookware 10-Piece", 7, 7, 149.99, 90),
        ("Coffee Maker Programmable", 7, 17, 79.99, 220),
        ("Toaster 4-Slice Stainless", 7, 7, 49.99, 180),
        ("Robot Vacuum Cleaner", 7, 17, 249.99, 70),
        ("Electric Kettle 1.7L", 7, 7, 34.99, 400),
        ("Food Storage Containers", 7, 17, 29.99, 600),
        ("Microwave Oven Countertop", 7, 7, 109.99, 85),
        # Beauty
        ("Facial Moisturizer Hyaluronic", 8, 8, 18.99, 800),
        ("Vitamin C Serum Anti-Aging", 8, 8, 24.99, 650),
        ("Shampoo & Conditioner Set", 8, 18, 22.99, 900),
        ("Hair Dryer Ionic 1875W", 8, 8, 39.99, 300),
        ("Electric Toothbrush Recharge", 8, 18, 79.99, 250),
        ("Sunscreen SPF 50 Gel", 8, 8, 14.99, 1100),
        ("Clay Face Mask Detox", 8, 18, 16.50, 500),
        ("Beard Grooming Kit Oil", 8, 8, 29.99, 400),
        ("Makeup Brush Set 12-Piece", 8, 18, 19.99, 600),
        ("Essential Oil Diffuser", 8, 8, 27.99, 450),
        # Automotive
        ("Car Wash Shampoo & Wax", 9, 9, 15.99, 700),
        ("Microfiber Cleaning Cloths", 9, 9, 12.99, 1500),
        ("Portable Air Compressor", 9, 19, 39.99, 280),
        ("Car Battery Charger 12V", 9, 9, 49.99, 190),
        ("Windshield Wiper Blades Set", 9, 19, 24.99, 500),
        ("Leather Seat Covers Full", 9, 9, 129.99, 80),
        ("All-Weather Floor Mats", 9, 19, 69.99, 140),
        ("Car Phone Mount Magnetic", 9, 9, 14.99, 1200),
        ("OBD2 Scanner OBD II Reader", 9, 19, 34.99, 220),
        ("Tire Pressure Gauge Digital", 9, 9, 9.99, 1000),
        # Toys & Games
        ("Wooden Building Blocks 100", 10, 10, 24.99, 400),
        ("Board Game Settlement strategy", 10, 10, 44.99, 300),
        ("Magnetic Tiles Set 60-Piece", 10, 20, 39.99, 350),
        ("Rc Stunt Car Rechargeable", 10, 10, 29.99, 250),
        ("Jigsaw Puzzle 1000-Piece", 10, 20, 19.99, 600),
        ("Drawing Pad Deluxe Kit", 10, 10, 14.99, 500),
        ("Plush Bear Premium Soft", 10, 20, 18.00, 450),
        ("Bubble Blower Machine", 10, 10, 16.99, 700),
        ("Chemistry Science Kit Lab", 10, 20, 34.99, 180),
        ("Clay Modeling Activity Set", 10, 10, 12.99, 800)
    ]
    cursor.executemany("INSERT INTO products (name, category_id, supplier_id, unit_price, stock_quantity) VALUES (?, ?, ?, ?, ?)", products)

    # Seed 4. Warehouses
    warehouses = [
        ("Central Distribution Hub", "Chicago, USA", 500000),
        ("West Coast Warehouse", "Seattle, USA", 300000),
        ("East Coast Depot", "Boston, USA", 250000),
        ("European Logistics Center", "Rotterdam, Netherlands", 400000)
    ]
    cursor.executemany("INSERT INTO warehouses (name, location, capacity) VALUES (?, ?, ?)", warehouses)

    # Seed 5. Inventory (~250-300 allocations)
    inventory_inserts = []
    for pid in range(1, 101):
        wh_choices = random.sample([1, 2, 3, 4], random.randint(2, 3))
        for wh_id in wh_choices:
            qty = random.randint(10, 250)
            updated = (datetime.datetime.now() - datetime.timedelta(days=random.randint(0, 30))).isoformat()
            inventory_inserts.append((wh_id, pid, qty, updated))
    cursor.executemany("INSERT INTO inventory (warehouse_id, product_id, quantity_on_hand, last_updated) VALUES (?, ?, ?, ?)", inventory_inserts)

    # Seed 6. Customers (500 records)
    first_names = ["James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Charles",
                   "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen",
                   "Matthew", "Mark", "Donald", "Steven", "Paul", "Andrew", "Joshua", "Kenneth", "Kevin", "Brian",
                   "Lisa", "Nancy", "Sandra", "Betty", "Ashley", "Emily", "Kimberly", "Donna", "Michelle", "Carol"]
    last_names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
                  "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
                  "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
                  "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores"]
    cities = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose",
              "London", "Manchester", "Birmingham", "Toronto", "Vancouver", "Montreal", "Sydney", "Melbourne", "Brisbane", "Berlin", "Munich", "Paris"]
    countries = ["USA", "USA", "USA", "USA", "USA", "USA", "USA", "USA", "USA", "USA",
                 "UK", "UK", "UK", "Canada", "Canada", "Canada", "Australia", "Australia", "Australia", "Germany", "Germany", "France"]
    segments = ["Consumer", "Consumer", "Consumer", "Corporate", "Corporate", "Home Office"]
    
    customer_inserts = []
    emails_set = set()
    current_date = datetime.datetime.now()
    for i in range(1, 501):
        fn = random.choice(first_names)
        ln = random.choice(last_names)
        name = f"{fn} {ln}"
        email = f"{fn.lower()}.{ln.lower()}{random.randint(10, 99)}@example.com"
        while email in emails_set:
            email = f"{fn.lower()}.{ln.lower()}{random.randint(100, 999)}@example.com"
        emails_set.add(email)
        idx = random.randint(0, len(cities) - 1)
        city = cities[idx]
        country = countries[idx]
        segment = random.choice(segments)
        signup_days_ago = random.randint(1, 730)
        created_at = (current_date - datetime.timedelta(days=signup_days_ago)).isoformat()
        customer_inserts.append((name, email, city, country, segment, created_at))
    cursor.executemany("INSERT INTO customers (name, email, city, country, segment, created_at) VALUES (?, ?, ?, ?, ?, ?)", customer_inserts)

    # Seed 7. Employees (20 records)
    titles_deps = [
        ("Sales Associate", "Sales"), ("Sales Manager", "Sales"), ("Account Executive", "Sales"),
        ("Customer Success Specialist", "Support"), ("Support Manager", "Support"), ("Marketing Analyst", "Marketing")
    ]
    employee_inserts = []
    for i in range(1, 21):
        fn = random.choice(first_names)
        ln = random.choice(last_names)
        title, dep = random.choice(titles_deps)
        email = f"{fn.lower()}.{ln.lower()}@text2viz.ai"
        employee_inserts.append((fn, ln, title, dep, email))
    cursor.executemany("INSERT INTO employees (first_name, last_name, title, department, email) VALUES (?, ?, ?, ?, ?)", employee_inserts)

    # Seed 8. Sales (2000 transactions) & Seed 9. Payments (2000 records)
    sales_inserts = []
    payment_methods = ["Credit Card", "PayPal", "Bank Transfer", "Apple Pay"]
    for i in range(1, 2001):
        cust_id = random.randint(1, 500)
        prod_id = random.choice(range(1, 101))
        emp_id = random.randint(1, 20)
        qty = random.choice([1, 1, 1, 2, 2, 3, 4, 5])
        
        # product price
        unit_price = products[prod_id - 1][3]
        total_amount = round(qty * unit_price, 2)
        
        sale_days_ago = random.randint(0, 730)
        sale_date = (current_date - datetime.timedelta(days=sale_days_ago)).date().isoformat()
        sales_inserts.append((cust_id, prod_id, emp_id, sale_date, qty, total_amount))
        
    cursor.executemany("INSERT INTO sales (customer_id, product_id, employee_id, sale_date, quantity, total_amount) VALUES (?, ?, ?, ?, ?, ?)", sales_inserts)

    payment_inserts = []
    for sid in range(1, 2001):
        sale_amount = sales_inserts[sid - 1][5]
        sale_date_str = sales_inserts[sid - 1][3]
        sale_date = datetime.datetime.strptime(sale_date_str, "%Y-%m-%d")
        pay_date = (sale_date + datetime.timedelta(days=random.choice([0, 0, 1]))).date().isoformat()
        method = random.choice(payment_methods)
        status = random.choices(["Completed", "Pending", "Failed"], weights=[90, 8, 2], k=1)[0]
        payment_inserts.append((sid, pay_date, method, sale_amount, status))
    cursor.executemany("INSERT INTO payments (sale_id, payment_date, payment_method, amount, status) VALUES (?, ?, ?, ?, ?)", payment_inserts)

    # Seed 10. Reviews (800 records)
    comments_pool = {
        5: ["Excellent product, works perfectly!", "Highly recommend this to everyone.", "Best purchase I've made this year.", "Amazing quality and fast delivery.", "Superb customer service and great value."],
        4: ["Very good quality, minor complaints.", "Works well, arrived on time.", "Satisfied with the purchase.", "Solid performance, value for money.", "Great packaging and good quality."],
        3: ["Average product, does the job.", "Decent quality, but could be better.", "Okay for the price.", "It's fine, nothing special.", "Works but has some limitations."],
        2: ["Not satisfied with the performance.", "Below average quality.", "Wouldn't buy this again.", "Arrived slightly damaged.", "Disappointing experience."],
        1: ["Terrible product, broke on first use.", "Waste of money, do not buy!", "Horrible customer support.", "Very poor quality.", "Absolutely useless, returning it."]
    }
    
    review_inserts = []
    for _ in range(800):
        pid = random.randint(1, 100)
        cid = random.randint(1, 500)
        rating = random.choices([5, 4, 3, 2, 1], weights=[45, 35, 12, 5, 3], k=1)[0]
        comment = random.choice(comments_pool[rating])
        rev_days_ago = random.randint(0, 730)
        rev_date = (current_date - datetime.timedelta(days=rev_days_ago)).date().isoformat()
        review_inserts.append((pid, cid, rating, comment, rev_date))
    cursor.executemany("INSERT INTO reviews (product_id, customer_id, rating, comment, review_date) VALUES (?, ?, ?, ?, ?)", review_inserts)

    conn.commit()
    conn.close()
    print("Sample sales database created successfully with 10 tables and 5700+ rows.")

if __name__ == "__main__":
    os.makedirs("ai-engine", exist_ok=True)
    create_metadata_db(os.path.join("ai-engine", "metadata.db"))
    create_sample_sales_db(os.path.join("ai-engine", "sample_sales.db"))
    print("All SQLite databases initialized successfully!")
