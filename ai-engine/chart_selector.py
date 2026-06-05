def recommend_chart(question: str, query_results: dict) -> dict:
    """
    Analyzes the query results and the user's question to recommend a chart type and configuration.
    Returns:
        {
            "chart_type": "bar" | "line" | "pie" | "area" | "scatter" | "heatmap" | "treemap",
            "x_axis": str,
            "y_axis": list[str],
            "title": str,
            "config": dict
        }
    """
    q = question.lower()
    columns = query_results.get("columns", [])
    profile = query_results.get("columns_profile", {})
    row_count = query_results.get("row_count", 0)

    # Fallback default configuration
    default_recommendation = {
        "chart_type": "bar",
        "x_axis": columns[0] if columns else None,
        "y_axis": [columns[1]] if len(columns) > 1 else [],
        "title": "Data Visualization",
        "config": {}
    }

    if not columns or row_count == 0:
        return {
            "chart_type": "table",
            "x_axis": None,
            "y_axis": [],
            "title": "No visualizable data",
            "config": {}
        }

    # Explicit user requests override heuristics
    explicit_chart = None
    if "bar chart" in q or "bar graph" in q or "show bar" in q:
        explicit_chart = "bar"
    elif "line chart" in q or "line graph" in q or "show line" in q or "trend chart" in q:
        explicit_chart = "line"
    elif "pie chart" in q or "pie graph" in q or "show pie" in q:
        explicit_chart = "pie"
    elif "area chart" in q or "area graph" in q or "show area" in q:
        explicit_chart = "area"
    elif "scatter plot" in q or "scatter chart" in q or "show scatter" in q:
        explicit_chart = "scatter"
    elif "heatmap" in q or "heat map" in q:
        explicit_chart = "heatmap"
    elif "treemap" in q or "tree map" in q:
        explicit_chart = "treemap"

    # Identify columns by semantic type
    temporal_cols = [c for c, p in profile.items() if p["semantic_type"] == "temporal"]
    categorical_cols = [c for c, p in profile.items() if p["semantic_type"] == "categorical"]
    numeric_cols = [c for c, p in profile.items() if p["semantic_type"] == "numeric"]
    text_cols = [c for c, p in profile.items() if p["semantic_type"] == "text"]

    # Fallback to text columns if no explicit categories
    all_cat_cols = categorical_cols + text_cols

    # Determine default chart, X, and Y axis keys
    recommended_type = "bar"
    x_axis = None
    y_axes = []

    # Case 1: Temporal data exists -> Line or Area chart
    if temporal_cols and numeric_cols:
        recommended_type = "line"
        x_axis = temporal_cols[0]
        y_axes = [numeric_cols[0]]
        
        # If there are multiple numeric columns, add them as separate series
        if len(numeric_cols) > 1:
            y_axes = numeric_cols[:3] # limit to 3 series

    # Case 2: Categorical + Numeric data -> Bar or Pie chart
    elif all_cat_cols and numeric_cols:
        x_axis = all_cat_cols[0]
        y_axes = [numeric_cols[0]]
        
        # Determine Pie or Bar based on cardinality
        cardinality = profile[x_axis]["unique_values"]
        if cardinality <= 6:
            recommended_type = "pie"
        else:
            recommended_type = "bar"

    # Case 3: 2+ Numeric columns -> Scatter chart
    elif len(numeric_cols) >= 2:
        recommended_type = "scatter"
        x_axis = numeric_cols[0]
        y_axes = [numeric_cols[1]]

    # Case 4: No numeric columns, just categories -> Bar chart of counts
    elif all_cat_cols:
        recommended_type = "bar"
        x_axis = all_cat_cols[0]
        # In this case we are just displaying categorical rows, we don't have quantities.
        # Check if the user is querying counts.
        y_axes = []

    # Apply explicit user preference override if found
    if explicit_chart:
        recommended_type = explicit_chart
        # Keep X and Y as computed, but force the type
        if recommended_type == "pie" and not x_axis and columns:
            x_axis = columns[0]
            y_axes = [columns[1]] if len(columns) > 1 else []
        elif recommended_type == "scatter" and len(numeric_cols) < 2 and len(columns) >= 2:
            x_axis = columns[0]
            y_axes = [columns[1]]

    # Treemap and Heatmap handling adjustments
    if recommended_type == "treemap" and not x_axis:
        x_axis = all_cat_cols[0] if all_cat_cols else columns[0]
        y_axes = [numeric_cols[0]] if numeric_cols else [columns[1]] if len(columns) > 1 else []
    elif recommended_type == "heatmap":
        # Needs 2 categorical variables and 1 numeric
        if len(all_cat_cols) >= 2 and numeric_cols:
            x_axis = all_cat_cols[0]
            y_axes = [all_cat_cols[1], numeric_cols[0]] # Y label, and Cell value
        else:
            # Fallback if insufficient dimensions
            recommended_type = "bar"

    # Construct config payload
    config = {
        "x_label": x_axis.replace("_", " ").title() if x_axis else "",
        "y_label": ", ".join([y.replace("_", " ").title() for y in y_axes]) if y_axes else "Count",
        "colors": ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"] # vibrant HSL colors
    }

    # Custom title based on column names
    title = f"{recommended_type.title()} Chart of "
    if y_axes:
        title += " vs ".join([y.replace("_", " ").title() for y in y_axes])
    else:
        title += "Data Overview"
        
    if x_axis:
        title += f" by {x_axis.replace('_', ' ').title()}"

    return {
        "chart_type": recommended_type,
        "x_axis": x_axis,
        "y_axis": y_axes,
        "title": title,
        "config": config
    }
