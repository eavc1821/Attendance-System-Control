-- Ver todas las fechas distintas en la BD
SELECT DISTINCT date 
FROM attendance 
ORDER BY date DESC;

-- Ver cuántos registros por fecha
SELECT date, COUNT(*) as registros 
FROM attendance 
WHERE exit_time IS NOT NULL
GROUP BY date 
ORDER BY date DESC;