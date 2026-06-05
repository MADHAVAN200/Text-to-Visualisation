from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uvicorn
import sqlite3

# Import local modules
from schema_parser import sync_database_schema
from sql_validator import validate_sql
from sql_generator import generate_sql
from query_executor import execute_query
from chart_selector import recommend_chart
from insight_generator import generate_insights

app = FastAPI(title="Voice2Viz AI Engine", version="1.0")

# Request/Response schemas
class SchemaParseRequest(BaseModel):
    database_id: int
    metadata_db_path: Optional[str] = "ai-engine/metadata.db"

class SQLGenerateRequest(BaseModel):
    question: str
    database_id: int
    api_key: Optional[str] = None
    metadata_db_path: Optional[str] = "ai-engine/metadata.db"

class SQLValidateRequest(BaseModel):
    sql_query: str

class QueryExecuteRequest(BaseModel):
    database_id: int
    sql_query: str
    question: str
    metadata_db_path: Optional[str] = "ai-engine/metadata.db"

class InsightGenerateRequest(BaseModel):
    query_results: Dict[str, Any]
    api_key: Optional[str] = None

@app.post("/parse-schema")
def parse_schema(payload: SchemaParseRequest):
    result = sync_database_schema(payload.database_id, payload.metadata_db_path)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result

@app.post("/generate-sql")
def make_sql(payload: SQLGenerateRequest):
    try:
        sql = generate_sql(
            question=payload.question,
            database_id=payload.database_id,
            api_key=payload.api_key,
            metadata_db_path=payload.metadata_db_path
        )
        # Validate generated SQL for safety
        is_valid, err_msg = validate_sql(sql)
        return {
            "sql": sql, 
            "is_valid": is_valid, 
            "validation_error": err_msg if not is_valid else None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/validate-sql")
def check_sql(payload: SQLValidateRequest):
    is_valid, err_msg = validate_sql(payload.sql_query)
    return {"is_valid": is_valid, "error": err_msg}

@app.post("/execute-query")
def run_query(payload: QueryExecuteRequest):
    # Security check: validate SQL before running
    is_valid, err_msg = validate_sql(payload.sql_query)
    if not is_valid:
        return {
            "success": False,
            "error": f"SQL security validation failed: {err_msg}",
            "execution_time": 0,
            "columns": [],
            "rows": [],
            "row_count": 0,
            "chart_recommendation": None
        }
        
    # Execute query
    results = execute_query(
        database_id=payload.database_id,
        sql_query=payload.sql_query,
        metadata_db_path=payload.metadata_db_path
    )
    
    if not results.get("success"):
        return {
            "success": False,
            "error": results.get("error"),
            "execution_time": results.get("execution_time", 0),
            "columns": [],
            "rows": [],
            "row_count": 0,
            "chart_recommendation": None
        }
        
    # Generate visualization recommendation
    chart_rec = recommend_chart(payload.question, results)
    
    return {
        **results,
        "chart_recommendation": chart_rec
    }

@app.post("/generate-insights")
def make_insights(payload: InsightGenerateRequest):
    try:
        insights = generate_insights(payload.query_results, payload.api_key)
        return {"insights": insights}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "voice2viz-ai-engine"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=5000)
