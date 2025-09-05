-- Check actual column names in crypto_assets table
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'crypto_assets' 
ORDER BY ordinal_position;