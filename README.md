# Mautic Fix DB AI

This repository provides an LLM prompt generator for fixing problematic foreign key constraint issues that sometimes occur during migrations in Mautic (and potentially other Symfony-based software). These errors often arise when running the `doctrine:schema:update --force` command, which is necessary for pending database upgrades.

## Problem Statement

Foreign key constraint issues can potentially ruin your Mautic database if not handled correctly. However, failing to address these issues can leave you unable to migrate, forcing you to either:

1. Reconstruct your Mautic installation from scratch, potentially losing data in the process.
2. Remain on an outdated Mautic version, dealing with the problems of legacy software.

This script aims to provide a solution by generating a comprehensive prompt for use with advanced Language Models (LLMs) like Claude 3.5 Sonnet or OpenAI ChatGPT 4.

## How It Works

1. The script takes a single argument: your Mautic error in free-form text.
2. It uses an LLM (currently OpenAI, but customizable) to extract the foreign key constraint from the error message.
3. It executes safe, read-only SQL queries on your Mautic database to gather context.
4. It generates a detailed prompt that you can copy and paste into your preferred LLM.
5. The LLM provides step-by-step instructions to fix the issue, which you can execute manually with caution.

## Requirements

- Node.js and npm
- An OpenAI API key
- A LangSmith API key
- Database and server connection details (currently supports database connections over SSH with private key auth)

## Important Considerations

- The script may include samples of data related to the foreign key being fixed. This could potentially include sensitive information from your database/contacts.
- Always review the generated prompt and remove any private information before passing it to an LLM.
- Execute any suggested SQL queries with caution, preferably in a staging environment with a full backup.

## Installation and Setup

1. Clone the repository:
   ```
   git clone https://github.com/aficiomaquinas/mautic-fix-db-ai.git
   cd mautic-fix-db-ai
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following structure:
   ```
   DB_HOST=127.0.0.1
   DB_USER="mauticdbuser"
   DB_PASSWORD="mymauticuserpass"
   DB_NAME="mauticdb"
   DB_PORT=3306

   SSH_HOST="my-mautic-server.com"
   SSH_PORT=22
   SSH_USERNAME="mauticsshuser"
   SSH_PRIVATE_KEY_PATH="/Users/my_user/.ssh/id_rsa"
   SSH_PASSPHRASE="my_private_key_pass"

   OPENAI_API_KEY="sk-proj-xxxxxxxxxxxxx"
   LANGCHAIN_TRACING_V2=true
   LANGCHAIN_ENDPOINT="https://api.smith.langchain.com"
   LANGCHAIN_API_KEY="lsv2_pt_xxxxxxxxxxxxxxxxxxxx4"
   LANGCHAIN_PROJECT="mautic-fix-db-ai"
   ```

## Usage

1. Run the migration fix prompt generator:
   ```
   # The error used here is an example, replace with your own error.
   node ./dist/index.js --error="In AbstractMySQLDriver.php line 106:\n\nAn exception occurred while executing ‘ALTER TABLE mtc_oauth2_accesstokens CHANGE client_id client_id INT UNSIGNED NOT NULL, CHANGE user_id user_id INT UNSIGNED NOT NULL, CHANGE token token VARCHAR(191) NOT NULL, CHANGE expires_at expires_at BIGINT DEFAULT NULL, CHANGE scope scope VARCHAR(191) DEFAULT NULL’:SQLSTATE[HY000]: General error: 1832 Cannot change column ‘client_id’: used in a foreign key constraint ‘FK_818C32519EB6921’\n\nIn PDOConnection.php line 80:SQLSTATE[HY000]: General error: 1832 Cannot change column ‘client_id’: used in a foreign key constraint ‘FK_818C32519EB6921’\n\nIn PDOConnection.php line 75:\n\nSQLSTATE[HY000]: General error: 1832 Cannot change column ‘client_id’: used in a foreign key constraint ‘FK_818C32519EB6921’"
   ```
   Note: Ensure the error message doesn't contain spaces. Use "paste as single line" in your terminal or text editor if needed.

2. Copy the generated prompt and paste it into your preferred LLM (e.g., ChatGPT 4, Claude 3.5, Gemini 1.5).

3. Follow the instructions provided by the LLM, which typically involve:
   - Dropping foreign key constraints
   - Altering table structures
   - Recreating foreign key constraints

4. If queries fail, copy the results back to the LLM for further guidance.

5. Repeat the process with any new errors until `doctrine:schema:update --force` runs without issues.

## Tips for Extensive Fixes

- If fixing multiple errors, you may exhaust your message limit on LLM platforms, even with paid plans.
- Consider using OpenRouter with pay-per-usage for cost-effective solutions when dealing with numerous issues.

## Future Development Considerations

- The script currently uses OpenAI to parse the error and extract the foreign key name. A potential improvement would be to add a second parameter for the foreign key name, allowing users to bypass the LLM parsing step if desired.

## Contributing

Contributions to improve the script or extend its functionality are welcome. Please feel free to submit issues or pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

This project aims to address a long-standing issue in the Mautic community, first identified in the [Mautic forums in July 2020](https://forum.mautic.org/t/error-updating-from-mautic-3-0-3-01/15038) and then [here](https://forum.mautic.org/t/how-to-upgrade-to-mautic-3-1/16203) and [here](https://forum.mautic.org/t/database-migration-error-foreign-key-constraint/18413).