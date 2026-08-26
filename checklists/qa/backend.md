# QA Checklist — Backend

- [ ] Endpoints enforce authz consistent with existing guards
- [ ] Input validation covers required fields and invalid payloads
- [ ] Error responses follow existing error helpers / status conventions
- [ ] Database changes (if any) are migrated and reversible or documented
- [ ] Idempotency / concurrency considered for write paths
- [ ] Logging does not emit secrets
- [ ] Contract changes documented for consumers
