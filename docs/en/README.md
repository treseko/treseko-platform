# Treseko Community documentation

<!-- Language: en -->

> Español: [Documentación en español](../README.md)

This documentation helps you install Treseko, organize QA work and administer
the platform. Each guide explains what is available, how to use it and what to
check when something does not behave as expected.

## Contact

- Maintainer: [José Manuel Zúñiga](https://www.linkedin.com/in/jose-manuel-zuniga/)
- Website: [biuler.com](https://www.biuler.com)
- Email: [jose@treseko.com](mailto:jose@treseko.com)

## Getting started

1. [Quick installation](INSTALLATION.md): install Treseko with Docker or from your computer over SSH.
2. [Docker guide](DOCKER_GUIDE.md): configure a persistent installation.
3. [Access, users and permissions](AUTH_RBAC_GUIDE.md): create the first users and roles.
4. [Suite and case portability](CASE_PORTABILITY.md): import or export your cases.
5. [Linux installation](LINUX_SETUP.md): prepare a Linux installation step by step.

## Using Treseko

- [Create and maintain test cases](TEST_CASES_GUIDE.md)
- [Run tests](TEST_EXECUTION_GUIDE.md)
- [Test formats and modalities](TEST_TYPES_AND_EXECUTION.md)
- [API testing](API_TESTING_GUIDE.md)
- [Conversational testing](CONVERSATIONAL_TESTING_GUIDE.md)
- [Import compatibility](CASE_IMPORT_COMPATIBILITY.md)

## Automation and AI

- [Automation](AUTOMATION_GUIDE.md)
- [External automation: generate an API key and report executions](API_USAGE_GUIDE.md)
- [External automation API contract](EXTERNAL_AUTOMATION_API.md)
- [External automation reporting API](API_SPEC.md)
- [Automation Worker](AUTOMATION_WORKER_V1.md)
- [AI Engine operation](AI_ENGINE_GUIDE.md)
- [AI Engine configuration](AI_ENGINE_CONFIG.md)
- [Governed MCP](MCP_GUIDE.md)

## Bugs, incidents and reports

- [Bug Tracker](BUG_TRACKER.md)
- [Incident Center](INCIDENT_CENTER_GUIDE.md)
- [Attachments and evidence](ATTACHMENTS_EVIDENCE.md)
- [Reports and metrics](REPORTING_GUIDE.md)
- [Run history](RUN_HISTORY_GUIDE.md)
- [Traceability](TRACEABILITY.md)

## Administration and reference

- [Community and Premium editions](EDITION_STRATEGY.md)
- [Integrations and plugins](INTEGRATIONS_PLUGIN_RBAC.md)
- [Permissions matrix by role](RBAC_MATRIX.md)
- [Capabilities matrix](RBAC_CAPABILITY_MATRIX.md)
- [Architecture](ARCHITECTURE.md)
- [Recommended distributed deployment](DISTRIBUTED_DEPLOYMENT_GUIDE.md)
- [Database](DATABASE.md)

## Scope of the formats

The format defines the case structure, while the modality defines how it is
executed. They are not interchangeable categories:

| Format | Use | Documented modalities |
| --- | --- | --- |
| `CLASICA` | Steps, data and expected result for each step. | Manual, automated or AI-assisted, according to the available configuration. |
| `API` | Declarative HTTP contract, variables and assertions. | Manual or automated through the existing worker. API + AI should be considered available only when the installation certifies that path end to end. |
| `CONVERSACIONAL` | Endpoint, turns, memory, tools and evaluation. | Manual, automated or AI-assisted. |
| `PERFORMANCE` | Reserved/extensible format. | No public executor documented in this version. |

To create and run cases, start with [Create and maintain test cases](TEST_CASES_GUIDE.md), [Run tests](TEST_EXECUTION_GUIDE.md) and [External automation](API_USAGE_GUIDE.md).

## Distributed version

The stable distributed version is `1.0.3`. It includes API and conversational
formats, unified worker execution, format-specific evidence, bugs, report
snapshots, traceability, automation, AI and administration.

See the [changelog](../../CHANGELOG.md) for the included changes.

## Official links

- Website: [treseko.com](https://treseko.com)
- [Terms and conditions](https://treseko.com/terminos-y-condiciones)
