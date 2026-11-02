from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.validators import MaxValueValidator, MinValueValidator
from rest_framework import serializers

from .models import (
    Diagram,
    Edge,
    Node,
    SHAPE_PORTS,
    validate_bend_points,
    validate_color,
    validate_finite,
    validate_viewport,
    validate_visual_properties,
)

User = get_user_model()


class RegistrationSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("A user with this username already exists.")
        return value

    def validate(self, attrs):
        validate_password(attrs["password"], User(username=attrs["username"]))
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class DiagramCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Diagram
        fields = ["title", "description"]


class DiagramUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Diagram
        fields = ["title", "description"]


class GraphNodeSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    shape_type = serializers.ChoiceField(choices=Node.Shape.choices)
    label = serializers.CharField(max_length=300, allow_blank=True)
    annotation = serializers.CharField(max_length=10000, allow_blank=True)
    x = serializers.FloatField(
        validators=[validate_finite, MinValueValidator(-10000000), MaxValueValidator(10000000)]
    )
    y = serializers.FloatField(
        validators=[validate_finite, MinValueValidator(-10000000), MaxValueValidator(10000000)]
    )
    width = serializers.FloatField(
        validators=[validate_finite, MinValueValidator(24), MaxValueValidator(10000)]
    )
    height = serializers.FloatField(
        validators=[validate_finite, MinValueValidator(24), MaxValueValidator(10000)]
    )
    visual_properties = serializers.JSONField(
        required=False,
        default=dict,
        validators=[validate_visual_properties],
    )
    z_index = serializers.IntegerField(required=False, default=0)


class GraphEdgeSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    source = serializers.UUIDField()
    target = serializers.UUIDField()
    source_port = serializers.CharField(max_length=30)
    target_port = serializers.CharField(max_length=30)
    label = serializers.CharField(max_length=300, allow_blank=True)
    color = serializers.CharField(max_length=7, validators=[validate_color])
    width = serializers.FloatField(
        validators=[validate_finite, MinValueValidator(0.5), MaxValueValidator(12)]
    )
    line_style = serializers.ChoiceField(choices=Edge.LineStyle.choices)
    arrowheads = serializers.ChoiceField(choices=Edge.Arrowheads.choices)
    path_type = serializers.ChoiceField(choices=Edge.PathType.choices)
    bend_points = serializers.JSONField(validators=[validate_bend_points])


class GraphSnapshotSerializer(serializers.Serializer):
    expected_revision = serializers.IntegerField(min_value=0)
    title = serializers.CharField(max_length=200, allow_blank=True)
    description = serializers.CharField(max_length=2000, allow_blank=True)
    viewport = serializers.JSONField(validators=[validate_viewport])
    nodes = GraphNodeSerializer(many=True, allow_empty=True)
    edges = GraphEdgeSerializer(many=True, allow_empty=True)

    def validate(self, attrs):
        nodes = attrs["nodes"]
        edges = attrs["edges"]
        if len(nodes) > 2000:
            raise serializers.ValidationError({"nodes": "A diagram may contain at most 2000 nodes."})
        if len(edges) > 5000:
            raise serializers.ValidationError({"edges": "A diagram may contain at most 5000 edges."})

        node_by_id = {str(node["id"]): node for node in nodes}
        if len(node_by_id) != len(nodes):
            raise serializers.ValidationError({"nodes": "Node IDs must be unique."})

        edge_ids = [edge["id"] for edge in edges]
        if len(set(edge_ids)) != len(edge_ids):
            raise serializers.ValidationError({"edges": "Edge IDs must be unique."})

        for index, edge in enumerate(edges):
            source = node_by_id.get(str(edge["source"]))
            target = node_by_id.get(str(edge["target"]))
            if source is None or target is None:
                raise serializers.ValidationError(
                    {"edges": {index: "Each edge endpoint must be included in this graph snapshot."}}
                )
            if edge["source_port"] not in SHAPE_PORTS[source["shape_type"]]:
                raise serializers.ValidationError(
                    {"edges": {index: "Source port is not available on its shape."}}
                )
            if edge["target_port"] not in SHAPE_PORTS[target["shape_type"]]:
                raise serializers.ValidationError(
                    {"edges": {index: "Target port is not available on its shape."}}
                )
        return attrs
