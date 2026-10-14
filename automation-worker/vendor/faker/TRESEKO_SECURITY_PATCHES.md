# Treseko Faker compatibility fork

Base: `@faker-js/faker@5.5.3`, the version pinned by `postman-collection@5.3.1`.

Patch: `lib/fake.js` now resolves template modules and methods only through own properties. This blocks inherited constructor access that reproduced arbitrary JavaScript execution while preserving Postman Collection's named Faker generators.

The package version is `5.5.3-treseko.0` to identify the actual compatibility base and local patch. Do not change it to a newer upstream version to suppress npm advisories. Because npm audit ignores this `file:` override, a clean audit result does not cover this fork; retain the local security regression test and track the upstream advisory separately until Postman updates to a compatible release. Replace this fork when that update is available.
