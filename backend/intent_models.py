"""Validated AI output, independent of the external model client."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

IntentValue = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]


class BusinessIntent(BaseModel):
    # Keep the original fields for existing API consumers.
    product: IntentValue | None = None
    market: IntentValue | None = None
    metric: IntentValue | None = None
    products: list[IntentValue] = Field(default_factory=list, max_length=10)
    markets: list[IntentValue] = Field(default_factory=list, max_length=10)
    metrics: list[IntentValue] = Field(default_factory=list, max_length=10)
    intent: Literal["find_existing_analytics", "create_analytics", "unknown"]

    @model_validator(mode="after")
    def reconcile_fields(self):
        for singular, plural in (
            ("product", "products"), ("market", "markets"), ("metric", "metrics")
        ):
            value = getattr(self, singular)
            values = list(dict.fromkeys(getattr(self, plural)))
            if value and values and value.casefold() not in {
                item.casefold() for item in values
            }:
                raise ValueError(f"Conflicting {singular} and {plural}")
            if value and not values:
                values = [value]
            setattr(self, plural, values)
            if not value and len(values) == 1:
                setattr(self, singular, values[0])
        return self
