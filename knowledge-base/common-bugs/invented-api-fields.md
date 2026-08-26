# Invented API fields break clients

- **ID:** invented-api-fields
- **Type:** common-bugs
- **Tags:** backend, contracts, anti-pattern
- **Summary:** Assuming response fields that the backend does not provide causes runtime UI failures.

## Details

Always evidence fields from OpenAPI, existing clients, or server source. Use Backend Dependency gaps otherwise.
