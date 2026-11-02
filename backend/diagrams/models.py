import math
import re
from collections.abc import Mapping
from uuid import uuid4

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
SHAPE_PORTS = {
    "action": {"top", "right", "bottom", "left"},
    "decision": {"top", "right", "bottom", "left"},
    "terminator": {"top", "right", "bottom", "left"},
    "hexagon": {
        "top",
        "upper-right",
        "lower-right",
        "bottom",
        "lower-left",
        "upper-left",
    },
    "text": {"top", "right", "bottom", "left"},
}


def default_viewport():
    return {"x": 0, "y": 0, "zoom": 1}


def validate_finite(value):
    if not math.isfinite(value):
        raise ValidationError("Value must be a finite number.")


def validate_color(value):
    if not isinstance(value, str) or not HEX_COLOR.fullmatch(value):
        raise ValidationError("Use a six-digit hexadecimal color.")


def validate_visual_properties(value):
    if not isinstance(value, Mapping) or set(value) - {"fill", "stroke", "text"}:
        raise ValidationError("Visual properties may only contain fill, stroke, and text.")
    for color in value.values():
        validate_color(color)


def validate_viewport(value):
    if not isinstance(value, Mapping) or set(value) != {"x", "y", "zoom"}:
        raise ValidationError("Viewport must contain x, y, and zoom.")
    for key in ("x", "y", "zoom"):
        number = value[key]
        if isinstance(number, bool) or not isinstance(number, (int, float)):
            raise ValidationError(f"Viewport {key} must be a number.")
        validate_finite(number)
    if not 0.05 <= value["zoom"] <= 4:
        raise ValidationError("Viewport zoom must be between 0.05 and 4.")


def validate_bend_points(value):
    if not isinstance(value, list) or len(value) > 100:
        raise ValidationError("Bend points must be a list with at most 100 entries.")
    for point in value:
        if not isinstance(point, Mapping) or set(point) != {"x", "y"}:
            raise ValidationError("Each bend point must contain x and y.")
        for coordinate in point.values():
            if isinstance(coordinate, bool) or not isinstance(coordinate, (int, float)):
                raise ValidationError("Bend point coordinates must be numbers.")
            validate_finite(coordinate)


class Diagram(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="diagrams",
    )
    title = models.CharField(max_length=200, blank=True, default="")
    description = models.TextField(blank=True, default="", max_length=2000)
    viewport = models.JSONField(
        default=default_viewport,
        validators=[validate_viewport],
    )
    revision = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]

    def __str__(self):
        return self.title or "Untitled diagram"


class Node(models.Model):
    class Shape(models.TextChoices):
        ACTION = "action", "Action"
        DECISION = "decision", "Decision"
        TERMINATOR = "terminator", "Start / end"
        HEXAGON = "hexagon", "Hexagon"
        TEXT = "text", "Text"

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    diagram = models.ForeignKey(Diagram, on_delete=models.CASCADE, related_name="nodes")
    shape_type = models.CharField(max_length=20, choices=Shape.choices)
    label = models.CharField(max_length=300, blank=True, default="")
    annotation = models.TextField(blank=True, default="", max_length=10000)
    x = models.FloatField(validators=[validate_finite, MinValueValidator(-10000000), MaxValueValidator(10000000)])
    y = models.FloatField(validators=[validate_finite, MinValueValidator(-10000000), MaxValueValidator(10000000)])
    width = models.FloatField(
        validators=[validate_finite, MinValueValidator(24), MaxValueValidator(10000)]
    )
    height = models.FloatField(
        validators=[validate_finite, MinValueValidator(24), MaxValueValidator(10000)]
    )
    visual_properties = models.JSONField(default=dict, validators=[validate_visual_properties])
    z_index = models.IntegerField(default=0)

    class Meta:
        ordering = ["z_index", "id"]
        indexes = [models.Index(fields=["diagram", "z_index"])]

    def __str__(self):
        return self.label or self.get_shape_type_display()


class Edge(models.Model):
    class LineStyle(models.TextChoices):
        SOLID = "solid", "Solid"
        DASHED = "dashed", "Dashed"

    class Arrowheads(models.TextChoices):
        NONE = "none", "None"
        START = "start", "Start"
        END = "end", "End"
        BOTH = "both", "Both"

    class PathType(models.TextChoices):
        STRAIGHT = "straight", "Straight"
        STEP = "step", "Orthogonal"

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    diagram = models.ForeignKey(Diagram, on_delete=models.CASCADE, related_name="edges")
    source = models.ForeignKey(Node, on_delete=models.CASCADE, related_name="outgoing_edges")
    target = models.ForeignKey(Node, on_delete=models.CASCADE, related_name="incoming_edges")
    source_port = models.CharField(max_length=30)
    target_port = models.CharField(max_length=30)
    label = models.CharField(max_length=300, blank=True, default="")
    color = models.CharField(max_length=7, default="#536273", validators=[validate_color])
    width = models.FloatField(
        default=2,
        validators=[validate_finite, MinValueValidator(0.5), MaxValueValidator(12)],
    )
    line_style = models.CharField(
        max_length=10,
        choices=LineStyle.choices,
        default=LineStyle.SOLID,
    )
    arrowheads = models.CharField(
        max_length=10,
        choices=Arrowheads.choices,
        default=Arrowheads.END,
    )
    path_type = models.CharField(
        max_length=10,
        choices=PathType.choices,
        default=PathType.STRAIGHT,
    )
    bend_points = models.JSONField(default=list, validators=[validate_bend_points])

    class Meta:
        indexes = [models.Index(fields=["diagram", "source"]), models.Index(fields=["diagram", "target"])]

    def clean(self):
        super().clean()
        if self.source_id and self.target_id:
            if self.source.diagram_id != self.diagram_id or self.target.diagram_id != self.diagram_id:
                raise ValidationError("Edge endpoints must belong to the same diagram.")
            for node, port_field in (
                (self.source, "source_port"),
                (self.target, "target_port"),
            ):
                port = getattr(self, port_field)
                if port not in SHAPE_PORTS[node.shape_type]:
                    raise ValidationError({port_field: "Port is not available on this shape."})
