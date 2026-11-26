CREATE TABLE grants(org VARCHAR(8), serial VARCHAR(8), budget DECIMAL(12,2), awarded_at DATE);
CREATE TABLE programs(workspace VARCHAR(8), identifier VARCHAR(8), sector VARCHAR(20));
CREATE TABLE splits(destination VARCHAR(8), allocation_pct DECIMAL(8,2), scope VARCHAR(8), origin VARCHAR(8));
INSERT INTO grants VALUES ('A','G1',200,'2024-01-01'),('B','G1',100,'2024-02-01'),('B','G2',40,'2024-03-01'),('A','G3',999,'2023-01-01');
INSERT INTO programs VALUES ('A','P1','Arts'),('A','P2','Science'),('B','P1','Science'),('B','P2','Arts');
INSERT INTO splits VALUES ('P1',75,'A','G1'),('P1',75,'A','G1'),('P2',25,'A','G1'),('P1',80,'B','G1'),('P2',20,'B','G1'),('P1',100,'A','G3');
