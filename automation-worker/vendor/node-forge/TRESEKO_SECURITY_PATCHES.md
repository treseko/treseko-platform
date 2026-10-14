# Treseko security patch

This local fork is based on node-forge 1.4.0 and applies the element-count
validation from upstream PR digitalbazaar/forge#1152 (commit `ceba344`). RSA
PKCS#1 v1.5 verification now requires the nested DigestAlgorithm sequence to
contain the OID and, when present, only its optional NULL parameter. This
rejects unconsumed ASN.1 children used by GHSA-86w9-cpqp-85rv / CVE-2026-85393.

Remove this fork and use the upstream fixed release once one is published and
validated.
