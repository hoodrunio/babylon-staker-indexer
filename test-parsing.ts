import { SchemaExecuteParserService } from './src/services/cosmwasm/schema-execute-parser.service';
import path from 'path';

// Test schema path
const schemaPath = path.join(__dirname, 'test-schema');

// Parse execute schema
const executeSchema = SchemaExecuteParserService.parseExecuteSchema(schemaPath);

// Sonuçları göster
console.log(JSON.stringify(executeSchema, null, 2)); 