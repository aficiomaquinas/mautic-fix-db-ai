import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { PoolOptions, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { Client, ClientChannel } from 'ssh2';
import fs from 'fs';
import dotenv from 'dotenv';
import { MySQL } from './db'; // Assuming you've put the MySQL class in a file named db.ts

dotenv.config();

interface DBConfig extends PoolOptions {
  port: number;
}

interface SSHConfig {
  host: string;
  port: number;
  username: string;
  privateKey: Buffer;
  passphrase: string;
}

const requiredEnvVars = [
  'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_PORT',
  'SSH_HOST', 'SSH_PORT', 'SSH_USERNAME', 'SSH_PRIVATE_KEY_PATH', 'SSH_PASSPHRASE',
  'OPENAI_API_KEY'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`Error: The following environment variables are not set: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const DB_CONFIG: DBConfig = {
  host: process.env.DB_HOST!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  database: process.env.DB_NAME!,
  port: parseInt(process.env.DB_PORT!, 10)
};

const SSH_CONFIG: SSHConfig = {
  host: process.env.SSH_HOST!,
  port: parseInt(process.env.SSH_PORT!, 10),
  username: process.env.SSH_USERNAME!,
  privateKey: fs.readFileSync(process.env.SSH_PRIVATE_KEY_PATH!),
  passphrase: process.env.SSH_PASSPHRASE!
};

function escapeIdentifier(identifier: string): string {
  return '`' + identifier.replace(/`/g, '``') + '`';
}

function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

async function extractConstraintName(errorMessage: string): Promise<string> {
  const model = new ChatOpenAI({ modelName: "gpt-4", temperature: 0 });
  const promptTemplate = ChatPromptTemplate.fromTemplate(
    "Extract the foreign key constraint name from the following error message. Take into account that this message was probably pasted from the terminal so it might have unwanted spaces and newlines that could potentially separate the key constraint name. You'll be able to correctly identify this because the key constraint name will always start with FK_ it will never contain spaces and be delimited by single quotes. Only return the constraint name without quotes, nothing else:\n\n{errorMessage}"
  );
  const chain = promptTemplate.pipe(model).pipe(new StringOutputParser());

  const response = await chain.invoke({ errorMessage });
  return response.trim();
}

async function main() {
  const args = process.argv.slice(2);
  const debugMode = args.includes('--debug');
  
  const errorArg = args.find(arg => arg.startsWith('--error='));
  const mauticError = errorArg ? errorArg.split('=')[1] : null;

  if (!mauticError) {
    console.error('Error: Please provide the Mautic error message using --error="your error message"');
    process.exit(1);
  }

  let mysql: MySQL | undefined;
  let sshClient: Client | undefined;

  try {
    const constraintName = await extractConstraintName(mauticError);

    if (debugMode) {
      console.log('Extracted constraint name:', constraintName);
    }

    sshClient = new Client();
    await new Promise<void>((resolve, reject) => {
      sshClient!.on('ready', resolve).on('error', reject).connect(SSH_CONFIG);
    });
    if (debugMode) console.log('SSH connection established');

    const tunnelStream = await new Promise<ClientChannel>((resolve, reject) => {
      sshClient!.forwardOut('127.0.0.1', 0, DB_CONFIG.host!, DB_CONFIG.port, (err, stream) => {
        if (err) reject(err);
        else resolve(stream);
      });
    });

    mysql = new MySQL({ ...DB_CONFIG, stream: tunnelStream });
    if (debugMode) console.log('Successfully connected to the database over SSH.\n');

    const prompt = await generatePrompt(mysql, mauticError, constraintName);
    console.log(prompt);

  } catch (error) {
    if (debugMode) {
      console.error(`Error: ${(error as Error).message}`);
    } else {
      console.log(`Error occurred: ${(error as Error).message}`);
    }
  } finally {
    if (mysql) await mysql.connection.end();
    if (sshClient) sshClient.end();
  }
}

async function generatePrompt(mysql: MySQL, mauticError: string, constraintName: string): Promise<string> {
  const query = `
    SELECT 
      kcu.TABLE_NAME AS referencing_table,
      kcu.COLUMN_NAME AS referencing_column,
      kcu.REFERENCED_TABLE_NAME AS referenced_table,
      kcu.REFERENCED_COLUMN_NAME AS referenced_column,
      tc.CONSTRAINT_TYPE,
      c.DATA_TYPE AS referencing_data_type,
      c.CHARACTER_SET_NAME AS referencing_charset,
      c.COLLATION_NAME AS referencing_collation,
      c.COLUMN_TYPE AS referencing_column_type,
      c.IS_NULLABLE AS referencing_is_nullable,
      c.COLUMN_KEY AS referencing_key,
      c.COLUMN_DEFAULT AS referencing_default,
      c.EXTRA AS referencing_extra,
      rc.DATA_TYPE AS referenced_data_type,
      rc.CHARACTER_SET_NAME AS referenced_charset,
      rc.COLLATION_NAME AS referenced_collation,
      rc.COLUMN_TYPE AS referenced_column_type,
      rc.IS_NULLABLE AS referenced_is_nullable,
      rc.COLUMN_KEY AS referenced_key,
      rc.COLUMN_DEFAULT AS referenced_default,
      rc.EXTRA AS referenced_extra,
      rc.TABLE_SCHEMA AS schema_name
    FROM 
      INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
    JOIN 
      INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
    JOIN
      INFORMATION_SCHEMA.COLUMNS c
      ON kcu.TABLE_SCHEMA = c.TABLE_SCHEMA
      AND kcu.TABLE_NAME = c.TABLE_NAME
      AND kcu.COLUMN_NAME = c.COLUMN_NAME
    JOIN
      INFORMATION_SCHEMA.COLUMNS rc
      ON kcu.REFERENCED_TABLE_SCHEMA = rc.TABLE_SCHEMA
      AND kcu.REFERENCED_TABLE_NAME = rc.TABLE_NAME
      AND kcu.REFERENCED_COLUMN_NAME = rc.COLUMN_NAME
    WHERE 
      kcu.TABLE_SCHEMA = ${escapeLiteral(DB_CONFIG.database!)}
      AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
      AND kcu.CONSTRAINT_NAME = ${escapeLiteral(constraintName)}
  `;

  const [constraintInfo] = await mysql.queryRows(query);

  if (constraintInfo.length === 0) {
    throw new Error(`No information found for constraint: ${constraintName}`);
  }

  const [versionResult] = await mysql.queryRows('SELECT VERSION() as version');
  const dbVersion = versionResult[0].version;

  const referencingTable = escapeIdentifier(constraintInfo[0].referencing_table);
  const referencedTable = escapeIdentifier(constraintInfo[0].referenced_table);

  const [referencingStructure] = await mysql.queryRows(`DESCRIBE ${referencingTable}`);
  const [referencedStructure] = await mysql.queryRows(`DESCRIBE ${referencedTable}`);

  async function getTableRowCount(tableName: string): Promise<number> {
    const [result] = await mysql.queryRows(`SELECT COUNT(*) as count FROM ${tableName}`);
    return result[0].count;
  }

  const referencingTableCount = await getTableRowCount(constraintInfo[0].referencing_table);
  const referencedTableCount = await getTableRowCount(constraintInfo[0].referenced_table);

  async function getTableIndexes(tableName: string): Promise<RowDataPacket[]> {
    const [indexes] = await mysql.queryRows(`SHOW INDEX FROM ${tableName}`);
    return indexes;
  }
  const referencingIndexes = await getTableIndexes(constraintInfo[0].referencing_table);
  const referencedIndexes = await getTableIndexes(constraintInfo[0].referenced_table);

  const getForeignKeysQuery = `
    SELECT 
      TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, 
      REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
    FROM 
      INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE 
      TABLE_SCHEMA = ? 
      AND REFERENCED_TABLE_NAME IS NOT NULL
      AND TABLE_NAME IN (?, ?)
  `;
  const [allForeignKeys] = await mysql.executeRows(getForeignKeysQuery, [
    DB_CONFIG.database, 
    constraintInfo[0].referencing_table, 
    constraintInfo[0].referenced_table
  ]);

  const getConstraintsQuery = `
    SELECT 
      TABLE_NAME,
      CONSTRAINT_NAME, 
      CONSTRAINT_TYPE
    FROM 
      INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE 
      TABLE_SCHEMA = ${escapeLiteral(DB_CONFIG.database!)}
      AND TABLE_NAME IN (${escapeLiteral(constraintInfo[0].referencing_table)}, ${escapeLiteral(constraintInfo[0].referenced_table)})
  `;
  const [constraints] = await mysql.queryRows(getConstraintsQuery);

  async function getSampleData(tableName: string, limit = 5): Promise<RowDataPacket[]> {
    try {
      const [rows] = await mysql.queryRows(`SELECT * FROM ${tableName} LIMIT ${limit}`);
      return rows;
    } catch (error) {
      console.error(`Error fetching sample data from ${tableName}: ${(error as Error).message}`);
      return [];
    }
  }
  const referencingSampleData = await getSampleData(constraintInfo[0].referencing_table);
  const referencedSampleData = await getSampleData(constraintInfo[0].referenced_table);

  return `
You are a MySQL expert tasked with resolving foreign key constraint issues during a Mautic database upgrade.

Mautic Error Message:
${mauticError}

Foreign Key Constraint Information:
${JSON.stringify(constraintInfo, null, 2)}

Referencing Table Structure (${constraintInfo[0].referencing_table}):
${JSON.stringify(referencingStructure, null, 2)}

Referenced Table Structure (${constraintInfo[0].referenced_table}):
${JSON.stringify(referencedStructure, null, 2)}

All Foreign Keys:
${JSON.stringify(allForeignKeys, null, 2)}

Other Constraints:
${JSON.stringify(constraints, null, 2)}

Sample Data for Referencing Table (${constraintInfo[0].referencing_table}):
${JSON.stringify(referencingSampleData, null, 2)}

Sample Data for Referenced Table (${constraintInfo[0].referenced_table}):
${JSON.stringify(referencedSampleData, null, 2)}

Table Row Counts:
- ${constraintInfo[0].referencing_table}: ${referencingTableCount} rows
- ${constraintInfo[0].referenced_table}: ${referencedTableCount} rows

Table Indexes:
- ${constraintInfo[0].referencing_table} Indexes: ${JSON.stringify(referencingIndexes, null, 2)}
- ${constraintInfo[0].referenced_table} Indexes: ${JSON.stringify(referencedIndexes, null, 2)}

Database Version: ${dbVersion}
Mautic Version: 3.2.5

Based on this information, please provide step-by-step instructions to resolve the foreign key constraint issue. Consider the following:

1. Analyze any data type mismatches between the referencing and referenced columns.
2. Check for character set or collation incompatibilities.
3. Provide SQL statements to drop and recreate the foreign key constraint with appropriate ON DELETE/UPDATE actions.
4. Suggest necessary ALTER TABLE statements to modify column definitions if needed.
5. Remember that before altering a column, you may need to drop the foreign key constraint, modify the column, and then recreate the constraint.
6. Consider the impact on other constraints and foreign keys, especially recursive relationships, you'll have to drop all the foreign keys that reference the table before altering the column.
7. Ensure that the proposed changes maintain data integrity based on the sample data provided.
8. If changes to multiple tables are required, suggest an order of operations that minimizes conflicts.
9. Pay special attention to the fact that this might be a composite key involving multiple columns.
10. Avoid dropping primary keys.

Please format your response as a series of SQL statements with explanations for each step. If multiple approaches are possible, explain the pros and cons of each.
Assume that all statements will be executed by a database administrator with appropriate permissions in a staging environment before being applied to the production database to prevent data loss or corruption, and that the production database is backed up regularly.
`;
}

main();