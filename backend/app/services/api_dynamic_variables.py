"""Postman-compatible dynamic variables for the declarative API runner.

The real Postman runtime uses Faker-backed values.  Treseko intentionally does
not execute that runtime or add a dependency on it: this module provides the
same public variable names with small, deterministic generators instead.  A
seed is attached to every API execution so the effective request can be
reproduced from its evidence.
"""
from __future__ import annotations

import hashlib
import ipaddress
import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any


DYNAMIC_VARIABLE_PATTERN = re.compile(r"\{\{\s*(\$[A-Za-z][A-Za-z0-9_]*)\s*\}\}")

# This list follows Postman's documented dynamic-variable catalog.  Keeping it
# explicit is important: unknown placeholders must remain visible and must not
# silently turn into arbitrary data.
DYNAMIC_VARIABLE_NAMES = frozenset({
    "$guid", "$timestamp", "$isoTimestamp", "$randomUUID", "$uuid",
    "$randomAlphaNumeric", "$randomBoolean", "$randomInt", "$randomColor",
    "$randomHexColor", "$randomAbbreviation", "$randomIP", "$randomIPV6",
    "$randomMACAddress", "$randomPassword", "$randomLocale", "$randomUserAgent",
    "$randomProtocol", "$randomSemver", "$randomFirstName", "$randomLastName",
    "$randomFullName", "$randomNamePrefix", "$randomNameSuffix", "$randomJobTitle",
    "$randomJobArea", "$randomJobDescriptor", "$randomJobType",
    "$randomPhoneNumber", "$randomPhoneNumberExt", "$randomCity", "$randomStreetName",
    "$randomStreetAddress", "$randomCountry", "$randomCountryCode", "$randomLatitude",
    "$randomLongitude", "$randomImageDataUri", "$randomAvatarImage", "$randomImageUrl",
    "$randomAbstractImage", "$randomNatureImage", "$randomAnimalImage", "$randomFoodImage",
    "$randomNightlifeImage", "$randomBusinessImage", "$randomSportsImage", "$randomTransportImage",
    "$randomAnimalsImage", "$randomCatsImage", "$randomCityImage", "$randomFashionImage", "$randomPeopleImage",
    "$randomCreditCardMask", "$randomBankAccount", "$randomBankAccountName", "$randomBankAccountBic", "$randomBankAccountIban",
    "$randomTransactionType",
    "$randomCurrencyCode", "$randomCurrencyName", "$randomCurrencySymbol", "$randomBitcoin",
    "$randomCompanyName", "$randomCompanySuffix", "$randomBs", "$randomBsAdjective",
    "$randomBsBuzz", "$randomBsNoun", "$randomCatchPhrase", "$randomCatchPhraseAdjective",
    "$randomCatchPhraseDescriptor", "$randomCatchPhraseNoun", "$randomDatabaseColumn",
    "$randomDatabaseType", "$randomDatabaseEngine", "$randomDatabaseCollation", "$randomDateFuture", "$randomDatePast",
    "$randomDateRecent", "$randomWeekday", "$randomMonth", "$randomDomainName",
    "$randomDomainSuffix", "$randomDomainWord", "$randomEmail", "$randomExampleEmail", "$randomUserName", "$randomUrl",
    "$randomFileName", "$randomFileType", "$randomFileExt", "$randomCommonFileName",
    "$randomCommonFileType", "$randomCommonFileExt", "$randomFilePath", "$randomDirectoryPath",
    "$randomMimeType", "$randomProductName", "$randomProductAdjective", "$randomProductMaterial",
    "$randomProduct", "$randomProductDescription", "$randomAdjective", "$randomNoun", "$randomPrice", "$randomDepartment",
    "$randomVerb", "$randomIngverb", "$randomPhrase", "$randomLoremWord",
    "$randomLoremWords", "$randomLoremSentence", "$randomLoremSentences", "$randomLoremParagraph",
    "$randomLoremParagraphs", "$randomLoremSlug", "$randomLoremText", "$randomLoremLines",
    "$randomWord", "$randomWords",
    "$randomUserAgent",
})

POSTMAN_EXTENSION_VARIABLE_NAMES = frozenset({"$uuid", "$randomAnimalImage", "$randomProductDescription"})
POSTMAN_OFFICIAL_DYNAMIC_VARIABLE_NAMES = DYNAMIC_VARIABLE_NAMES - POSTMAN_EXTENSION_VARIABLE_NAMES
DYNAMIC_VARIABLE_CATALOG_VERSION = "postman-dynamic-variables-2026-08"
_ANY_DYNAMIC_VARIABLE_PATTERN = re.compile(r"\{\{\s*(\$[A-Za-z][A-Za-z0-9_]*)\s*\}\}")
SENSITIVE_DYNAMIC_VARIABLE_PATTERN = re.compile(r"password|token|secret|authorization|api[-_]?key|cookie", re.IGNORECASE)


def derive_case_dynamic_seed(run_seed: str | int | None, case_id: str) -> str:
    """Derive an isolated, reproducible seed for one case execution."""
    base = str(run_seed or "treseko-default-seed")
    return hashlib.sha256(f"{base}:{case_id}".encode("utf-8")).hexdigest()[:32]


def dynamic_catalog() -> list[dict[str, str]]:
    """Return the stable catalog used by editors and execution previews."""
    catalog_context = DynamicVariableContext("catalog")
    return [
        {
            "name": name,
            "expression": f"{{{{{name}}}}}",
            "description": name.removeprefix("$").replace("_", " "),
            "example": str(catalog_context.ensure(name)),
        }
        for name in sorted(DYNAMIC_VARIABLE_NAMES)
    ]


def extract_unsupported_dynamic_variable_names(value: Any) -> set[str]:
    """Return ``{{$...}}`` placeholders that are not in the safe catalog."""
    names: set[str] = set()
    if isinstance(value, str):
        names.update(
            match.group(1)
            for match in _ANY_DYNAMIC_VARIABLE_PATTERN.finditer(value)
            if match.group(1) not in DYNAMIC_VARIABLE_NAMES
        )
    elif isinstance(value, list):
        for item in value:
            names.update(extract_unsupported_dynamic_variable_names(item))
    elif isinstance(value, dict):
        for item in value.values():
            names.update(extract_unsupported_dynamic_variable_names(item))
    return names


def safe_dynamic_values(context: "DynamicVariableContext") -> dict[str, Any]:
    """Expose only generated values actually used by the current context."""
    return {
        name: "[REDACTED]" if SENSITIVE_DYNAMIC_VARIABLE_PATTERN.search(name) else value
        for name, value in context.values.items()
    }


def extract_dynamic_variable_names(value: Any) -> set[str]:
    """Return only supported dynamic placeholders found in arbitrary JSON."""
    names: set[str] = set()
    if isinstance(value, str):
        names.update(match.group(1) for match in DYNAMIC_VARIABLE_PATTERN.finditer(value) if match.group(1) in DYNAMIC_VARIABLE_NAMES)
    elif isinstance(value, list):
        for item in value:
            names.update(extract_dynamic_variable_names(item))
    elif isinstance(value, dict):
        for item in value.values():
            names.update(extract_dynamic_variable_names(item))
    return names


def _iso_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class DynamicVariableContext:
    """Generate one stable value per dynamic variable within one execution."""

    def __init__(self, seed: int | str | None = None) -> None:
        if seed is None:
            seed = random.SystemRandom().getrandbits(64)
        self.seed = str(seed)
        self._random = random.Random(self.seed)
        clock_offset = int.from_bytes(hashlib.sha256(self.seed.encode("utf-8")).digest()[:6], "big") % (10 * 365 * 24 * 60 * 60)
        self._clock = datetime(2020, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=clock_offset)
        self.values: dict[str, Any] = {}
        self.occurrences: list[dict[str, Any]] = []

    def ensure(self, name: str) -> Any:
        name = str(name).strip()
        if name not in DYNAMIC_VARIABLE_NAMES:
            return None
        if name not in self.values:
            self.values[name] = self._generate(name)
        return self.values[name]

    def resolve_string(self, value: str, *, source: str = "request") -> str:
        def replace(match: re.Match[str]) -> str:
            name = match.group(1)
            if name not in DYNAMIC_VARIABLE_NAMES:
                return match.group(0)
            resolved = self.ensure(name)
            self.occurrences.append({"name": name, "value": resolved, "source": source})
            return str(resolved)

        return DYNAMIC_VARIABLE_PATTERN.sub(replace, value)

    def resolve(self, value: Any, *, source: str = "request") -> Any:
        if isinstance(value, str):
            return self.resolve_string(value, source=source)
        if isinstance(value, list):
            return [self.resolve(item, source=source) for item in value]
        if isinstance(value, dict):
            return {key: self.resolve(item, source=source) for key, item in value.items()}
        return value

    def _choice(self, values: list[str]) -> str:
        return self._random.choice(values)

    def _generate(self, name: str) -> Any:  # noqa: C901 - catalog is intentionally explicit
        now = self._clock
        if name in {"$guid", "$randomUUID", "$uuid"}:
            # UUIDv4-like output, deterministic for a seed but valid for clients.
            raw = bytearray(self._random.getrandbits(8) for _ in range(16))
            raw[6] = (raw[6] & 0x0F) | 0x40
            raw[8] = (raw[8] & 0x3F) | 0x80
            return str(uuid.UUID(bytes=bytes(raw)))
        if name == "$timestamp":
            return int(now.timestamp())
        if name == "$isoTimestamp":
            return _iso_timestamp(now)
        if name == "$randomAlphaNumeric":
            return self._choice("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        if name == "$randomBoolean":
            return self._random.choice([True, False])
        if name == "$randomInt":
            return self._random.randint(0, 1000)
        if name == "$randomColor":
            return self._choice(["red", "green", "blue", "yellow", "purple", "orange", "black", "white"])
        if name == "$randomHexColor":
            return f"#{self._random.randrange(0x1000000):06x}"
        if name == "$randomAbbreviation":
            return "".join(self._random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(3))
        if name == "$randomIP":
            return str(ipaddress.IPv4Address(self._random.randrange(0x0B000001, 0xDFFFFFFE)))
        if name == "$randomIPV6":
            return str(ipaddress.IPv6Address(self._random.getrandbits(128)))
        if name == "$randomMACAddress":
            return ":".join(f"{self._random.randrange(256):02x}" for _ in range(6))
        if name == "$randomPassword":
            alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%"
            return "".join(self._random.choice(alphabet) for _ in range(16))
        if name == "$randomLocale":
            return self._choice(["en-US", "es-AR", "es-ES", "pt-BR", "fr-FR", "de-DE"])
        if name == "$randomUserAgent":
            return self._choice(["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", "TresekoApiTest/1.0", "PostmanRuntime/7.43.0"])
        if name == "$randomProtocol":
            return self._choice(["http", "https"])
        if name == "$randomSemver":
            return f"{self._random.randint(0, 9)}.{self._random.randint(0, 20)}.{self._random.randint(0, 99)}"

        first = ["Alex", "Camila", "Jordan", "Taylor", "Morgan", "Sam", "Lucía", "Mateo"]
        last = ["García", "Smith", "Miller", "Rossi", "Brown", "Díaz", "Wilson"]
        city = ["Buenos Aires", "Córdoba", "Rosario", "Madrid", "Austin", "Toronto"]
        country = [("Argentina", "AR"), ("United States", "US"), ("Spain", "ES"), ("Brazil", "BR"), ("Canada", "CA")]
        if name == "$randomFirstName": return self._choice(first)
        if name == "$randomLastName": return self._choice(last)
        if name == "$randomFullName": return f"{self._choice(first)} {self._choice(last)}"
        if name == "$randomNamePrefix": return self._choice(["Mr.", "Ms.", "Dr.", "Ing."])
        if name == "$randomNameSuffix": return self._choice(["Jr.", "Sr.", "III", "PhD"])
        if name == "$randomJobTitle": return self._choice(["QA Engineer", "Product Manager", "Backend Developer", "Support Analyst"])
        if name == "$randomJobArea": return self._choice(["Engineering", "Quality Assurance", "Product", "Operations", "Support"])
        if name == "$randomJobDescriptor": return self._choice(["Senior", "Lead", "Principal", "Associate", "Specialist"])
        if name == "$randomJobType": return self._choice(["full-time", "part-time", "contract", "temporary"])
        if name in {"$randomPhoneNumber", "$randomPhoneNumberExt"}:
            number = f"+54 11 {self._random.randint(1000, 9999)}-{self._random.randint(1000, 9999)}"
            return f"{number} x{self._random.randint(100, 999)}" if name.endswith("Ext") else number
        if name == "$randomCity": return self._choice(city)
        if name == "$randomStreetName": return self._choice(["San Martín", "Belgrano", "Independencia", "Libertad"])
        if name == "$randomStreetAddress": return f"{self._random.randint(1, 9999)} {self._choice(['San Martín', 'Belgrano', 'Libertad'])}"
        if name == "$randomCountry": return self._choice(country)[0]
        if name == "$randomCountryCode": return self._choice(country)[1]
        if name == "$randomLatitude": return f"{self._random.uniform(-55, 55):.6f}"
        if name == "$randomLongitude": return f"{self._random.uniform(-170, 170):.6f}"

        if name in {"$randomImageDataUri", "$randomAvatarImage", "$randomImageUrl", "$randomAbstractImage", "$randomNatureImage", "$randomAnimalImage", "$randomAnimalsImage", "$randomCatsImage", "$randomCityImage", "$randomFashionImage", "$randomPeopleImage", "$randomFoodImage", "$randomNightlifeImage", "$randomBusinessImage", "$randomSportsImage", "$randomTransportImage"}:
            if name == "$randomImageDataUri":
                return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%233b82f6'/%3E%3C/svg%3E"
            category = name.removeprefix("$random").removesuffix("Image") or "image"
            return f"https://picsum.photos/seed/{category.lower()}-{self._random.randint(1, 999999)}/640/480"

        if name == "$randomCreditCardMask": return "************" + f"{self._random.randint(0, 9999):04d}"
        if name == "$randomBankAccount": return f"{self._random.randint(10000000, 99999999)}"
        if name == "$randomBankAccountName": return self._choice(["Banco Demo", "Treseko Bank", "QA Finance"])
        if name == "$randomBankAccountBic": return self._choice(["TRESAR2X", "QAFNARBA", "DEMOUS33"])
        if name == "$randomBankAccountIban": return f"GB82WEST{self._random.randint(1000000000, 9999999999)}"
        if name == "$randomTransactionType": return self._choice(["payment", "refund", "transfer", "withdrawal", "deposit"])
        if name == "$randomCurrencyCode": return self._choice(["ARS", "USD", "EUR", "BRL"])
        if name == "$randomCurrencyName": return self._choice(["Argentine Peso", "US Dollar", "Euro", "Brazilian Real"])
        if name == "$randomCurrencySymbol": return self._choice(["$", "€", "£"])
        if name == "$randomBitcoin": return "bc1q" + "".join(self._random.choice("023456789acdefghjklmnpqrstuvwxyz") for _ in range(30))

        company = self._choice(["Treseko", "Acme", "Globex", "Northwind", "Contoso"])
        if name == "$randomCompanyName": return company
        if name == "$randomCompanySuffix": return self._choice(["LLC", "Inc", "S.A.", "Ltd"])
        if name == "$randomBs": return self._choice(["optimize platforms", "scale workflows", "orchestrate APIs"])
        if name == "$randomBsAdjective": return self._choice(["robust", "scalable", "integrated", "agile"])
        if name == "$randomBsBuzz": return self._choice(["synergy", "mindshare", "paradigm", "bandwidth"])
        if name == "$randomBsNoun": return self._choice(["solutions", "platforms", "interfaces", "channels"])
        if name in {"$randomCatchPhrase", "$randomCatchPhraseAdjective", "$randomCatchPhraseDescriptor", "$randomCatchPhraseNoun"}:
            if name == "$randomCatchPhrase": return "Seamless quality for every workflow"
            return self._choice(["seamless", "scalable", "quality", "workflow"])
        if name == "$randomDatabaseColumn": return self._choice(["id", "created_at", "status", "customer_name"])
        if name == "$randomDatabaseType": return self._choice(["uuid", "varchar", "integer", "timestamp"])
        if name == "$randomDatabaseEngine": return self._choice(["PostgreSQL", "MySQL", "SQLite", "Redis"])
        if name == "$randomDatabaseCollation": return self._choice(["en_US.UTF-8", "C.UTF-8", "und-x-icu"])
        if name in {"$randomDateFuture", "$randomDatePast", "$randomDateRecent"}:
            offset = self._random.randint(1, 365)
            if name == "$randomDatePast": offset = -offset
            if name == "$randomDateRecent": offset = -self._random.randint(0, 30)
            return (now.date().fromordinal(now.date().toordinal() + offset)).isoformat()
        if name == "$randomWeekday": return self._choice(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])
        if name == "$randomMonth": return self._choice(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"])

        if name in {"$randomDomainName", "$randomDomainSuffix", "$randomEmail", "$randomExampleEmail", "$randomUserName"}:
            suffix = self._choice(["test", "example.test", "invalid"])
            if name == "$randomDomainSuffix": return suffix
            user = f"{self._choice(first).lower()}.{self._choice(last).lower()}".replace("í", "i")
            if name == "$randomUserName": return user.replace(".", "_")
            domain = f"{user.replace('.', '-')}.{suffix}" if suffix != "example.test" else f"{user.replace('.', '-')}.example.test"
            if name == "$randomExampleEmail":
                return f"{user}@example.test"
            return f"{user}@{domain}" if name == "$randomEmail" else domain
        if name == "$randomDomainWord": return self._choice(["api", "demo", "qa", "service", "cloud", "platform"])
        if name == "$randomUrl": return f"https://{self._choice(['api', 'demo', 'qa'])}.example.test/{self._choice(['health', 'status', 'items'])}"

        if name in {"$randomFileName", "$randomCommonFileName"}: return self._choice(["payload", "request", "fixture", "evidence"]) + ".json"
        if name in {"$randomFileType", "$randomCommonFileType"}: return self._choice(["json", "text", "image", "csv"])
        if name in {"$randomFileExt", "$randomCommonFileExt"}: return self._choice([".json", ".txt", ".csv", ".png"])
        if name == "$randomFilePath": return f"/tmp/{self._choice(['payload', 'fixture', 'request'])}.json"
        if name == "$randomDirectoryPath": return "/tmp/treseko-fixtures"
        if name == "$randomMimeType": return self._choice(["application/json", "text/plain", "text/csv", "image/png"])

        product = self._choice(["API Monitor", "QA Console", "Test Runner", "Evidence Hub"])
        if name == "$randomProductName": return product
        if name == "$randomProductAdjective": return self._choice(["reliable", "portable", "observable", "fast"])
        if name == "$randomProductMaterial": return self._choice(["cloud", "data", "workflow", "service"])
        if name == "$randomProduct": return f"{self._choice(['Professional', 'Enterprise', 'Starter'])} {product}"
        if name == "$randomProductDescription": return f"{product} for repeatable API validation"
        if name == "$randomPrice": return f"{self._random.uniform(1, 9999):.2f}"
        if name == "$randomDepartment": return self._choice(["Engineering", "Finance", "Operations", "Sales", "Support"])
        if name == "$randomAdjective": return self._choice(["clear", "stable", "fast", "reliable"])
        if name == "$randomNoun": return self._choice(["request", "response", "contract", "case"])
        if name == "$randomVerb": return self._choice(["validate", "execute", "inspect", "capture"])
        if name == "$randomIngverb": return self._choice(["validating", "executing", "inspecting", "capturing"])
        if name == "$randomPhrase": return f"{self._choice(['Validate', 'Execute', 'Inspect'])} the {self._choice(['request', 'response', 'contract'])}"

        words = ["api", "test", "response", "quality", "service", "request", "data", "contract"]
        if name == "$randomLoremWord": return self._choice(words)
        if name == "$randomWord": return self._choice(words)
        if name == "$randomWords": return " ".join(self._choice(words) for _ in range(self._random.randint(2, 6)))
        if name in {"$randomLoremWords", "$randomLoremText"}: return " ".join(self._choice(words) for _ in range(8))
        if name in {"$randomLoremSentence", "$randomLoremSentences", "$randomLoremParagraph", "$randomLoremParagraphs", "$randomLoremLines"}:
            sentence = " ".join(self._choice(words) for _ in range(8)).capitalize() + "."
            count = {"$randomLoremSentence": 1, "$randomLoremSentences": 3, "$randomLoremParagraph": 5, "$randomLoremParagraphs": 8, "$randomLoremLines": 4}[name]
            return "\n".join(sentence for _ in range(count))
        if name == "$randomLoremSlug": return "-".join(self._choice(words) for _ in range(4))
        return None
