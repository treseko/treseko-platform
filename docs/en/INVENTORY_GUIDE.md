# Inventory guide

<!-- Language: en -->

Inventory records assets and endpoints that help describe or reproduce an
environment. It does not replace Environments, Datasets or the executable case
configuration.

## What you can record

An asset can be a server, computer, browser, device, service, API, database,
container, execution node or another resource. Depending on its type, you can
complete its nature, state, criticality, owner, location, operating system,
manufacturer, model, serial number, asset tag, parent asset, endpoints and
custom metadata.

## Create or update an asset

1. Open **Inventory** with the correct project.
2. Choose a category.
3. Select **New asset** or open an existing one.
4. Complete the name, type, state and useful data.
5. Add endpoints with their type, value, port, protocol and primary flag when
   appropriate.
6. Save and verify the category and parent-child relationship.

Documenting an endpoint does not by itself enable a connection. `API` and
`CONVERSACIONAL` cases resolve their contract from the environment, dataset and
case.

## Inventory, environments and datasets

| Element | Answers | Use |
|---|---|---|
| Inventory | What resource exists? | Identify assets and endpoints. |
| Environment | Where does it run? | Resolve the destination and configuration. |
| Dataset | With which data? | Provide prepared values. |

Do not store real passwords, tokens or secrets in notes, metadata or endpoints.

## Best practices and permissions

- Use stable names, such as `QA Chrome Windows` or `API staging`.
- Keep the state, owner and primary endpoint up to date.
- Do not delete assets with active references or historical value.
- Editing and deletion depend on your permissions and existing relationships.
- `PERFORMANCE` is reserved; do not use Inventory to simulate an undocumented
  load executor.

To prepare the context, see the [Project guide](PROJECTS_GUIDE.md).
