# Administration Master Data Management Design

## Goal

Allow administrators to add, edit, and deactivate platforms and warehouses from the Administration section.

## Platforms

- Add platform with name, code, channel type, and ingestion method.
- Edit existing platform fields.
- Deactivate instead of deleting platforms.
- Inactive platforms stay linked to historical POs and mappings but are excluded from new PO upload choices.

## Warehouses

- Add warehouse with code, name, city, state, full address, and active status.
- Edit existing warehouse fields.
- Deactivate instead of deleting warehouses.
- Inactive warehouses remain available for historical inventory and PO records but are excluded from new address matching.

## API and database

- Add company-scoped platform create/update endpoints.
- Reuse the existing warehouse create/update endpoints and extend them for address fields.
- Add warehouse address columns and preserve existing references with restrictive foreign keys.
- Log all create, update, and deactivation actions in the existing audit trail.

## Validation

- Require platform code/name and warehouse code/name/city.
- Prevent duplicate platform codes within a company.
- Build API and web applications.
- Verify active filtering, edit forms, deactivation, and historical record visibility.
