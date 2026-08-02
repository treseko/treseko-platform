# Inventory guide

<!-- Language: en -->

Inventory records the assets and endpoints involved in testing: equipment, browsers, devices, services, test accounts or other project resources.

## Organize the inventory

1. Open **Inventory** with the correct project selected.
2. Create the folders or categories that represent your environment.
3. Add each asset with an identifiable name, type and state.
4. Complete the technical data and endpoints only when they are useful for executing or reproducing a test.
5. Save and review that the asset is in the correct category.

## Best practices

- Do not store secrets or real passwords in notes or endpoints.
- Use stable names, for example `QA Chrome Windows` or `API staging`.
- Update the state of an asset when it is no longer available.
- Delete only assets that have no historical value nor active references.

The inventory complements the project's environments and datasets. Use the [project guide](PROJECTS_GUIDE.md) to define those elements before associating them with the cases.