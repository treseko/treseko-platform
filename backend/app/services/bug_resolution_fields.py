"""Separate legacy screen dimensions from the bug's correction notes."""
import re

SCREEN_DIMENSIONS = re.compile(r"^\s*\d{2,5}\s*[xX×]\s*\d{2,5}\s*$")


def normalize_legacy_screen_resolution(values):
    if not isinstance(values, dict):
        return values
    value = values.get("resolucion")
    if "resolucion_pantalla" not in values and isinstance(value, str) and SCREEN_DIMENSIONS.fullmatch(value):
        values = dict(values)
        values["resolucion_pantalla"] = values.pop("resolucion")
    return values
