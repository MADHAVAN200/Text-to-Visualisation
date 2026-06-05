import pandas as pd
from groq import Groq

def generate_insights_rule_based(query_results: dict) -> list[str]:
    """
    Generates structured insights locally by profiling metrics in the query results.
    """
    rows = query_results.get("rows", [])
    columns = query_results.get("columns", [])
    profile = query_results.get("columns_profile", {})
    row_count = query_results.get("row_count", 0)

    if not rows or row_count == 0:
        return ["No data available to analyze."]

    insights = []

    # Find numeric and categorical columns
    numeric_cols = [c for c, p in profile.items() if p["semantic_type"] == "numeric"]
    temporal_cols = [c for c, p in profile.items() if p["semantic_type"] == "temporal"]
    categorical_cols = [c for c, p in profile.items() if p["semantic_type"] == "categorical"] + \
                       [c for c, p in profile.items() if p["semantic_type"] == "text"]

    df = pd.DataFrame(rows)

    # Insight 1: Total records count
    insights.append(f"The query retrieved {row_count} records containing {len(columns)} attributes.")

    # Insight 2: Perform analysis on the primary numeric column
    if numeric_cols:
        num_col = numeric_cols[0]
        # Skip if all are null
        if not df[num_col].isnull().all():
            total_val = df[num_col].sum()
            avg_val = df[num_col].mean()
            max_idx = df[num_col].idxmax()
            min_idx = df[num_col].idxmin()
            
            # Format nicely
            lbl_total = f"${total_val:,.2f}" if "amount" in num_col or "revenue" in num_col or "price" in num_col else f"{int(total_val):,}" if total_val.is_integer() else f"{total_val:,.2f}"
            lbl_avg = f"${avg_val:,.2f}" if "amount" in num_col or "revenue" in num_col or "price" in num_col else f"{avg_val:,.2f}"
            
            insights.append(f"The total cumulative **{num_col.replace('_', ' ')}** is **{lbl_total}**, with an average of **{lbl_avg}** per row.")

            # Max & Min items if a category label exists
            if categorical_cols:
                cat_col = categorical_cols[0]
                max_cat = df.loc[max_idx, cat_col]
                min_cat = df.loc[min_idx, cat_col]
                max_val = df.loc[max_idx, num_col]
                min_val = df.loc[min_idx, num_col]
                
                lbl_max = f"${max_val:,.2f}" if "amount" in num_col or "revenue" in num_col or "price" in num_col else f"{max_val:,.2f}"
                lbl_min = f"${min_val:,.2f}" if "amount" in num_col or "revenue" in num_col or "price" in num_col else f"{min_val:,.2f}"
                
                if max_cat != min_cat:
                    insights.append(f"**Highest performing category/item:** **{max_cat}** ({lbl_max}).")
                    insights.append(f"**Lowest performing category/item:** **{min_cat}** ({lbl_min}).")
            else:
                max_val = df.loc[max_idx, num_col]
                lbl_max = f"${max_val:,.2f}" if "amount" in num_col or "revenue" in num_col or "price" in num_col else f"{max_val:,.2f}"
                insights.append(f"The maximum recorded **{num_col.replace('_', ' ')}** is **{lbl_max}**.")

    # Insight 3: Analyze growth trend if temporal data is available
    if temporal_cols and numeric_cols:
        temp_col = temporal_cols[0]
        num_col = numeric_cols[0]
        # Sort by date
        df_sorted = df.sort_values(by=temp_col)
        if len(df_sorted) >= 2:
            first_val = df_sorted.iloc[0][num_col]
            last_val = df_sorted.iloc[-1][num_col]
            first_date = df_sorted.iloc[0][temp_col]
            last_date = df_sorted.iloc[-1][temp_col]
            
            if pd.notna(first_val) and pd.notna(last_val) and first_val > 0:
                growth = ((last_val - first_val) / first_val) * 100
                growth_text = f"increased by **{growth:.1f}%**" if growth >= 0 else f"decreased by **{abs(growth):.1f}%**"
                insights.append(f"Comparing the start (**{first_date}**) to the end (**{last_date}**), values {growth_text} (from {first_val:,.2f} to {last_val:,.2f}).")

    # Limit insights length
    return insights[:4]

def generate_insights_llm(query_results: dict, api_key: str) -> list[str]:
    """
    Generates summary insights using Groq Cloud API.
    """
    client = Groq(api_key=api_key)
    
    # Minimize token usage by preparing a summarized dataset
    rows = query_results.get("rows", [])[:30] # Limit to top 30 rows
    cols = query_results.get("columns", [])
    
    prompt = f"""You are a professional business intelligence analyst.
Analyze the following query results table and extract 3 to 4 concise, high-value, bulleted business insights.

Columns: {cols}
Data:
{rows}

Rules:
1. Deliver ONLY a bulleted list of 3-4 key insights. Do NOT write any introduction or conclusion.
2. Focus on notable trends, anomalies, highest/lowest performance, or percentage changes.
3. Be specific, use actual numbers and names from the dataset.
4. Keep each bullet point under 15 words.
"""

    chat_completion = client.chat.completions.create(
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        model="llama3-70b-8192",
        temperature=0.3,
    )
    
    content = chat_completion.choices[0].message.content.strip()
    
    # Parse bullets into list of strings
    bullets = []
    for line in content.split('\n'):
        line = line.strip()
        if line.startswith('*') or line.startswith('-') or (len(line) > 2 and line[0].isdigit() and line[1] == '.'):
            # Strip bullet prefix
            clean_line = re.sub(r'^(\*|-|\d+\.)\s*', '', line)
            bullets.append(clean_line)
            
    if not bullets:
        # If it returned raw text instead of standard bullets
        bullets = [line for line in content.split('\n') if line.strip()]
        
    return bullets

def generate_insights(query_results: dict, api_key: str = None) -> list[str]:
    """
    Main entry point for generating data insights.
    """
    if api_key and api_key.strip() and not api_key.startswith("YOUR_"):
        try:
            return generate_insights_llm(query_results, api_key)
        except Exception as e:
            print(f"Groq API error in insights generator, falling back. Error: {e}")
            return generate_insights_rule_based(query_results)
    else:
        return generate_insights_rule_based(query_results)
